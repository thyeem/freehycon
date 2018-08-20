import { getLogger } from "log4js"
import { IWorker, WorkerStatus, FreeHyconServer } from "./freehyconServer"
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
    mainchain: boolean
    hash: string
    prevHash: string
    timestamp: number
    height: number
}
export class DataCenter {
    public minedBlocks: IMinedBlocks[]
    public rewardBase: Map<string, IMinerReward>
    public poolHashshare: number
    public poolHashrate: number
    public actualHashrate: number
    public actualWorkers: number
    public miners: Map<string, IMiner>
    public workers: Map<string, Map<string, IWorkMan>>
    private freehyconServer: FreeHyconServer
    constructor(freehyconServer: FreeHyconServer) {
        this.freehyconServer = freehyconServer
        this.miners = new Map<string, IMiner>()
        this.workers = new Map<string, Map<string, IWorkMan>>()
        this.rewardBase = new Map<string, IMinerReward>()
        this.minedBlocks = []
    }
    public async preload() {
        const workers = await this.freehyconServer.mongoServer.loadWorkers()
        this.reset()
        this.loadWorkers(workers)
    }
    public updateDataSet(workers: IWorker[]) {
        this.reset()
        this.updateWorkers(workers)
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
            const prior = miner.get(worker.workerId)
            let hashshare = worker.hashshare
            if (prior !== undefined && prior.hashshare > hashshare) {
                hashshare += prior.hashshare
                this.freehyconServer.setWorkerHashshare(worker.socket.id, hashshare)
            }
            const elapsed = Date.now() - worker.tickLogin
            miner.set(worker.workerId, {
                address: worker.address,
                alive: true,
                workerId: worker.workerId,
                hashrate: worker.hashrate,
                hashshare,
                elapsed,
                elapsedStr: formatTime(elapsed),
                fee: hashshare * worker.fee,
                reward: hashshare * (1 - worker.fee)
            })
        }
    }
    public updateMiners() {
        for (const [address, workers] of this.workers) {
            let nodes = 0
            let hashrate = 0
            let hashshare = 0
            let fee = 0
            let reward = 0
            let elapsed = 0
            for (const [workerId, worker] of workers) {
                if (worker.alive) { nodes++ }
                elapsed = Math.max(elapsed, worker.elapsed)
                hashrate += worker.hashrate
                hashshare += worker.hashshare
                fee += worker.fee
                reward += worker.reward
                this.poolHashshare += worker.hashshare
            }
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
    public release(workers: IWorker[]) {
        this.updateDataSet(workers)
        const workerCount = workers.length
        const poolSummary = this.getPoolSummary(workerCount)
        const poolMiners = this.getPoolMiners()
        const poolWorkers = this.getPoolWorkers()
        this.freehyconServer.mongoServer.addSummary(poolSummary)
        this.freehyconServer.mongoServer.addMiners(poolMiners)
        this.freehyconServer.mongoServer.addWorkers(poolWorkers)
        logger.warn(`total(${workerCount}): ${this.poolHashrate.toFixed(1)} H/s | working(${this.actualWorkers}): ${this.actualHashrate.toFixed(1)} H/s`)
    }
    public getPoolSummary(workerCount: number) {
        const poolSummary: IPoolSumary = {
            workerCount,
            poolHashrate: this.poolHashrate,
            poolHashshare: this.poolHashshare,
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
                    workerId: worker.workerId,
                    hashrate: worker.hashrate,
                    hashshare: worker.hashshare / this.poolHashshare,
                    elapsed: worker.elapsed,
                    elapsedStr: worker.elapsedStr,
                    reward: worker.reward / this.poolHashshare,
                    fee: worker.fee / this.poolHashshare,
                })
            }
        }
        return poolWorkers
    }
    private reset() {
        this.poolHashshare = 0
        this.poolHashrate = 0
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