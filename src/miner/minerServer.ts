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
import { globalOptions } from "../main"
import { INetwork } from "../network/inetwork"
import { Hash } from "../util/hash"

import { MongoServer } from "./mongoServer"
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

    public txpool: ITxPool
    public consensus: IConsensus
    public network: INetwork

    public mongoServer: MongoServer
    private intervalId: NodeJS.Timer
    private worldState: WorldState

    public constructor(txpool: ITxPool, worldState: WorldState, consensus: IConsensus, network: INetwork, cpuMiners: number, stratumPort: number) {
        this.txpool = txpool
        this.worldState = worldState
        this.consensus = consensus
        this.network = network
        this.mongoServer = new MongoServer()

        this.consensus.on("candidate", (previousDBBlock: DBBlock, previousHash: Hash) => this.candidate(previousDBBlock, previousHash))

        setInterval(async () => {
            await this.pollingSubmit()
            await this.pollingPayWages()
        }, 2000)
    }

    public async pollingSubmit() {

        var foundWorks: any[] = await this.mongoServer.pollingSubmitWork()
        if (foundWorks.length > 0) {
            for (let i = 0; i < foundWorks.length; i++) {
                let found = foundWorks[i]
                console.log(`${i}/${foundWorks.length - 1} Submit Prehash=${found.prehash.toString("hex")}   ${found.time}`)
                await this.submitBlock(found.block)
                this.mongoServer.addMinedBlock(found.block)
                //this.payWages()
                // this.dataCenter.addMinedBlock(minedBlock) })
                //  const { miners, rewardBase, roundHash } = this.newRound()
                // this.payWages(new Hash(minedBlock.header), rewardBase, roundHash)
            }
        }
    }
    public async pollingPayWages() {
        var wages = await this.mongoServer.pollingPayWages()
        if (wages.length > 0) {
            for (let i = 0; i < wages.length; i++) {
                let found = wages[i]
                console.log(`${i}/${wages.length - 1} Wage`)
            }
        }
    }
    public async submitBlock(block: Block) {
        if (await this.consensus.putBlock(block)) {
            this.network.broadcastBlocks([block])

        }
    }
    public getMinerInfo(): { hashRate: number, address: string, cpuCount: number } {
        return { hashRate: 0, address: globalOptions.minerAddress, cpuCount: 0 }
    }

    public setMinerCount(count: number) {
        globalOptions.cpuMiners = count
    }

    private candidate(previousDBBlock: DBBlock, previousHash: Hash): void {
        if (globalOptions.minerAddress === undefined || globalOptions.minerAddress === "") {
            logger.info("Can't mine without miner address")
            return
        }

        if (!globalOptions.bootstrap && ((Date.now() - previousDBBlock.header.timeStamp) > 86400000)) {
            logger.info("Last block is more than a day old, waiting for synchronization prior to mining.")
            return
        }

        const miner: Address = new Address(globalOptions.minerAddress)
        logger.info(`New Candidate Block Difficulty: 0x${previousDBBlock.nextDifficulty.toExponential()} Target: ${DifficultyAdjuster.getTarget(previousDBBlock.nextDifficulty, 32).toString("hex")}`)
        clearInterval(this.intervalId)
        this.createCandidate(previousDBBlock, previousHash, miner)
        this.intervalId = setInterval(() => this.createCandidate(previousDBBlock, previousHash, miner), 10000)

    }

    // submitBlock is the answer
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

        const prehash = block.header.preHash()
        // this is done through polling mongodb
        this.mongoServer.putWork(block, prehash)
    }
}
