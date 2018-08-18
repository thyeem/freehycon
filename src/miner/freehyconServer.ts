import { randomBytes } from "crypto"
import { getLogger } from "log4js"
import Long = require("long")
import { Address } from "../common/address"
import { Block } from "../common/block"
import { BlockHeader } from "../common/blockHeader"
import { DifficultyAdjuster } from "../consensus/difficultyAdjuster"
import { Hash } from "../util/hash"
import { Banker } from "./banker"
import { DataCenter } from "./dataCenter"
import { WorkerInspector } from "./workerInspector"
import { MinerServer } from "./minerServer"
import { MongoServer } from "./mongoServer"

// tslint:disable-next-line:no-var-requires
const LibStratum = require("stratum").Server
const logger = getLogger("FreeHyconServer")
export enum WorkerStatus {
    Intern = 0,
    OnInterview = 1,
    Dayoff = 2,
    Working = 3,
}
export interface IJob {
    block: Block
    id: number
    prehash: Uint8Array
    prehashHex: string
    target: Buffer
    targetHex: string
    solved: boolean
}
export interface IWorker {
    socket: any
    workerId: string
    address: string
    fee: number
    hashrate: number
    hashshare: number
    invalid: number
    status: WorkerStatus
    career: number
    inspector: WorkerInspector
    tick: number
    tickLogin: number
}
const fakeBlock = new Block({
    header: new BlockHeader({
        difficulty: 0.001,
        merkleRoot: new Hash(randomBytes(32)),
        miner: new Uint8Array(20),
        nonce: -1,
        previousHash: [new Hash(randomBytes(32))],
        stateRoot: new Hash(randomBytes(32)),
        timeStamp: Date.now(),
    }),
    txs: [],
})
export class FreeHyconServer {
    public static readonly freqDayoff = 100
    private readonly numJobBuffer = 10
    private readonly alphaIntern = 0.3
    private readonly meanTimeIntern = 20000
    private readonly diffcultyIntern = 1. / (20. * 0.001 * this.meanTimeIntern / Math.LN2)
    private readonly alphaInterview = 0.06
    private readonly meanTimeInterview = 20000
    private readonly numInternProblems = 3
    private readonly numInterviewProblems = 3
    private readonly numDayoffProblems = 1
    private readonly timeoutClearBlacklist = 60000
    private readonly timeoutReleaseData = 10000
    private jobId: number
    private port: number
    private stratum: any
    private mapWorker: Map<string, IWorker>
    private mapJob: Map<number, IJob>
    private blacklist: Set<string>
    private dataCenter: DataCenter
    private ongoingPrehash: string
    public mongoServer: MongoServer

    constructor(mongoServer: MongoServer, port: number = 9081) {
        this.mongoServer = mongoServer
        this.port = port
        this.stratum = new LibStratum({ settings: { port: this.port, toobusy: 2000 } })
        this.mapJob = new Map<number, IJob>()
        this.mapWorker = new Map<string, IWorker>()
        this.dataCenter = new DataCenter(this)
        this.blacklist = new Set<string>()
        this.jobId = 0
        setTimeout(async () => {
            await this.dataCenter.preload()
            this.init()
            this.releaseData()
            this.clearBlacklist()
            this.runPollingPutWork()
        }, 2000)
    }
    public setWorkerHashshare(socketId: string, hashshare: number) {
        const worker = this.mapWorker.get(socketId)
        if (worker !== undefined) { worker.hashshare = hashshare }
    }
    public async runPollingPutWork() {
        this.pollingPutWork()
        setTimeout(() => { this.runPollingPutWork() }, MongoServer.timeoutPutWork)
    }
    public async pollingPutWork() {
        const foundWorks = await this.mongoServer.pollingPutWork()
        if (foundWorks.length > 0) {
            const found = foundWorks[0]
            const newPrehash = found.prehash.toString("hex")
            if (newPrehash !== this.ongoingPrehash) {
                this.ongoingPrehash = newPrehash
                this.putWork(found.block, found.prehash)
                logger.warn(`Polling PutWork: ${found.prehash.toString("hex").slice(0, 16)}`)
            }
        }
    }
    public putWork(block: Block, prehash: Uint8Array) {
        try {
            const newJob = this.newJob(block, prehash)
            let index = 0
            for (const [key, worker] of this.mapWorker) {
                if (worker.socket === undefined) { continue }
                if (worker.status === WorkerStatus.Working) {
                    if (this.checkDayoff(worker)) {
                        this.putWorkOnInspector(worker)
                    } else {
                        this.measureWorker(worker)
                        this.notifyJob(worker.socket, ++index, newJob)
                    }
                    continue
                } else { // worker.status === ( Intern or OnInterview or Dayoff )
                    this.putWorkOnInspector(worker)
                }
            }
        } catch (e) {
            logger.error(`putWork failed: ${e}`)
        }
    }
    public stop() {
        for (const [jobId, job] of this.mapJob) { job.solved = true }
    }
    public async putWorkOnInspector(worker: IWorker) {
        const newJob = this.newJob(fakeBlock, genPrehash(), worker)
        this.notifyJob(worker.socket, getRandomIndex(), newJob, worker)
        if (!worker.inspector.jobTimer.lock) {
            worker.inspector.jobTimer.lock = true
            worker.inspector.jobTimer.start = Date.now()
        }
    }
    private init() {
        logger.fatal(`FreeHycon Mining Server(FHMS) gets started.`)
        this.stratum.on("mining", async (req: any, deferred: any, socket: any) => {
            let worker = this.mapWorker.get(socket.id)
            if (worker === undefined) { worker = this.welcomeNewWorker(socket) }
            switch (req.method) {
                case "subscribe":
                    deferred.resolve([socket.id.toString(), "0", "0", 4])
                    break
                case "authorize":
                    const [address, workerId] = req.params.slice(0, 2)
                    const remoteIP = worker.socket.socket.remoteAddress
                    const blacklist = this.blacklist.has(remoteIP)
                    if (blacklist) {
                        this.banInvalidUsers(worker)
                    } else {
                        logger.warn(`Authorizing worker: ${address}`)
                        worker.address = checkAddress(address)
                        this.setWorkerId(worker, workerId)
                        this.setWorkerTick(worker)
                        this.putWorkOnInspector(worker)
                    }
                    deferred.resolve([true])
                    break
                case "submit":
                    const jobId = Number(req.params.job_id)
                    const isWorking: boolean = worker.status === WorkerStatus.Working
                    const job = (isWorking) ? this.mapJob.get(jobId) : worker.inspector.mapJob.get(jobId)
                    const nick = (isWorking) ? "" : getNick(worker)
                    if (job === undefined || job.solved === true) { break }
                    logger.debug(`${nick}submit job(${req.params.job_id}): ${bufferToHexBE(Buffer.from(req.params.result, "hex"))}`)
                    let result = false
                    if (isWorking) {
                        result = await this.completeWork(jobId, req.params.nonce)
                    } else { // worker.status === ( Intern or Oninterview or Dayoff )
                        worker.inspector.jobTimer.end = Date.now()
                        result = await this.completeWork(jobId, req.params.nonce, worker)
                        if (result) { this.keepWorkingTest(worker) }
                    }
                    deferred.resolve([result])
                    break
                default:
                    deferred.reject(LibStratum.errors.METHOD_NOT_FOUND)
            }
        })
        this.stratum.on("mining.error", (error: any, socket: any) => { logger.error("Mining error: ", error) })
        this.stratum.on("close", (socketId: any) => {
            const worker = this.mapWorker.get(socketId)
            if (worker !== undefined) {
                logger.error(`Worker socket closed: ${worker.address} (${socketId})`)
                this.mapWorker.delete(socketId)
            }
        })
        this.stratum.listen().done((msg: any) => { logger.fatal(msg) })
    }
    private newJob(block: Block, prehash: Uint8Array, worker?: IWorker): IJob {
        const nick = (worker !== undefined) ? getNick(worker) : ""
        let id = (worker !== undefined) ? worker.inspector.jobId : this.jobId
        if (id > 0x7FFFFFFF) { id = 0 }
        if (worker !== undefined) {
            worker.inspector.jobId = ++id
            worker.inspector.mapJob.delete(id - worker.inspector.numJobBuffer)
        } else {
            this.jobId = ++id
            this.mapJob.delete(id - this.numJobBuffer)
        }
        const prehashHex = Buffer.from(prehash as Buffer).toString("hex")
        const difficulty = (worker !== undefined) ? worker.inspector.difficulty : block.header.difficulty
        const target = DifficultyAdjuster.getTarget(difficulty, 32)
        const targetHex = DifficultyAdjuster.getTarget(difficulty, 8).toString("hex")
        const job = { block, id, prehash, prehashHex, solved: false, target, targetHex }

        if (worker !== undefined) {
            worker.inspector.mapJob.set(worker.inspector.jobId, job)
        } else {
            this.mapJob.set(this.jobId, job)
        }
        logger.debug(`${nick}Created a new job(${id}): ${bufferToHexBE(job.target)}`)
        return job
    }
    private async notifyJob(socket: any, index: number, job: IJob, worker?: IWorker) {
        const nick = (worker !== undefined) ? getNick(worker) : ""
        if (socket === undefined) {
            logger.error(`${nick}undefined of the stratum socket:`)
            return
        }
        if (job === undefined) { return }
        if (job.prehashHex === undefined) { return }
        socket.notify([index, job.prehashHex, job.targetHex, job.id, "0", "0", "0", "0", true])
            .then(() => {
                logger.debug(`${nick}Put job(${job.id}): ${socket.id}`)
            }, () => {
                logger.error(`${nick}Put job failed: ${socket.id}`)
            },
        )
    }
    private async completeWork(jobId: number, nonceStr: string, worker?: IWorker): Promise<boolean> {
        try {
            const job = (worker !== undefined) ? worker.inspector.mapJob.get(jobId) : this.mapJob.get(jobId)
            const nick = (worker !== undefined) ? getNick(worker) : ""
            if (job === undefined) { return false }

            const nonce = hexToLongLE(nonceStr)
            const nonceCheck = await MinerServer.checkNonce(job.prehash, nonce, -1, job.target)
            if (!nonceCheck) {
                logger.error(`${nick}received incorrect nonce: ${nonce.toString()}`)
                this.banInvalidUsers(worker)
                return false
            }
            job.solved = true
            if (worker !== undefined) { // working on virtual job
                worker.inspector.submits++
                worker.inspector.stop()
                worker.inspector.jobTimer.lock = false
                logger.error(`${nick}estimated hashrate(${worker.inspector.submits}): ${worker.hashrate.toFixed(1)} H/s`)
            } else { // when working on actual job
                const minedBlock = new Block(job.block)
                minedBlock.header.nonce = nonce
                this.mongoServer.submitBlock(minedBlock, minedBlock.header.preHash())
                this.stop()
                const rewardBase = this.newRound()
                const blockHash = new Hash(minedBlock.header)
                this.mongoServer.payWages({ blockHash: blockHash.toString(), rewardBase })
            }
            return true
        } catch (e) {
            logger.error(`Fail to submit nonce: ${e}`)
        }
    }
    private keepWorkingTest(worker: IWorker) {
        worker.inspector.adjustDifficulty()
        this.measureWorker(worker)
        if (this.checkWorkingDay(worker)) {
            const resumeJob = this.mapJob.get(this.jobId)
            this.notifyJob(worker.socket, getRandomIndex(), resumeJob)
            return
        }
        this.putWorkOnInspector(worker)
    }
    private measureWorker(worker: IWorker) {
        const prevTick = worker.tick
        const prevHashrate = worker.hashrate
        worker.tick = Date.now()
        worker.hashrate = 1.0 / (worker.inspector.difficulty * 0.001 * worker.inspector.targetTime)
        worker.hashshare += 0.5 * (prevHashrate + worker.hashrate) * 0.001 * (worker.tick - prevTick)
        worker.fee = getDecayedFee(worker.tick - worker.tickLogin)
    }
    private welcomeNewWorker(socket: any): IWorker {
        logger.warn(`New worker socket(${socket.id}) connected`)
        const worker: IWorker = {
            address: undefined,
            career: 0,
            fee: 0.029,
            hashrate: 0,
            hashshare: 0,
            inspector: new WorkerInspector(this.meanTimeIntern, this.diffcultyIntern, this.alphaIntern),
            invalid: 0,
            socket,
            status: WorkerStatus.Intern,
            tick: undefined,
            tickLogin: undefined,
            workerId: undefined,
        }
        this.mapWorker.set(socket.id, worker)
        return this.mapWorker.get(socket.id)
    }
    private banInvalidUsers(worker: IWorker) {
        if (worker.socket === undefined) { return }
        if (++worker.invalid < 10) { return }
        const remoteIP = worker.socket.socket.remoteAddress
        const socketId = worker.socket.id
        const address = worker.address
        try {
            logger.error(`Banned invalid worker: ${address} | remoteIP: ${remoteIP}`)
            worker.socket.end()
            worker.socket.unref()
            worker.socket.destroy()
        } catch (e) {
            logger.error(`error in destroying socket: ${e}`)
        }
        this.mapWorker.delete(socketId)
        this.blacklist.add(remoteIP)
    }
    private checkDayoff(worker: IWorker) {
        if (worker.career > 0x7FFFFFFF) { worker.career = 0 }
        worker.career++
        if (worker.career % FreeHyconServer.freqDayoff === 0) {
            worker.status = WorkerStatus.Dayoff
            return true
        }
        return false
    }
    private checkWorkingDay(worker: IWorker) {
        const isIntern = worker.status === WorkerStatus.Intern
        const problems = (worker.career !== 0) ? this.numDayoffProblems : (isIntern) ? this.numInternProblems : this.numInterviewProblems
        if (worker.inspector.submits >= problems) {
            worker.inspector.submits = 0
            if (isIntern) { // move on next step: onInterview
                worker.status = WorkerStatus.OnInterview
                const difficulty = worker.inspector.difficulty
                worker.inspector = new WorkerInspector(this.meanTimeInterview, difficulty, this.alphaInterview)
            } else {
                worker.status = WorkerStatus.Working
                return true
            }
        }
        return false
    }
    private newRound() {
        const workers = Array.from(this.mapWorker.values())
        this.dataCenter.updateDataSet(workers)
        const rewardBase = new Map(this.dataCenter.rewardBase)
        this.dataCenter.workers.clear()
        this.dataCenter.rewardBase.clear()
        for (const [key, worker] of this.mapWorker) { worker.hashshare = 0 }
        return rewardBase
    }
    private setWorkerId(worker: IWorker, workerId: string) {
        workerId = workerId.trim()
        worker.workerId = (workerId === "") ? worker.socket.id.slice(0, 12) : workerId.slice(0, 20)
    }
    private setWorkerTick(worker: IWorker) {
        const miner = this.dataCenter.workers.get(worker.address)
        if (miner !== undefined) {
            const workMan = miner.get(worker.workerId)
            if (workMan !== undefined) {
                worker.tickLogin = Date.now() - workMan.elapsed
                worker.tick = Date.now()
                return
            }
        }
        worker.tick = worker.tickLogin = Date.now()
    }
    private async releaseData() {
        const workers = Array.from(this.mapWorker.values())
        this.dataCenter.release(workers)
        setTimeout(() => {
            this.releaseData()
        }, this.timeoutReleaseData)
    }
    private async clearBlacklist() {
        this.blacklist.clear()
        for (const [key, worker] of this.mapWorker) { worker.invalid = 0 }
        setTimeout(() => {
            this.clearBlacklist()
        }, this.timeoutClearBlacklist)
    }
}

function genPrehash(): Uint8Array {
    return new Uint8Array(randomBytes(64))
}
function getRandomIndex(): number {
    return Math.floor(Math.random() * 0xFFFF)
}
function checkAddress(address: string) {
    const isAddress = Address.isAddress(address)
    const isDonation = address === Banker.freeHyconAddr
    return (!isAddress || isDonation) ? Banker.freeMinerAddr : address
}
function getNick(worker: IWorker): string {
    const round = Math.floor(worker.career / FreeHyconServer.freqDayoff)
    return worker.address.slice(0, 8) + ":" + worker.socket.id.slice(0, 6) + "(" + round + ") | "
}
function bufferToHexBE(target: Buffer) {
    const buf = Buffer.from(target.slice(24, 32))
    return Buffer.from(buf.reverse()).toString("hex")
}
function hexToLongLE(val: string): Long {
    const buf = new Uint8Array(Buffer.from(val, "hex"))
    let high = 0
    let low = 0
    for (let idx = 7; idx >= 4; --idx) {
        high *= 256
        high += buf[idx]
        low *= 256
        low += buf[idx - 4]
    }
    return new Long(low, high, true)
}
function getDecayedFee(dt: number) {
    dt = (dt < 0) ? 0 : 0.001 * dt
    let fee = 0.029 * Math.exp(-Math.LN2 / 3600.0 * dt)
    fee = (fee < 0.0029) ? 0.0029 : fee
    return fee
}