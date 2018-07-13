import { randomBytes } from "crypto"
import { getLogger } from "log4js"
import Long = require("long")
import { Address } from "../common/address"
import { Block } from "../common/block"
import { BlockHeader } from "../common/blockHeader"
import { DifficultyAdjuster } from "../consensus/difficultyAdjuster"
import { Hash } from "../util/hash"
import { Banker } from "./banker"
import { MinerInspector } from "./minerInspector"
import { MinerServer } from "./minerServer"

// tslint:disable-next-line:no-var-requires
const LibStratum = require("stratum").Server
const logger = getLogger("FreeHyconServer")

enum MinerStatus {
    NotHired = 0,
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
export interface IMiner {
    socket: any
    address: string
    hashrate: number
    status: MinerStatus
    career: number
    inspector: MinerInspector
}

function genPrehash(): Uint8Array {
    return new Uint8Array(randomBytes(64))
}
function getRandomIndex(): number {
    return Math.floor(Math.random() * 0xFFFF)
}
function checkAddress(address: string) {
    const donation = "H2nVWAEBuFRMYBqUN4tLXfoHhc93H7KVP"
    return (Address.isAddress(address)) ? address : donation
}
function getNick(miner: IMiner): string {
    return miner.address.slice(0, 6) + ":" + miner.socket.id.slice(0, 4) + "(" + miner.career + ") | "
}
export function hexToLongLE(val: string): Long {
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
    private readonly numJobBuffer = 10
    private readonly diffcultyInspector = 0.005
    private readonly alphaInspector = 0.06
    private readonly medianTime = 5000
    private readonly freqDayoff = 5
    private readonly freqDist = 3
    private jobId: number
    private mined: number
    private minerServer: MinerServer
    private port: number
    private net: any = undefined
    private mapMiner: Map<string, IMiner>
    private mapJob: Map<number, IJob>

    constructor(minerServer: MinerServer, port: number = 9081) {
        logger.fatal(`FreeHycon Mining Server(FHMS) gets started.`)
        this.minerServer = minerServer
        this.port = port
        this.net = new LibStratum({ settings: { port: this.port } })
        this.mapJob = new Map<number, IJob>()
        this.mapMiner = new Map<string, IMiner>()
        this.jobId = 0
        this.mined = 0
        this.initialize()
        setInterval(() => this.dumpStatus(), 10000)
    }
    public dumpStatus() {
        let totalHashrate = 0
        let workerHash = 0
        let worker = 0
        for (const [key, miner] of this.mapMiner) {
            totalHashrate += miner.hashrate
            if (miner.status === MinerStatus.Working) {
                workerHash += miner.hashrate
                worker++
            }
        }
        logger.warn(`${this.mined} blocks mined | total(${this.mapMiner.size}): ${totalHashrate.toFixed(1)} H/s | working(${worker}): ${workerHash.toFixed(1)} H/s`)
    }
    public stop() {
        for (const [jobId, job] of this.mapJob) { job.solved = true }
    }
    public putWork(block: Block, prehash: Uint8Array) {
        try {
            const pubJob = this.newJob(block, prehash)
            for (const [key, miner] of this.mapMiner) {
                if (miner.socket === undefined) { continue }
                if (miner.status === MinerStatus.Working) {
                    this.notifyJob(miner.socket, getRandomIndex(), pubJob)
                    continue
                }
                if (miner.status === MinerStatus.OnInterview || miner.status === MinerStatus.Dayoff) {
                    this.putWorkOnInspector(miner)
                    continue
                }
            }
        } catch (e) {
            logger.error(`putWork failed: ${e}`)
        }
    }
    private initialize() {
        this.net.on("mining", async (req: any, deferred: any, socket: any) => {
            let miner = this.mapMiner.get(socket.id)
            if (miner === undefined) { miner = this.welcomeNewMiner(socket) }
            switch (req.method) {
                case "subscribe":
                    deferred.resolve([socket.id.toString(), "0", "0", 4])
                    break
                case "authorize":
                    const address = req.params[0]
                    logger.warn(`Authorizing miner id: ${address}`)
                    miner.address = checkAddress(address)
                    deferred.resolve([true])
                    if (miner.status === MinerStatus.NotHired) {
                        miner.status = MinerStatus.OnInterview
                        this.putWorkOnInspector(miner)
                    }
                    break
                case "submit":
                    const jobId = Number(req.params.job_id)
                    const job = (miner.status === MinerStatus.Working) ? this.mapJob.get(jobId) : miner.inspector.mapJob.get(jobId)
                    const nick = (miner.status === MinerStatus.Working) ? "" : getNick(miner)

                    if (job !== undefined && !job.solved) {
                        logger.fatal(`${nick}submit job(${req.params.job_id}): ${req.params.result}`)
                        let result = false
                        if (miner.status === MinerStatus.Working) {
                            result = await this.completeWork(jobId, req.params.nonce)
                            if (result) {
                                const banker = new Banker(this.minerServer, this.mapMiner)
                                banker.distributeIncome(240)
                            }
                        } else {  // MinerStatus.Dayoff & MinerStatus.Oninterview
                            result = await this.completeWork(jobId, req.params.nonce, miner)
                            if (!result) { break }
                            miner.inspector.adjustDifficulty()
                            miner.hashrate = 1.0 / (miner.inspector.difficulty * 0.001 * miner.inspector.targetTime)
                            if (miner.inspector.submits >= this.numProblems(miner)) {
                                miner.inspector.submits = 0
                                miner.status = MinerStatus.Working
                                break
                            }
                            this.putWorkOnInspector(miner)
                        }
                        deferred.resolve([result])
                    }
                    break
                default:
                    deferred.reject(LibStratum.errors.METHOD_NOT_FOUND)
            }
        })

        this.net.on("mining.error", (error: any, socket: any) => {
            logger.error("Mining error: ", error)
        })

        this.net.listen().done((msg: any) => {
            logger.fatal(msg)
        })

        this.net.on("close", (socketId: any) => {
            logger.debug(`Miner socket(${socketId}) closed `)
            this.mapMiner.delete(socketId)
        })
    }
    private welcomeNewMiner(socket: any): IMiner {
        logger.warn(`New miner socket(${socket.id}) connected`)
        const miner: IMiner = {
            address: "",
            career: 0,
            hashrate: 0,
            inspector: new MinerInspector(this.diffcultyInspector, this.alphaInspector, this.medianTime),
            socket,
            status: MinerStatus.NotHired,
        }
        this.mapMiner.set(socket.id, miner)
        return this.mapMiner.get(socket.id)
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
        logger.debug(`${nick}Created a new job(${id})`)
        return job
    }
    private notifyJob(socket: any, index: number, job: IJob, miner?: IMiner) {
        const nick = (miner !== undefined) ? getNick(miner) : ""
        if (socket === undefined) {
            logger.error(`${nick}undefined of the stratum socket:`)
            return
        }
        socket.notify([index, job.prehashHex, job.targetHex, job.id, "0", "0", "0", "0", true])
            .then(() => {
                logger.debug(`${nick}Put job(${job.id}): ${socket.id}`)
            }, () => {
                logger.error(`${nick}Put job failed: ${socket.id}`)
            },
        )
    }
    private putWorkOnInspector(miner: IMiner) {
        const newJob = this.newJob(fakeBlock, genPrehash(), miner)
        this.notifyJob(miner.socket, getRandomIndex(), newJob, miner)
        if (!miner.inspector.timeJobLock) {
            miner.inspector.timeJobStart = Date.now()
            miner.inspector.timeJobLock = true
        }
    }
    private async completeWork(jobId: number, nonceStr: string, miner?: IMiner): Promise<boolean> {
        try {
            const job = (miner !== undefined) ? miner.inspector.mapJob.get(jobId) : this.mapJob.get(jobId)
            const nick = (miner !== undefined) ? getNick(miner) : ""
            if (nonceStr.length !== 16) {
                logger.warn(`${nick}Invalid nonce: ${nonceStr}`)
                return false
            }
            if (job === undefined) {
                logger.warn(`${nick}Miner submitted unknown/old job(${jobId})`)
                return false
            }

            const nonce = hexToLongLE(nonceStr)
            const buffer = Buffer.allocUnsafe(72)
            buffer.fill(job.prehash, 0, 64)
            buffer.writeUInt32LE(nonce.getLowBitsUnsigned(), 64)
            buffer.writeUInt32LE(nonce.getHighBitsUnsigned(), 68)
            const cryptonightHash = await Hash.hashCryptonight(buffer)
            logger.debug(`${nick}nonce: ${nonceStr}, targetHex: ${job.targetHex}, target: ${job.target.toString("hex")}, hash: ${Buffer.from(cryptonightHash).toString("hex")}`)
            if (!DifficultyAdjuster.acceptable(cryptonightHash, job.target)) {
                logger.error(`${nick}nonce verification >> received incorrect nonce: ${nonce.toString()}`)
                return false
            }
            if (job.solved) {
                logger.debug(`${nick}Job(${job.id}) already solved`)
                return true
            }

            job.solved = true
            if (miner !== undefined) {
                miner.inspector.submits++
                miner.inspector.timeJobComplete = Date.now()
                miner.inspector.timeJobLock = false
                for (const [key, iminer] of miner.inspector.mapJob) { iminer.solved = true }
                logger.error(`${nick}estimated hashrate(${miner.inspector.submits}): ${miner.hashrate.toFixed(1)} H/s`)
            } else {
                const minedBlock = new Block(job.block)
                minedBlock.header.nonce = nonce
                for (const [key, iminer] of this.mapMiner) {
                    if (iminer.status === MinerStatus.Working) {
                        iminer.career++
                        if (iminer.career % this.freqDayoff === 0) { iminer.status = MinerStatus.Dayoff }
                    }
                }
                this.minerServer.submitBlock(minedBlock)
                this.mined++
            }
            return true
        } catch (e) {
            throw new Error(`Fail to submit nonce: ${e}`)
        }
    }
    private numProblems(miner: IMiner) {
        if (miner.career === 0) { return 100 }
        const dayoff = Math.floor(miner.career / this.freqDayoff)
        // return Math.max(4, 15 - Math.floor(Math.log(dayoff)))
        return 4
    }
}
