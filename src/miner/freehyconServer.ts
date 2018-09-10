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
import { RabbitmqServer } from "./rabbitServer";

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
    public static readonly FREQ_DAY_OFF = 100
    private readonly NUM_JOB_BUFFER = 10
    private readonly ALPHA_INTERN = 0.4
    private readonly MEANTIME_INTERN = 10000
    private readonly DIFFCULTY_INTERN = 1. / (500. * 0.001 * this.MEANTIME_INTERN / Math.LN2)
    private readonly ALPHA_INTERVIEW = 0.1
    private readonly MEANTIME_INTERVIEW = 10000
    private NUM_INTERN_PROBLEMS = 20
    private NUM_INTERVIEW_PROBLEMS = 20

    private readonly NUM_DAYOFF_PROBLEMS = 1
    private readonly THRESHOLD_BLACKLIST = 3
    private readonly THRESHOLD_MIN_HASHRATE = 30
    private readonly INTEVAL_PATROL_BLACKLIST = 300000
    private readonly INTEVAL_RELEASE_DATA = 10000
    private jobId: number
    private port: number
    private stratum: any
    private mapWorker: Map<string, IWorker>
    private mapJob: Map<number, IJob>
    private blacklist: Map<string, number>
    private dataCenter: DataCenter
    private ongoingPrehash: string
    public mongoServer: MongoServer
    public queuePutWork: RabbitmqServer;
    public queueSubmitWork: RabbitmqServer;

    constructor(mongoServer: MongoServer, port: number = 9081) {
        if (!MongoServer.isReal) {
            this.NUM_INTERN_PROBLEMS = 1
            this.NUM_INTERVIEW_PROBLEMS = 1
        }
        this.mongoServer = mongoServer
        this.setupRabbitMQ()
        this.port = port
        this.stratum = new LibStratum({ settings: { port: this.port, toobusy: 30 } })
        this.mapJob = new Map<number, IJob>()
        this.mapWorker = new Map<string, IWorker>()
        this.dataCenter = new DataCenter(this.mongoServer)
        this.blacklist = new Map<string, number>()
        this.jobId = 0
        setTimeout(async () => {
            await this.dataCenter.preload()
            await this.patrolBlacklist()
            this.init()
            this.releaseData()
        }, 2000)
    }

    public async setupRabbitMQ() {
        this.queuePutWork = new RabbitmqServer("putwork");
        await this.queuePutWork.initialize();
        this.queueSubmitWork = new RabbitmqServer("submitwork");
        await this.queueSubmitWork.initialize();
        this.queuePutWork.receive((msg: any) => {
            //logger.info(" [x] Received PutWork %s", msg.content.toString());
            let one = JSON.parse(msg.content.toString())
            const block = Block.decode(Buffer.from(one.block)) as Block
            const prehash = Buffer.from(one.prehash)
            this.stop(); // stop mining before putWork
            this.putWork(block, prehash)
        });
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
            let worker
            switch (req.method) {
                case "subscribe":
                    deferred.resolve([socket.id.toString(), "0", "0", 4])
                    break
                case "authorize":
                    const [address, workerId] = req.params.slice(0, 2)
                    const remoteIP = socket.socket.remoteAddress
                    let authorized = false
                    if (this.isInvalidUser(socket, address.trim())) {
                        this.giveWarnings(socket)
                    } else {
                        logger.warn(`Authorized worker: ${address}`)
                        authorized = true
                        worker = this.mapWorker.get(socket.id)
                        if (worker === undefined) { worker = this.welcomeNewWorker(socket) }
                        worker.address = checkAddress(address)
                        this.setWorkerId(worker, workerId)
                        this.setWorkerTick(worker)
                        this.putWorkOnInspector(worker)
                    }
                    deferred.resolve([authorized])
                    break
                case "submit":
                    worker = this.mapWorker.get(socket.id)
                    if (worker === undefined) { this.giveWarnings(socket); break }
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
        this.stratum.on("close", async (socketId: any) => {
            const worker = this.mapWorker.get(socketId)
            if (worker !== undefined) {
                this.dataCenter.leaveLegacy(worker)
                this.mapWorker.delete(socketId)
                this.mongoServer.addDisconnections({ address: worker.address, workerId: worker.workerId, timeStamp: Date.now() })
                logger.error(`Worker socket closed: ${worker.address} (${socketId})`)
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
            this.mapJob.delete(id - this.NUM_JOB_BUFFER)
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
                this.giveWarnings(worker.socket)
                return false
            }
            job.solved = true
            if (worker !== undefined) { // working on virtual job
                worker.inspector.submits++
                worker.inspector.stop()
                worker.inspector.jobTimer.lock = false
                logger.error(`${nick}estimated hashrate(${worker.inspector.submits}): ${(0.001 * worker.hashrate).toFixed(2)} kH/s`)
            } else { // when working on actual job
                const minedBlock = new Block(job.block)
                minedBlock.header.nonce = nonce
                let prehash = minedBlock.header.preHash()
                const submitData = { block: minedBlock.encode(), prehash: Buffer.from(prehash) }
                this.queueSubmitWork.send(JSON.stringify(submitData))

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
            if (worker.hashrate < this.THRESHOLD_MIN_HASHRATE) {
                this.giveWarnings(worker.socket, 10)
                return
            }
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
            inspector: new WorkerInspector(this.MEANTIME_INTERN, this.DIFFCULTY_INTERN, this.ALPHA_INTERN),
            socket,
            status: WorkerStatus.Intern,
            tick: undefined,
            tickLogin: undefined,
            workerId: undefined,
        }
        this.mapWorker.set(socket.id, worker)
        return this.mapWorker.get(socket.id)
    }
    private banInvalidUsers(socket: any) {
        if (socket === undefined) { return }
        try {
            const remoteIP = socket.socket.remoteAddress
            logger.error(`Banned invalid user of remoteIP: ${remoteIP} | score: ${this.blacklist.get(remoteIP)}`)
            socket.socket.end()
            socket.socket.unref()
            socket.socket.destroy()
        } catch (e) {
            logger.error(`error in destroying socket: ${e}`)
        } finally {
            this.mapWorker.delete(socket.id)
        }
    }
    private isInvalidUser(socket: any, address: string = "") {
        const remoteIP = socket.socket.remoteAddress
        const byAddress = this.blacklist.get(address) > this.THRESHOLD_BLACKLIST
        return (this.blacklist.get(remoteIP) > this.THRESHOLD_BLACKLIST) || byAddress
    }
    private giveWarnings(socket: any, increment: number = 1) {
        const remoteIP = socket.socket.remoteAddress
        let score = this.blacklist.get(remoteIP)
        score = (score !== undefined) ? score + increment : increment;
        this.blacklist.set(remoteIP, score)
        if (this.isInvalidUser(socket)) { this.banInvalidUsers(socket) }
    }
    private checkDayoff(worker: IWorker) {
        if (worker.career > 0x7FFFFFFF) { worker.career = 0 }
        worker.career++
        if (worker.career % FreeHyconServer.FREQ_DAY_OFF === 0) {
            worker.status = WorkerStatus.Dayoff
            return true
        }
        return false
    }
    private checkWorkingDay(worker: IWorker) {
        const isIntern = worker.status === WorkerStatus.Intern
        const problems = (worker.career !== 0) ? this.NUM_DAYOFF_PROBLEMS : (isIntern) ? this.NUM_INTERN_PROBLEMS : this.NUM_INTERVIEW_PROBLEMS
        if (worker.inspector.submits >= problems) {
            worker.inspector.submits = 0
            if (isIntern) { // move on next step: onInterview
                worker.status = WorkerStatus.OnInterview
                const difficulty = worker.inspector.difficulty
                worker.inspector = new WorkerInspector(this.MEANTIME_INTERVIEW, difficulty, this.ALPHA_INTERVIEW)
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
    private async patrolBlacklist() {
        const list = await this.mongoServer.getBlacklist()
        for (const item of list) {
            this.blacklist.set(item.key, item.score)
        }
        for (const [key, worker] of this.mapWorker) {
            if (this.isInvalidUser(worker.socket, worker.address)) { this.giveWarnings(worker.socket) }
        }
        setTimeout(() => {
            this.patrolBlacklist()
        }, this.INTEVAL_PATROL_BLACKLIST)
    }
    private async releaseData() {
        const workers = Array.from(this.mapWorker.values())
        this.dataCenter.release(workers)
        setTimeout(() => {
            this.releaseData()
        }, this.INTEVAL_RELEASE_DATA)
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
    const round = Math.floor(worker.career / FreeHyconServer.FREQ_DAY_OFF)
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