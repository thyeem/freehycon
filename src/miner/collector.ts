import { configure, getLogger } from "log4js"
import { globalOptions } from "../main"
import { MongoServer } from "./mongoServer"
configure({
    appenders: {
        console: {
            type: "log4js-protractor-appender",
        },
        fileLogs: {
            filename: `./logs/${new Date().getFullYear()}-${(new Date().getMonth()) + 1}-${new Date().getDate()}/logFile.log`,
            keepFileExt: true,
            maxLogSize: 16777216,
            pattern: ".yyyy-MM-dd",
            type: "dateFile",
        },
    },
    categories: {
        default: { appenders: ["console", "fileLogs"], level: "info" },
    },
})
const logger = getLogger("Collector")

export interface IMinerCluster {
    _id: string
    nodes: number
    hashrate: number
    hashshare: number
    elapsed: number
    elapsedStr: string
    reward: number
    fee: number
}
export interface IWorkerCluster {
    _id: string
    address: string
    alive: boolean
    workerId: string
    hashrate: number
    hashshare: number
    elapsed: number
    elapsedStr: string
    fee: number
    ip: string
    reward: number
}
export interface IMinerReward {
    _id: string
    reward: number
    fee: number
}
export interface IMinedBlocks {
    _id: string
    hash: string
    mainchain: boolean
    prevHash: string
    timestamp: number
    height: number
}
export interface ILastBlock {
    height: number
    ago: string
    blockHash: string
    miner: string
}
export interface IPoolSumary {
    workerCount: number
    poolHashrate: number
    poolHashshare: number
}
export class Collector {
    private mongoServer: MongoServer
    private workerCount: number
    private poolHashrate: number
    private poolHashshare: number
    private miners: Map<string, IMinerCluster>
    private rewardBase: Map<string, IMinerReward>
    constructor(mongoServer: MongoServer) {
        this.mongoServer = mongoServer
        this.miners = new Map<string, IMinerCluster>()
        this.rewardBase = new Map<string, IMinerReward>()
        setTimeout(() => { this.pollingCollector() }, 3000)
    }

    private reset() {
        this.workerCount = 0
        this.poolHashrate = 0.
        this.poolHashshare = 0.
        this.miners.clear()
        this.rewardBase.clear()
    }
    private async collectMiners() {
        const workers = await this.mongoServer.getWorkers()
        for (const worker of workers) {
            const miner = this.miners.get(worker.address)
            const nodes = (worker.alive === true) ? 1 : 0
            const hashrate = (worker.alive === true) ? worker.hashrate : 0
            if (miner === undefined) {
                this.miners.set(worker.address, {
                    _id: worker.address,
                    elapsed: worker.elapsed,
                    elapsedStr: worker.elapsedStr,
                    fee: worker.fee,
                    hashrate,
                    hashshare: worker.hashshare,
                    nodes,
                    reward: worker.reward,
                })
            } else {
                const elapsed = Math.max(miner.elapsed, worker.elapsed)
                const elapsedStr = formatTime(elapsed)
                miner.nodes += nodes
                miner.hashrate += hashrate
                miner.hashshare += worker.hashshare
                miner.fee += worker.fee
                miner.reward += worker.reward
                miner.elapsed = elapsed
                miner.elapsedStr = elapsedStr
            }
        }
    }
    private async collectPoolSummary() {
        for (const [_, miner] of this.miners) {
            this.workerCount += miner.nodes
            this.poolHashrate += miner.hashrate
            this.poolHashshare += miner.hashshare
        }
    }
    private async collectReward() {
        for (const [key, miner] of this.miners) {
            this.rewardBase.set(key, {
                _id: key,
                fee: miner.fee,
                reward: miner.reward,
            })
        }
    }
    private async pollingCollector() {
        this.reset()
        await this.collectMiners()
        await this.collectPoolSummary()
        for (const [_, miner] of this.miners) {
            miner.hashshare /= this.poolHashshare
            miner.reward /= this.poolHashshare
            miner.fee /= this.poolHashshare
        }
        await this.collectReward()

        const miners: IMinerCluster[] = Array.from(this.miners.values())
        const rewardBase: IMinerReward[] = Array.from(this.rewardBase.values())
        const summary: IPoolSumary = {
            poolHashrate: this.poolHashrate,
            poolHashshare: this.poolHashshare,
            workerCount: this.workerCount,
        }
        this.mongoServer.updateMiners(miners)
        this.mongoServer.updateRewardBase(rewardBase)
        this.mongoServer.updateSummary(summary)
        logger.info(`Done: Workers(${this.workerCount}) Miners(${miners.length}) PoolHashrate(${(0.001 * this.poolHashrate).toFixed(2)} kH/s)`)

        setTimeout(() => {
            this.pollingCollector()
        }, 2000)
    }
}
export function formatTime(second: number) {
    if (second <= 0) { return "-" } else { second *= 0.001 }
    const DAY = 86400
    const HOUR = 3600
    const MIN = 60
    let count = 0
    let res = ""
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

function run() {
    const mongo = new MongoServer()
    const collector = new Collector(mongo)
}
if (globalOptions.collector) { run() }