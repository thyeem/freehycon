import { getLogger } from "log4js"
import Long = require("long")
import { Address } from "../common/address"
import { Block } from "../common/block"
import { BlockHeader } from "../common/blockHeader"
import { ITxPool } from "../common/itxPool"
import { DBBlock } from "../consensus/database/dbblock"
import { WorldState } from "../consensus/database/worldState"
import { DifficultyAdjuster } from "../consensus/difficultyAdjuster"
import { IConsensus } from "../consensus/iconsensus"
import { BlockStatus } from "../consensus/sync"
import { globalOptions } from "../main"
import { INetwork } from "../network/inetwork"
import { Hash } from "../util/hash"
import { Banker } from "./banker"
import { formatTime, ILastBlock, IMinedBlocks, IMinerReward } from "./collector"
import { FC } from "./freehycon"
import { MongoServer } from "./mongoServer"
import { RabbitmqServer } from "./rabbitServer"
const logger = getLogger("Miner")

export class MinerServer {
    public static async checkNonce(preHash: Uint8Array, nonce: Long, difficulty: number, target?: Buffer): Promise<boolean> {
        // Consensus Critical
        const buffer = Buffer.allocUnsafe(72)
        buffer.fill(preHash, 0, 64)
        buffer.writeUInt32LE(nonce.getLowBitsUnsigned(), 64)
        buffer.writeUInt32LE(nonce.getHighBitsUnsigned(), 68)
        target = (target === undefined) ? DifficultyAdjuster.getTarget(difficulty) : target
        return DifficultyAdjuster.acceptable(await Hash.hashCryptonight(buffer), target)
    }
    public mongoServer: MongoServer
    public queuePutWork: RabbitmqServer
    public queueSubmitWork: RabbitmqServer
    public txpool: ITxPool
    public consensus: IConsensus
    public network: INetwork
    private intervalId: NodeJS.Timer
    private worldState: WorldState
    private banker: Banker
    public constructor(txpool: ITxPool, worldState: WorldState, consensus: IConsensus, network: INetwork, cpuMiners: number, stratumPort: number) {
        this.txpool = txpool
        this.worldState = worldState
        this.consensus = consensus
        this.network = network
        this.mongoServer = new MongoServer()
        this.banker = new Banker(this)
        this.consensus.on("candidate", (previousDBBlock: DBBlock, previousHash: Hash) => this.candidate(previousDBBlock, previousHash))
        setTimeout(() => {
            if (globalOptions.banker) {
                this.pollingPayWages()
            } else {
                this.setupRabbitMQ()
                this.pollingUpdateLastBlock()
            }
        }, 5000)
    }
    public async setupRabbitMQ() {
        this.queuePutWork = new RabbitmqServer("putwork")
        await this.queuePutWork.initialize()
        this.queueSubmitWork = new RabbitmqServer("submitwork")
        await this.queueSubmitWork.initialize()
        this.queueSubmitWork.receive((msg: any) => {
            if (FC.MODE_RABBITMQ_DEBUG) {
                logger.info(" [x] Received Submit Block %s", msg.content.toString())
            }
            const one = JSON.parse(msg.content.toString())
            const block = Block.decode(Buffer.from(one.block)) as Block
            const prehash = Buffer.from(one.prehash)
            this.processSubmitBlock({ block, prehash })
        })
    }
    public async pollingPayWages() {
        this.payWages()
        setTimeout(() => { this.pollingPayWages() }, FC.INTEVAL_PAY_WAGES)
    }
    public async pollingUpdateLastBlock() {
        this.updateLastBlock()
        setTimeout(() => { this.pollingUpdateLastBlock() }, FC.INTEVAL_UPDATE_LAST_BLOCK)
    }
    public async updateLastBlock() {
        const tip = this.consensus.getBlocksTip()
        const block = await this.consensus.getBlockByHash(tip.hash)
        if (!(block instanceof Block)) { return }
        const lastBlock: ILastBlock = {
            ago: formatTime(Date.now() - block.header.timeStamp) + " ago",
            blockHash: tip.hash.toString(),
            height: tip.height,
            miner: block.header.miner.toString(),
        }
        this.mongoServer.updateLastBlock(lastBlock)
    }
    public async processSubmitBlock(found: any) {
        await this.submitBlock(found.block)
        const hash = new Hash(found.block.header)
        const status = await this.consensus.getBlockStatus(hash)
        const height = await this.consensus.getBlockHeight(hash)
        const block: IMinedBlocks = {
            _id: hash.toString(),
            height,
            mainchain: status === BlockStatus.MainChain,
            prevHash: found.block.header.previousHash[0].toString(),
            timestamp: found.block.header.timeStamp,
        }
        this.mongoServer.addMinedBlock(block)
    }
    public async payWages() {
        const pays = await this.mongoServer.getPayWages()
        if (pays.length > 0) {
            for (const pay of pays) {
                const rewardBase: IMinerReward[] = pay.rewardBase
                const hash = Hash.decode(pay._id)
                const status = await this.consensus.getBlockStatus(hash)
                const height = await this.consensus.getBlockHeight(hash)
                const tip = this.consensus.getBlocksTip()
                const isMainchain = status === BlockStatus.MainChain
                if (height + FC.NUM_TXS_CONFIRMATIONS < tip.height) {
                    if (isMainchain) {
                        this.banker.distributeIncome(240, hash.toString(), height, rewardBase)
                        this.mongoServer.deletePayWage(pay._id)
                    } else {
                        this.mongoServer.updateBlockStatus(hash.toString(), isMainchain)
                        this.mongoServer.deletePayWage(pay._id)
                    }
                    return
                } else {
                    this.mongoServer.updateBlockStatus(hash.toString(), isMainchain)
                }
            }
        }
    }
    public async submitBlock(block: Block) {
        this.network.broadcastBlocks([block])
        await this.consensus.putBlock(block)
    }
    public getMinerInfo(): { hashRate: number, address: string, cpuCount: number } {
        return { hashRate: 0, address: globalOptions.minerAddress, cpuCount: 0 }
    }
    public setMinerCount(count: number) { globalOptions.cpuMiners = count }
    private candidate(previousDBBlock: DBBlock, previousHash: Hash): void {
        const miner: Address = new Address(globalOptions.minerAddress)
        logger.info(`New Candidate Block Difficulty: 0x${previousDBBlock.nextDifficulty.toExponential()} Target: ${DifficultyAdjuster.getTarget(previousDBBlock.nextDifficulty, 32).toString("hex")}`)
        clearInterval(this.intervalId)
        this.createCandidate(previousDBBlock, previousHash, miner)
        this.intervalId = setInterval(() => this.createCandidate(previousDBBlock, previousHash, miner), FC.INTEVAL_CANDIDATE_BLOCK)
    }
    private async createCandidate(previousDBBlock: DBBlock, previousHash: Hash, miner: Address) {
        const timeStamp = Math.max(Date.now(), previousDBBlock.header.timeStamp + 50)
        const { stateTransition: { currentStateRoot }, validTxs, invalidTxs } = await this.worldState.next(previousDBBlock.header.stateRoot, miner)
        this.txpool.removeTxs(invalidTxs)
        const block = new Block({
            header: new BlockHeader({
                difficulty: previousDBBlock.nextDifficulty,
                merkleRoot: Block.calculateMerkleRoot(validTxs),
                miner,
                nonce: -1,
                previousHash: [previousHash],
                stateRoot: currentStateRoot,
                timeStamp,
            }),
            txs: validTxs,
        })
        if (!globalOptions.banker && this.queuePutWork !== undefined) {
            const prehash = block.header.preHash()
            const putWorkData = { block: block.encode(), prehash: Buffer.from(prehash) }
            this.queuePutWork.send(JSON.stringify(putWorkData))
        }
    }
}
