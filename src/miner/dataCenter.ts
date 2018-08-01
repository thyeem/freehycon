import * as fs from "fs-extra"
import { getLogger } from "log4js"
import { Block } from "../common/block"
import { BlockStatus } from "../consensus/sync"
import { Hash } from "../util/hash"
import { IMiner, MinerStatus } from "./freehyconServer"
import { MongoServer } from "./mongoServer"
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
    _id: string
    nodes: number
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
export interface IMinedBlocks {
    mainchain: boolean
    hash: string
    prevHash: string
    timestamp: number
    height: number
}
export class DataCenter {
    public blicklist: Set<string>
    public minedBlocks: IMinedBlocks[]
    public rewardBase: Map<string, IMinerReward>
    public poolHashshare: number
    public poolHashrate: number
    public workerHash: number
    public worker: number
    public minerG: Map<string, IMinerGroup>
    private mongoServer: MongoServer
    private readonly minersFile = "miners.json"
    private readonly blocksFile = "blocks.json"
    constructor(mongoServer: MongoServer) {
        this.mongoServer = mongoServer
        this.blicklist = new Set<string>()
        this.minerG = new Map<string, IMinerGroup>()
        this.rewardBase = new Map<string, IMinerReward>()
        this.minedBlocks = []
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
                    _id: miner.address,
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
        logger.warn(`total(${minersCount}): ${this.poolHashrate.toFixed(1)} H/s | working(${this.worker}): ${this.workerHash.toFixed(1)} H/s`)
        this.mongoServer.addMiners(poolMiners)
    }
    public getPoolMiners(minersCount: number) {
        const minerGroups: IMinerGroup[] = Array.from(this.minerG.values())
        minerGroups.sort((a, b) => {
            return b.hashshare - a.hashshare
        })
        const poolMiners: IPoolMiner = {
            minerGroups,
            minersCount,
            poolHashrate: this.poolHashrate,
            poolHashshare: this.poolHashshare,
        }
        return poolMiners
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
