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
import { IMinedBlocks, IMinerReward, formatTime } from "./dataCenter"
import { MongoServer } from "./mongoServer"
import { RabbitmqServer } from "./rabbitServer";
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
    public queuePutWork: RabbitmqServer;
    public queueSubmitWork: RabbitmqServer;
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
        if (!globalOptions.banker) { this.setupRabbitMQ() }
        this.banker = new Banker(this)
        this.consensus.on("candidate", (previousDBBlock: DBBlock, previousHash: Hash) => this.candidate(previousDBBlock, previousHash))
        setTimeout(() => {
            if (globalOptions.banker) { this.runPollingPayWages() }
            this.runPollingUpdateLastBlock()
        }, 5000)
    }
    public async setupRabbitMQ() {
        this.queuePutWork = new RabbitmqServer("putwork");
        await this.queuePutWork.initialize();
        this.queueSubmitWork = new RabbitmqServer("submitwork");
        await this.queueSubmitWork.initialize();
        this.queueSubmitWork.receive((msg: any) => {
            if (MongoServer.debugRabbit) {
                logger.info(" [x] Received Submit Block %s", msg.content.toString());
            }
            let one = JSON.parse(msg.content.toString())
            const block = Block.decode(Buffer.from(one.block)) as Block
            const prehash = Buffer.from(one.prehash)
            //logger.info(`Block ${JSON.stringify(block)}`)
            this.processSubmitBlock({ block, prehash })
        });
    }

    public async runPollingPayWages() {
        this.pollingPayWages()
        setTimeout(() => { this.runPollingPayWages() }, MongoServer.timeoutPayWages)
    }
    public async runPollingUpdateBlockStatus() {
        this.updateBlockStatus()
        setTimeout(() => { this.runPollingUpdateBlockStatus() }, MongoServer.timeoutUpdateBlockStatus)
    }

    public async runPollingUpdateLastBlock() {
        this.updateLastBlock()
        setTimeout(() => { this.runPollingUpdateLastBlock() }, 5000)
    }
    public async updateLastBlock() {
        const tip = this.consensus.getBlocksTip()
        const block = await this.consensus.getBlockByHash(tip.hash)
        if (!(block instanceof Block)) { return }
        const lastBlock = {
            height: tip.height,
            blockHash: tip.hash.toString(),
            miner: block.header.miner.toString(),
            ago: formatTime(Date.now() - block.header.timeStamp) + " ago"
        }
        this.mongoServer.updateLastBlock(lastBlock)
    }
    public async updateBlockStatus() {
        const rows = await this.mongoServer.getMinedBlocks()
        for (const row of rows) {
            const hash = Hash.decode(row.hash)
            const status = await this.consensus.getBlockStatus(hash)
            const isMainchain = status === BlockStatus.MainChain
            await this.mongoServer.updateBlockStatus(row.hash, isMainchain)
        }
    }

    public async processSubmitBlock(found: any) {
        await this.submitBlock(found.block)
        const hash = new Hash(found.block.header)
        const status = await this.consensus.getBlockStatus(hash)
        const height = await this.consensus.getBlockHeight(hash)
        const newBlock: IMinedBlocks = {
            hash: hash.toString(),
            height,
            mainchain: status === BlockStatus.MainChain,
            prevHash: found.block.header.previousHash[0].toString(),
            timestamp: found.block.header.timeStamp,
        }
        this.mongoServer.addMinedBlock(newBlock)
    }
    public async pollingPayWages() {
        const pays = await this.mongoServer.pollingPayWages()
        if (pays.length > 0) {
            for (const pay of pays) {
                const hash = Hash.decode(pay.blockHash)
                const status = await this.consensus.getBlockStatus(hash)
                const height = await this.consensus.getBlockHeight(hash)
                const tip = this.consensus.getBlocksTip()
                const isMainchain = status === BlockStatus.MainChain
                if (height + MongoServer.confirmations < tip.height) {
                    if (isMainchain) {
                        const rewardBase = new Map<string, IMinerReward>()
                        for (const key in pay.rewardBase) { if (1) { rewardBase.set(key, pay.rewardBase[key]) } }
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
    public setMinerCount(count: number) {
        globalOptions.cpuMiners = count
    }
    private candidate(previousDBBlock: DBBlock, previousHash: Hash): void {
        const miner: Address = new Address(globalOptions.minerAddress)
        logger.info(`New Candidate Block Difficulty: 0x${previousDBBlock.nextDifficulty.toExponential()} Target: ${DifficultyAdjuster.getTarget(previousDBBlock.nextDifficulty, 32).toString("hex")}`)
        clearInterval(this.intervalId)
        this.createCandidate(previousDBBlock, previousHash, miner)
        this.intervalId = setInterval(() => this.createCandidate(previousDBBlock, previousHash, miner), 10000)
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
        if (!globalOptions.banker) {
            const prehash = block.header.preHash()
            const putWorkData = { block: block.encode(), prehash: Buffer.from(prehash) }
            this.queuePutWork.send(JSON.stringify(putWorkData))
        }
    }
}
