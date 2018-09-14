import { getLogger } from "log4js"
import { MongoServer } from "./mongoServer"
import { IWorker, WorkerStatus } from "./stratumServer"
const logger = getLogger("dataCenter")

export interface IPoolSumary {
    poolHashrate: number
    poolHashshare: number
    workerCount: number
}
export interface IMiner {
    _id: string
    nodes: number
    hashrate: number
    hashshare: number
    elapsed: number
    elapsedStr: string
    reward: number
    fee: number
}
export interface IWorkMan {
    address: string
    alive: boolean
    extra: number
    workerId: string
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
    _id: string
    hash: string
    mainchain: boolean
    prevHash: string
    timestamp: number
    height: number
}
export class DataCenter {
    public minedBlocks: IMinedBlocks[]
    public rewardBase: Map<string, IMinerReward>
    public poolHashshare: number
    public poolHashrate: number
    public poolWorkers: number
    public actualHashrate: number
    public actualWorkers: number
    public miners: Map<string, IMiner>
    public workers: Map<string, Map<string, IWorkMan>>
    private mongoServer: MongoServer
    constructor(mongoServer: MongoServer) {
        this.mongoServer = mongoServer
        this.miners = new Map<string, IMiner>()
        this.workers = new Map<string, Map<string, IWorkMan>>()
        this.rewardBase = new Map<string, IMinerReward>()
        this.minedBlocks = []
    }
    public async preload() {
        const workers = await this.mongoServer.loadWorkers()
        this.reset()
        this.loadWorkers(workers)

        this.mongoServer.removeClusterAllWorkers()
    }
    public async updateDataSet(workers: IWorker[]) {
        await this.mongoServer.updateClusterWorkers(workers)
        const allWorkers = await this.mongoServer.getClusterAllWorkers()
        this.reset()
        this.updateWorkers(allWorkers)
        this.updateMiners()
        this.updateRewardBase()
    }
    public loadWorkers(workers: IWorkMan[]) {
        for (const worker of workers) {
            let miner = this.workers.get(worker.address)
            if (miner === undefined) {
                this.workers.set(worker.address, new Map<string, IWorkMan>())
                miner = this.workers.get(worker.address)
            }
            worker.extra = worker.hashshare
            miner.set(worker.workerId, worker)
        }
    }
    public updateWorkers(workers: IWorker[]) {
        for (const worker of workers) {
            this.poolHashrate += worker.hashrate
            if (worker.status === WorkerStatus.Working) {
                this.actualHashrate += worker.hashrate
                this.actualWorkers++
            }
            let miner = this.workers.get(worker.address)
            if (miner === undefined) {
                this.workers.set(worker.address, new Map<string, IWorkMan>())
                miner = this.workers.get(worker.address)
            }
            let hashshare = worker.hashshare
            let extra = 0.
            const prior = miner.get(worker.workerId)
            if (prior !== undefined) {
                hashshare += prior.extra
                extra += prior.extra
            }
            const elapsed = Date.now() - worker.tickLogin
            miner.set(worker.workerId, {
                address: worker.address,
                alive: true,
                elapsed,
                elapsedStr: formatTime(elapsed),
                extra,
                fee: hashshare * worker.fee,
                hashrate: worker.hashrate,
                hashshare,
                reward: hashshare * (1 - worker.fee),
                workerId: worker.workerId,
            })
        }
    }
    public updateMiners() {
        for (const [address, workers] of this.workers) {
            let nodes = 0
            let hashrate = 0.
            let hashshare = 0.
            let fee = 0.
            let reward = 0.
            let elapsed = 0
            for (const [workerId, worker] of workers) {
                if (worker.alive) {
                    nodes++
                    hashrate += worker.hashrate
                    elapsed = Math.max(elapsed, worker.elapsed)
                }
                fee += worker.fee
                reward += worker.reward
                hashshare += worker.hashshare
                this.poolHashshare += worker.hashshare
            }
            if (nodes <= 0) { elapsed = 0 }
            this.miners.set(address, {
                _id: address,
                elapsed,
                elapsedStr: formatTime(elapsed),
                fee,
                hashrate,
                hashshare,
                nodes,
                reward,
            })
        }
    }
    public updateRewardBase() {
        for (const [address, miner] of this.miners) {
            const reward = miner.reward / this.poolHashshare
            const fee = miner.fee / this.poolHashshare
            this.rewardBase.set(address, { fee, reward })
        }
    }
    public async release(workers: IWorker[]) {
        this.poolWorkers += workers.length
        await this.updateDataSet(workers)
        const poolSummary = this.getPoolSummary()
        const poolMiners = this.getPoolMiners()
        const poolWorkers = this.getPoolWorkers()
        this.mongoServer.addSummary(poolSummary)
        this.mongoServer.addMiners(poolMiners)
        this.mongoServer.addWorkers(poolWorkers)
        logger.warn(`total(${this.poolWorkers}): ${(0.001 * this.poolHashrate).toFixed(2)} kH/s | working(${this.actualWorkers}): ${(0.001 * this.actualHashrate).toFixed(2)} kH/s`)
    }
    public getPoolSummary() {
        const poolSummary: IPoolSumary = {
            poolHashrate: this.poolHashrate,
            poolHashshare: this.poolHashshare,
            workerCount: this.poolWorkers,
        }
        return poolSummary
    }
    public getPoolMiners() {
        const poolMiners: IMiner[] = Array.from(this.miners.values())
        poolMiners.sort((a, b) => {
            return b.hashshare - a.hashshare
        })
        for (const miner of poolMiners) {
            miner.hashshare /= this.poolHashshare
            miner.reward /= this.poolHashshare
            miner.fee /= this.poolHashshare
        }
        return poolMiners
    }
    public getPoolWorkers() {
        const poolWorkers: IWorkMan[] = []
        for (const [address, workers] of this.workers) {
            for (const [workerId, worker] of workers) {
                poolWorkers.push({
                    address: worker.address,
                    alive: worker.alive,
                    elapsed: worker.elapsed,
                    elapsedStr: worker.elapsedStr,
                    extra: worker.extra,
                    fee: worker.fee,
                    hashrate: worker.hashrate,
                    hashshare: worker.hashshare,
                    reward: worker.reward,
                    workerId: worker.workerId,
                })
            }
        }
        return poolWorkers
    }
    public leaveLegacy(worker: IWorker) {
        const miner = this.workers.get(worker.address)
        if (miner === undefined) { return }
        const workMan = miner.get(worker.workerId)
        if (workMan === undefined) { return }
        workMan.extra = workMan.hashshare
    }
    private reset() {
        this.poolHashshare = 0
        this.poolHashrate = 0
        this.poolWorkers = 0
        this.actualWorkers = 0
        this.actualHashrate = 0
        this.miners.clear()
        for (const [address, workers] of this.workers) {
            for (const [workerId, worker] of workers) {
                worker.alive = false
                worker.hashrate = 0
                worker.elapsedStr = "-"
            }
        }
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
