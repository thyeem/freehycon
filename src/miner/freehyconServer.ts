import { randomBytes } from "crypto"
import { getLogger } from "log4js"
import Long = require("long")
import { Address } from "../common/address"
import { Block } from "../common/block"
import { BlockHeader } from "../common/blockHeader"
import { DifficultyAdjuster } from "../consensus/difficultyAdjuster"
import { BlockStatus } from "../consensus/sync"
import { Hash } from "../util/hash"
import { Banker } from "./banker"
import { DataCenter, IMinerReward } from "./dataCenter"
//import { MinerInspector } from "./minerInspector"
//import { MinerServer } from "./minerServer"
import { MongoServer } from "./mongoServer"

// tslint:disable-next-line:no-var-requires
const LibStratum = require("stratum").Server
const logger = getLogger("FreeHyconServer")
export enum MinerStatus {
    OnInterview = 0,
    Dayoff = 1,
    Working = 2,
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
export interface IMiner {
    socket: any
    address: string
    fee: number
    hashrate: number
    hashshare: number
    status: MinerStatus
    career: number
    inspector: MinerInspector
    tick: number
    tickLogin: number
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
function getNick(miner: IMiner): string {
    const round = Math.floor(miner.career / FreeHyconServer.freqDayoff)
    return miner.address.slice(0, 8) + ":" + miner.socket.id.slice(0, 6) + "(" + round + ") | "
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
    public static readonly freqDayoff = 40
    private readonly diffcultyInspector = 0.0005
    private readonly alphaInspector = 0.06
    private readonly numJobBuffer = 10
    private readonly numInterviewProblems = 100
    private readonly numDayoffProblems = 4
    private jobId: number
    private port: number
    private mongoServer: MongoServer
    private stratum: any
    private mapMiner: Map<string, IMiner>
    private mapJob: Map<number, IJob>
    private dataCenter: DataCenter
    private ongoingJob: string

    constructor(mongoServer: MongoServer, port: number = 9081) {
        logger.fatal(`FreeHycon Mining Server(FHMS) gets started.`)
        this.mongoServer = mongoServer
        this.port = port
        this.stratum = new LibStratum({


            settings: { hostname: 'localhost', host: 'localhost', port: this.port, toobusy: 1000 }
        })
        this.mapJob = new Map<number, IJob>()
        this.mapMiner = new Map<string, IMiner>()
        this.dataCenter = new DataCenter(this.mongoServer)
        this.jobId = 0
        this.init()
        this.runPollingJob()
    }
    public runPollingJob() {
        this.pollingJob()
        setTimeout(() => { this.runPollingJob() }, 100)
    }
    public async pollingJob() {
        const foundWorks = await this.mongoServer.pollingPutWork()
        if (foundWorks.length > 0) {
            const found = foundWorks[0]
            const newPrehash = found.prehash.toString("hex")
            if (newPrehash !== this.ongoingJob) {
                this.ongoingJob = newPrehash
                await this.putWork(found.block, found.prehash)
                logger.warn(`Polling PutWork Prehash=${found.prehash.toString("hex").slice(0, 12)}`)
            }
        }
    }
    public putWork(block: Block, prehash: Uint8Array) {
        try {
            const newJob = this.newJob(block, prehash)
            for (const [key, miner] of this.mapMiner) {
                if (miner.socket === undefined) { continue }
                if (miner.status === MinerStatus.Working) {
                    if (this.checkDayoff(miner)) {
                        this.putWorkOnInspector(miner)
                    } else {
                        this.measureMiner(miner)
                        this.notifyJob(miner.socket, getRandomIndex(), newJob)
                    }
                    continue
                } else { // miner.status === (MinerStatus.Dayoff || MinerStatus.Oninterview)
                    this.putWorkOnInspector(miner)
                }
            }
        } catch (e) {
            logger.error(`putWork failed: ${e}`)
        }
    }
    public stop() {
        for (const [jobId, job] of this.mapJob) { job.solved = true }
    }
    public async putWorkOnInspector(miner: IMiner) {
        const newJob = this.newJob(fakeBlock, genPrehash(), miner)
        await this.notifyJob(miner.socket, getRandomIndex(), newJob, miner)
        if (!miner.inspector.jobTimer.lock) {
            miner.inspector.jobTimer.lock = true
            miner.inspector.jobTimer.start = Date.now()
        }
        // if (miner.status === MinerStatus.OnInterview) { miner.inspector.timerDemotion(this, miner, newJob.id) }
    }
    private init() {
        this.stratum.on("mining", async (req: any, deferred: any, socket: any) => {
            let miner = this.mapMiner.get(socket.id)
            if (miner === undefined) { miner = this.welcomeNewMiner(socket) }
            switch (req.method) {
                case "subscribe":
                    deferred.resolve([socket.id.toString(), "0", "0", 4])
                    break
                case "authorize":
                    const address = req.params[0]
                    const remoteIP = miner.socket.remoteAddress
                    const blacklist = this.dataCenter.blicklist.has(remoteIP)
                    if (blacklist) {
                        logger.warn(`Banned invalid miner: ${address} remoteIP: ${remoteIP}`)
                        // this.stratum.emit("close", socket.id)
                    } else {
                        logger.warn(`Authorizing miner: ${address}`)
                        miner.address = checkAddress(address)
                        this.putWorkOnInspector(miner)
                    }
                    deferred.resolve([true])
                    break
                case "submit":
                    const jobId = Number(req.params.job_id)
                    const isWorking: boolean = miner.status === MinerStatus.Working
                    const job = (isWorking) ? this.mapJob.get(jobId) : miner.inspector.mapJob.get(jobId)
                    const nick = (isWorking) ? "" : getNick(miner)
                    if (job === undefined || job.solved === true) { break }
                    logger.debug(`${nick}submit job(${req.params.job_id}): ${bufferToHexBE(Buffer.from(req.params.result, "hex"))}`)
                    let result = false
                    if (isWorking) {
                        result = await this.completeWork(jobId, req.params.nonce)
                    } else { // miner.status === (MinerStatus.Dayoff || MinerStatus.Oninterview)
                        miner.inspector.jobTimer.end = Date.now()
                        // if (miner.status === MinerStatus.OnInterview) { miner.inspector.clearDemotion() }
                        result = await this.completeWork(jobId, req.params.nonce, miner)
                        if (result) {
                            this.keepWorkingTest(miner)
                        }
                    }
                    deferred.resolve([result])
                    break
                default:
                    deferred.reject(LibStratum.errors.METHOD_NOT_FOUND)
            }
        })
        this.stratum.on("mining.error", (error: any, socket: any) => {
            logger.error("Mining error: ", error)
        })
        this.stratum.on("close", (socketId: any) => {
            const miner = this.mapMiner.get(socketId)
            if (miner !== undefined) {
                logger.error(`Miner socket closed: ${miner.address} (${socketId})`)
                this.mapMiner.delete(socketId)
            }
        })
        this.stratum.listen().done((msg: any) => {
            logger.fatal(msg)
        })
        this.releaseData()
        this.dataCenter.clearBlacklist()
    }
    private newJob(block: Block, prehash: Uint8Array, miner?: IMiner): IJob {
        const nick = (miner !== undefined) ? getNick(miner) : ""
        let id = (miner !== undefined) ? miner.inspector.jobId : this.jobId
        if (id > 0x7FFFFFFF) { id = 0 }
        if (miner !== undefined) {
            miner.inspector.jobId = ++id
            miner.inspector.mapJob.delete(id - miner.inspector.numJobBuffer)
        } else {
            this.jobId = ++id
            this.mapJob.delete(id - this.numJobBuffer)
        }
        const prehashHex = Buffer.from(prehash as Buffer).toString("hex")
        const difficulty = (miner !== undefined) ? miner.inspector.difficulty : block.header.difficulty
        const target = DifficultyAdjuster.getTarget(difficulty, 32)
        const targetHex = DifficultyAdjuster.getTarget(difficulty, 8).toString("hex")
        const job = { block, id, prehash, prehashHex, solved: false, target, targetHex }

        if (miner !== undefined) {
            miner.inspector.mapJob.set(miner.inspector.jobId, job)
        } else {
            this.mapJob.set(this.jobId, job)
        }
        logger.debug(`${nick}Created a new job(${id}): ${bufferToHexBE(job.target)}`)
        return job
    }
    private async notifyJob(socket: any, index: number, job: IJob, miner?: IMiner) {
        const nick = (miner !== undefined) ? getNick(miner) : ""
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
    private async completeWork(jobId: number, nonceStr: string, miner?: IMiner): Promise<boolean> {
        try {
            const job = (miner !== undefined) ? miner.inspector.mapJob.get(jobId) : this.mapJob.get(jobId)
            const nick = (miner !== undefined) ? getNick(miner) : ""
            if (job === undefined) { return false }

            const nonce = hexToLongLE(nonceStr)
            const nonceCheck = await MinerServer.checkNonce(job.prehash, nonce, -1, job.target)
            if (!nonceCheck) {
                const remoteIP = miner.socket.remoteAddress
                const socketId = miner.socket.id
                const address = miner.socket.address
                try {
                    this.stratum.closeConnection(socketId)
                } catch (e) {
                    logger.error(`${nick}received incorrect nonce: ${nonce.toString()}`)
                    logger.warn(`Banned invalid miner: ${address} remoteIP: ${remoteIP}`)
                }
                this.mapMiner.delete(socketId)
                this.dataCenter.blicklist.add(remoteIP)
                return false
            }
            job.solved = true
            if (miner !== undefined) { // working on testing job
                miner.inspector.submits++
                miner.inspector.stop()
                miner.inspector.jobTimer.lock = false
                logger.error(`${nick}estimated hashrate(${miner.inspector.submits}): ${miner.hashrate.toFixed(1)} H/s`)
            } else { // when working on actual job
                const minedBlock = new Block(job.block)
                minedBlock.header.nonce = nonce
                this.mongoServer.submitBlock(minedBlock, minedBlock.header.preHash())
                this.stop()
                const { miners, rewardBase, roundHash } = this.newRound()
                const blockHash = new Hash(minedBlock.header)
                this.mongoServer.payWages({ blockHash: blockHash.toString(), rewardBase, roundHash })
            }
            return true
        } catch (e) {
            logger.error(`Fail to submit nonce: ${e}`)
        }
    }
    private keepWorkingTest(miner: IMiner) {
        miner.inspector.adjustDifficulty()
        this.measureMiner(miner)
        if (this.checkWorkingDay(miner)) {
            const resumeJob = this.mapJob.get(this.jobId)
            this.notifyJob(miner.socket, getRandomIndex(), resumeJob)
            return
        }
        this.putWorkOnInspector(miner)
    }
    private measureMiner(miner: IMiner) {
        const prevTick = miner.tick
        const prevHashrate = miner.hashrate
        miner.tick = Date.now()
        miner.hashrate = 1.0 / (miner.inspector.difficulty * 0.001 * miner.inspector.targetTime)
        miner.hashshare += 0.5 * (prevHashrate + miner.hashrate) * 0.001 * (miner.tick - prevTick)
        miner.fee = getDecayedFee(miner.tick - miner.tickLogin)
    }
    private welcomeNewMiner(socket: any): IMiner {
        logger.warn(`New miner socket(${socket.id}) connected`)
        const miner: IMiner = {
            address: "",
            career: 0,
            fee: 0.029,
            hashrate: 0,
            hashshare: 0,
            inspector: new MinerInspector(this.diffcultyInspector, this.alphaInspector),
            socket,
            status: MinerStatus.OnInterview,
            tick: Date.now(),
            tickLogin: Date.now(),
        }
        this.mapMiner.set(socket.id, miner)
        return this.mapMiner.get(socket.id)
    }
    private checkDayoff(miner: IMiner) {
        if (miner.career > 0x7FFFFFFF) { miner.career = 0 }
        miner.career++
        if (miner.career % FreeHyconServer.freqDayoff === 0) {
            miner.status = MinerStatus.Dayoff
            return true
        }
        return false
    }
    private checkWorkingDay(miner: IMiner) {
        const problems = (miner.career === 0) ? this.numInterviewProblems : this.numDayoffProblems
        if (miner.inspector.submits >= problems) {
            miner.inspector.submits = 0
            miner.status = MinerStatus.Working
            return true
        }
        return false
    }
    private newRound() {
        const miners = Array.from(this.mapMiner.values()).slice()
        this.dataCenter.updateMinerInfo(miners)
        const roundHash = this.dataCenter.poolHashshare
        const rewardBase = new Map(this.dataCenter.rewardBase)
        this.dataCenter.minerG.clear()
        this.dataCenter.rewardBase.clear()
        for (const [key, miner] of this.mapMiner) { miner.hashshare = 0 }
        return { miners, rewardBase, roundHash }
    }
    private async releaseData() {
        const miners = Array.from(this.mapMiner.values())
        this.dataCenter.release(miners)
        setTimeout(async () => {
            this.releaseData()
        }, 10000)
    }
}
