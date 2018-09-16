import { randomBytes } from "crypto"
import { getLogger } from "log4js"
import Long = require("long")
import { Address } from "../common/address"
import { Block } from "../common/block"
import { BlockHeader } from "../common/blockHeader"
import { DifficultyAdjuster } from "../consensus/difficultyAdjuster"
import { Hash } from "../util/hash"
import { Banker } from "./banker"
import { formatTime, IMinerReward, IWorkerCluster } from "./collector"
import { MinerServer } from "./minerServer"
import { MongoServer } from "./mongoServer"
import { RabbitmqServer } from "./rabbitServer"
import { WorkerInspector } from "./workerInspector"

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
    client: any
    address: string
    fee: number
    hashrate: number
    hashshare: number
    status: WorkerStatus
    career: number
    inspector: WorkerInspector
    invalid: number
    ip: string
    tick: number
    tickLogin: number
    workerId: string
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
export class StratumServer {
    public static FREQ_DAY_OFF = 100
    private NUM_INTERN_PROBLEMS = 20
    private NUM_INTERVIEW_PROBLEMS = 20
    private readonly INITIAL_HASHRATE = 200
    private readonly NUM_JOB_BUFFER = 10
    private readonly ALPHA_INTERN = 0.3
    private readonly MEANTIME_INTERN = 20000
    private DIFFCULTY_INTERN = 1. / (this.INITIAL_HASHRATE * 0.001 * this.MEANTIME_INTERN / Math.LN2)
    private readonly ALPHA_INTERVIEW = 0.1
    private readonly MEANTIME_INTERVIEW = 20000
    private readonly NUM_DAYOFF_PROBLEMS = 1
    private readonly THRESHOLD_BLACKLIST = 30
    private readonly THRESHOLD_MIN_HASHRATE = 30
    private readonly INTEVAL_PATROL_BLACKLIST = 300000
    private readonly INTEVAL_RELEASE_DATA = 10000
    private jobId: number
    private port: number
    private mongoServer: MongoServer
    private queuePutWork: RabbitmqServer
    private queueSubmitWork: RabbitmqServer
    private stratum: any
    private mapWorker: Map<string, IWorker>
    private mapJob: Map<number, IJob>
    private blacklist: Map<string, number>
    private ongoingPrehash: string

    constructor(mongoServer: MongoServer, port: number = 9081) {
        if (!MongoServer.isReal) {
            this.NUM_INTERN_PROBLEMS = 1
            this.NUM_INTERVIEW_PROBLEMS = 1
            this.DIFFCULTY_INTERN = 0.05
            StratumServer.FREQ_DAY_OFF = 10
        }
        this.mongoServer = mongoServer
        this.setupRabbitMQ()
        this.port = port
        this.stratum = new LibStratum({ settings: { port: this.port, toobusy: 200 } })
        this.mapJob = new Map<number, IJob>()
        this.mapWorker = new Map<string, IWorker>()
        this.blacklist = new Map<string, number>()
        this.jobId = 0
        setTimeout(async () => {
            // await this.patrolBlacklist()
            this.init()
            this.releaseData()
        }, 2000)
    }

    public async setupRabbitMQ() {
        this.queuePutWork = new RabbitmqServer("putwork")
        await this.queuePutWork.initialize()
        this.queueSubmitWork = new RabbitmqServer("submitwork")
        await this.queueSubmitWork.initialize()
        await this.queuePutWork.receive((msg: any) => {
            if (MongoServer.debugRabbit) {
                logger.info(" [x] Received PutWork %s", msg.content.toString())
            }
            const one = JSON.parse(msg.content.toString())
            const block = Block.decode(Buffer.from(one.block)) as Block
            const prehash = Buffer.from(one.prehash)
            this.stop()
            this.putWork(block, prehash)
        })
    }

    public putWork(block: Block, prehash: Uint8Array) {
        try {
            const newJob = this.newJob(block, prehash)
            let index = getRandomIndex()
            for (const [key, worker] of this.mapWorker) {
                if (worker.client === undefined) { continue }
                if (worker.status === WorkerStatus.Working) {
                    if (this.checkDayoff(worker)) {
                        this.putWorkOnInspector(worker)
                    } else {
                        this.measureWorker(worker)
                        this.notifyJob(worker.client, ++index, newJob)
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
        this.notifyJob(worker.client, getRandomIndex(), newJob, worker)
        if (!worker.inspector.jobTimer.lock) {
            worker.inspector.jobTimer.lock = true
            worker.inspector.jobTimer.start = Date.now()
        }
    }
    private init() {
        logger.fatal(`FreeHycon Mining Server(FHMS) gets started.`)
        this.stratum.on("mining", async (req: any, deferred: any, client: any) => {
            let worker: IWorker
            switch (req.method) {
                case "subscribe":
                    deferred.resolve([client.id.toString(), "0", "0", 4])
                    break
                case "authorize":
                    const [address, workerId] = req.params.slice(0, 2)
                    const remoteIP = client.socket.remoteAddress
                    let authorized = false
                    if (this.isInvalidUser(client, address.trim())) {
                        this.giveWarnings(client)
                    } else {
                        logger.warn(`Authorized worker: ${address} | IP address: ${remoteIP}`)
                        const validAddress = checkAddress(address)
                        const validWorkerId = checkWorkerId(client.id, workerId)
                        const key = genKey(remoteIP, validAddress, validWorkerId)
                        authorized = true
                        worker = await this.mongoServer.findWorker(key)
                        if (worker === undefined) {
                            worker = this.welcomeNewWorker(client, key)
                        } else {
                            this.updateOldWorker(client, worker)
                        }
                        this.putWorkOnInspector(worker)
                    }
                    deferred.resolve([authorized])
                    break
                case "submit":
                    let verified = false
                    worker = this.mapWorker.get(client.id)
                    if (worker === undefined) {
                        this.giveWarnings(client)
                    } else {
                        const jobId = Number(req.params.job_id)
                        const isWorking: boolean = worker.status === WorkerStatus.Working
                        const job = (isWorking) ? this.mapJob.get(jobId) : worker.inspector.mapJob.get(jobId)
                        const nick = (isWorking) ? "" : getNick(worker)
                        if (job === undefined || job.solved === true) {
                            // deferred.resolve([true])
                            break
                        }
                        logger.debug(`${nick}submit job(${req.params.job_id}): ${bufferToHexBE(Buffer.from(req.params.result, "hex"))}`)
                        if (isWorking) {
                            verified = await this.completeWork(jobId, req.params.nonce)
                        } else { // worker.status === ( Intern or Oninterview or Dayoff )
                            worker.inspector.jobTimer.end = Date.now()
                            verified = await this.completeWork(jobId, req.params.nonce, worker)
                            if (verified) { this.keepWorkingTest(worker) }
                        }
                    }
                    deferred.resolve([verified])
                    break
                default:
                    deferred.reject(LibStratum.errors.METHOD_NOT_FOUND)
            }
        })
        this.stratum.on("mining.error", (error: any, client: any) => {
            this.giveWarnings(client)
            logger.error("Mining error: ", error)
        })
        this.stratum.on("close", async (clientId: any) => {
            const worker = this.mapWorker.get(clientId)
            if (worker !== undefined) {
                this.mapWorker.delete(clientId)
                this.mongoServer.offWorker(getKey(worker))
                logger.error(`Worker client closed: ${worker.address} (${clientId})`)
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
    private async notifyJob(client: any, index: number, job: IJob, worker?: IWorker) {
        const nick = (worker !== undefined) ? getNick(worker) : ""
        if (client === undefined) {
            logger.error(`${nick}undefined of the stratum client:`)
            return
        }
        if (job === undefined) { return }
        if (job.prehashHex === undefined) { return }
        client.notify([index, job.prehashHex, job.targetHex, job.id, "0", "0", "0", "0", true])
            .then(() => {
                logger.debug(`${nick}Put job(${job.id}): ${client.id}`)
            }, () => {
                logger.error(`${nick}Put job failed: ${client.id}`)
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
                if (worker !== undefined) { this.giveWarnings(worker.client) }
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
                const prehash = minedBlock.header.preHash()
                const submitData = { block: minedBlock.encode(), prehash: Buffer.from(prehash) }
                this.queueSubmitWork.send(JSON.stringify(submitData))

                this.stop()
                const rewardBase: IMinerReward[] = await this.newRound()
                const blockHash = new Hash(minedBlock.header)
                this.mongoServer.addPayWage({ blockHash: blockHash.toString(), rewardBase })
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
                this.giveWarnings(worker.client, 100)
                return
            }
            const resumeJob = this.mapJob.get(this.jobId)
            this.notifyJob(worker.client, getRandomIndex(), resumeJob)
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
    private welcomeNewWorker(client: any, key: string): IWorker {
        logger.warn(`New worker client(${client.id}) connected`)
        const [ip, address, workerId] = parseKey(key)
        const worker: IWorker = {
            address,
            career: 0,
            client,
            fee: 0.029,
            hashrate: 0,
            hashshare: 0,
            inspector: new WorkerInspector(this.MEANTIME_INTERN, this.DIFFCULTY_INTERN, this.ALPHA_INTERN),
            invalid: 0,
            ip,
            status: WorkerStatus.Intern,
            tick: Date.now(),
            tickLogin: Date.now(),
            workerId,
        }
        this.mapWorker.set(client.id, worker)
        return this.mapWorker.get(client.id)
    }
    private updateOldWorker(client: any, worker: IWorker) {
        worker.client = client
        worker.status = WorkerStatus.Intern
        worker.inspector = new WorkerInspector(this.MEANTIME_INTERN, this.DIFFCULTY_INTERN, this.ALPHA_INTERN)
        this.mapWorker.set(client.id, worker)
    }
    private banInvalidUsers(client: any) {
        if (client === undefined) { return }
        try {
            const remoteIP = client.socket.remoteAddress
            logger.error(`Banned invalid user of remoteIP: ${remoteIP} | score: ${this.blacklist.get(remoteIP)}`)
            client.socket.end()
            client.socket.unref()
            client.socket.destroy()
        } catch (e) {
            logger.error(`error in destroying client socket: ${e}`)
        } finally {
            this.mapWorker.delete(client.id)
        }
    }
    private isInvalidUser(client: any, address: string = "") {
        const remoteIP = client.socket.remoteAddress
        const worker = this.mapWorker.get(client.id)
        const byAddress = this.blacklist.get(address) > this.THRESHOLD_BLACKLIST
        const byScore = this.blacklist.get(remoteIP) > this.THRESHOLD_BLACKLIST
        if (worker !== undefined) {
            const byWorker = worker.invalid > this.THRESHOLD_BLACKLIST
            return byWorker || byScore || byAddress
        } else {
            return byAddress || byScore
        }
    }
    private giveWarnings(client: any, increment: number = 1) {
        const remoteIP = client.socket.remoteAddress
        const score = this.blacklist.get(remoteIP)
        const worker = this.mapWorker.get(client.id)
        if (worker !== undefined) {
            worker.invalid++
            if (this.isInvalidUser(worker.client)) { this.banInvalidUsers(worker.client) }
        } else {
            if (this.isInvalidUser(client)) { this.banInvalidUsers(client) }
        }
    }
    private checkDayoff(worker: IWorker) {
        if (worker.career > 0x7FFFFFFF) { worker.career = 0 }
        worker.career++
        if (worker.career % StratumServer.FREQ_DAY_OFF === 0) {
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
    private async newRound() {
        const rewardBase = await this.mongoServer.getRewardBase()
        this.mongoServer.resetWorkers()
        return rewardBase
    }
    private async patrolBlacklist() {
        const list = await this.mongoServer.getBlacklist()
        for (const item of list) {
            this.blacklist.set(item.key, item.score)
        }
        for (const [key, worker] of this.mapWorker) {
            if (this.isInvalidUser(worker.client, worker.address)) { this.giveWarnings(worker.client) }
        }
        setTimeout(() => {
            this.patrolBlacklist()
        }, this.INTEVAL_PATROL_BLACKLIST)
    }
    private async releaseData() {
        const workers: IWorkerCluster[] = []
        for (const w of this.mapWorker.values()) {
            const elapsed = Date.now() - w.tickLogin
            const worker: IWorkerCluster = {
                _id: getKey(w),
                address: w.address,
                alive: true,
                elapsed,
                elapsedStr: formatTime(elapsed),
                fee: w.hashshare * w.fee,
                hashrate: w.hashrate,
                hashshare: w.hashshare,
                ip: w.ip,
                reward: w.hashshare * (1 - w.fee),
                workerId: w.workerId,
            }
            workers.push(worker)
        }
        this.mongoServer.updateWorkers(workers)
        setTimeout(() => {
            this.releaseData()
        }, this.INTEVAL_RELEASE_DATA)
    }
}

export function genKey(ip: string, address: string, workerId: string) {
    return ip + "_" + address + "_" + workerId
}
export function getKey(worker: IWorker) {
    return (worker === undefined) ? undefined : worker.ip + "_" + worker.address + "_" + worker.workerId
}
export function parseKey(key: string) {
    return key.split("_").slice(0, 3)
}
function genPrehash(): Uint8Array {
    return new Uint8Array(randomBytes(64))
}
function getRandomIndex(): number {
    return Math.floor(Math.random() * 0xFFFFFF)
}
function checkAddress(address: string) {
    const isAddress = Address.isAddress(address)
    const isDonation = address === Banker.freeHyconAddr
    return (!isAddress || isDonation) ? Banker.freeMinerAddr : address
}
function checkWorkerId(clientId: string, workerId: string) {
    workerId = workerId.trim()
    return (workerId === "") ? clientId.slice(0, 12) : workerId.slice(0, 20)
}
function getNick(worker: IWorker): string {
    const round = Math.floor(worker.career / StratumServer.FREQ_DAY_OFF)
    return worker.address.slice(0, 8) + ":" + worker.client.id.slice(0, 6) + "(" + round + ") | "
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