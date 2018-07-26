import * as fs from "fs-extra"
import { getLogger } from "log4js"
import { Block } from "../common/block"
import { BlockStatus } from "../consensus/sync"
import { Hash } from "../util/hash"
import { FreeHyconServer, IMiner, MinerStatus } from "./freehyconServer"
import { MinerServer } from "./minerServer"
const logger = getLogger("dataCenter")

function formatTime(second: number) {
    const DAY = 86400
    const HOUR = 3600
    const MIN = 60
    let count = 0
    let res = ""
    second = (second < 0) ? 0 : 0.001 * second
    const day = Math.floor(second / DAY)
    if (day > 0) {
        count++
        res += day + "d "
        second -= day * DAY
    }
    const hour = Math.floor(second / HOUR)
    if (hour > 0) {
        count++
        res += hour + "h "
        second -= hour * HOUR
        if (count > 1) { return res.trim() }
    }
    const min = Math.floor(second / MIN)
    if (min > 0) {
        count++
        res += min + "m "
        second -= min * MIN
        if (count > 1) { return res.trim() }
    }
    return res + second.toFixed(0) + "s"
}
export interface IPoolMiner {
    poolHashrate: number
    poolHashshare: number
    minersCount: number
    minerGroups: IMinerGroup[]
}
export interface IMinerGroup {
    nodes: number
    address: string
    hashrate: number
    hashshare: number
    elapsed: number
    elapsedStr: string
    reward: number
    fee: number
}
export interface IMinerReward {
    reward: number
    fee: number
}
interface IMinedBlocks {
    mainchain: boolean
    hash: string
    timestamp: number
    height: number
}
export class DataCenter {
    public blicklist: Set<string>
    public minedBlocks: IMinedBlocks[]
    public rewardBase: Map<string, IMinerReward>
    public payments: number
    public poolHashshare: number
    public poolHashrate: number
    public workerHash: number
    public worker: number
    public minerG: Map<string, IMinerGroup>
    private minerServer: MinerServer
    private readonly minersFile = "miners.json"
    private readonly blocksFile = "blocks.json"
    constructor(minerServer: MinerServer) {
        this.minerServer = minerServer
        this.blicklist = new Set<string>()
        this.minerG = new Map<string, IMinerGroup>()
        this.rewardBase = new Map<string, IMinerReward>()
        this.minedBlocks = []
        this.payments = 0
        this.init()
    }
    public init() {
        if (fs.existsSync(this.minersFile)) {
            const data = fs.readFileSync(this.minersFile)
            const miners = JSON.parse(data.toString()).minerGroups
            for (const miner of miners) {
                this.minerG.set(miner.address, miner)
            }
        }
        // if (fs.existsSync(this.blocksFile)) {
        //     const data = fs.readFileSync(this.blocksFile)
        //     this.minedBlocks = JSON.parse(data.toString())
        // } else {
        // }
    }
    public updateMinerInfo(miners: IMiner[]) {
        this.reset()
        for (const miner of miners) {
            this.poolHashrate += miner.hashrate
            if (miner.status === MinerStatus.Working) {
                this.workerHash += miner.hashrate
                this.worker++
            }
            const minerG = this.minerG.get(miner.address)
            const elapsed = Date.now() - miner.tickLogin
            if (minerG === undefined) {
                const newMinerG: IMinerGroup = {
                    address: miner.address,
                    elapsed,
                    elapsedStr: formatTime(elapsed),
                    fee: miner.hashshare * miner.fee,
                    hashrate: miner.hashrate,
                    hashshare: miner.hashshare,
                    nodes: 1,
                    reward: miner.hashshare * (1 - miner.fee),
                }
                this.minerG.set(miner.address, newMinerG)
            } else {
                minerG.nodes++
                minerG.hashrate += miner.hashrate
                minerG.hashshare += miner.hashshare
                minerG.fee += miner.hashshare * miner.fee
                minerG.reward += miner.hashshare * (1 - miner.fee)
                minerG.elapsed = Math.max(elapsed, minerG.elapsed)
                minerG.elapsedStr = formatTime(minerG.elapsed)
            }
        }
        for (const [address, minerG] of this.minerG) {
            this.poolHashshare += minerG.hashshare
            this.rewardBase.set(address, { fee: minerG.fee, reward: minerG.reward })
        }
    }
    public release(miners: IMiner[]) {
        const minersCount = miners.length
        this.updateMinerInfo(miners)
        const poolMiners = this.getPoolMiners(minersCount)
        const poolBlocks = this.getPoolBlocks()
        logger.warn(`${this.minedBlocks.length} blocks mined | total(${minersCount}): ${this.poolHashrate.toFixed(1)} H/s | working(${this.worker}): ${this.workerHash.toFixed(1)} H/s`)
        this.writeFileJSON(poolMiners, poolBlocks)
    }
    public getPoolMiners(minersCount: number) {
        const minerGroups: IMinerGroup[] = Array.from(this.minerG.values())
        minerGroups.sort((a, b) => {
            return b.hashrate - a.hashrate
        })
        const poolMiners: IPoolMiner = {
            minerGroups,
            minersCount,
            poolHashrate: this.poolHashrate,
            poolHashshare: this.poolHashshare,
        }
        return poolMiners
    }
    public getPoolBlocks() {
        const poolBlocks = Array.from(this.minedBlocks)
        poolBlocks.sort((a, b) => {
            return b.height - a.height
        })
        return poolBlocks
    }
    public writeFileJSON(poolMiners: IPoolMiner, poolBlocks: IMinedBlocks[]) {
        try {
            fs.writeFileSync(this.minersFile, JSON.stringify(poolMiners))
            fs.writeFileSync(this.blocksFile, JSON.stringify(poolBlocks))
        } catch (e) {
            logger.warn(`failed to write miners/blocks JSON file: ${e}`)
        }
    }
    public async addMinedBlock(block: Block) {
        const hash = new Hash(block.header)
        setTimeout(async () => {
            const status = await this.minerServer.consensus.getBlockStatus(hash)
            const height = await this.minerServer.consensus.getBlockHeight(hash)
            const newBlock: IMinedBlocks = {
                hash: hash.toString(),
                height,
                mainchain: status === BlockStatus.MainChain,
                timestamp: block.header.timeStamp,
            }
            this.minedBlocks.unshift(newBlock)
        }, FreeHyconServer.deferredTime)

    }
    public async clearBlacklist() {
        this.blicklist.clear()
        setTimeout(async () => {
            this.clearBlacklist()
        }, 60000)
    }
    private reset() {
        this.poolHashshare = 0
        this.poolHashrate = 0
        this.workerHash = 0
        this.worker = 0
        for (const [key, minerG] of this.minerG) {
            minerG.nodes = 0
            minerG.hashrate = 0
            minerG.elapsed = 0
            minerG.elapsedStr = "-"
        }
    }
}
