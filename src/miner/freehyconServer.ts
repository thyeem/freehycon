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
    Applied = -1,
    OnInterview = 0,
    Hired = 1,
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
    inspector: MinerInspector
}

function genPrehash(): Uint8Array {
    return new Uint8Array(randomBytes(64))
}
function getRandomIndex(): number {
    return Math.floor(Math.random() * 0x1FFFFFFF)
}
function checkAddress(address: string) {
    const donation = "H2nVWAEBuFRMYBqUN4tLXfoHhc93H7KVP"
    return (Address.isAddress(address)) ? address : donation
}

const fakeBlock = new Block({
    header: new BlockHeader({
        difficulty: 0.01,
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
    private readonly nProblems = 180
    private jobId: number
    private worker: number
    private minerServer: MinerServer
    private port: number
    private net: any = undefined
    private mapMiner: Map<string, IMiner>
    private mapJob: Map<number, IJob>
    private mapHashrate: Map<string, number>

    constructor(minerServer: MinerServer, port: number = 9081) {
        logger.fatal(`FreeHycon Mining Server(FHMS) gets started.`)
        this.minerServer = minerServer
        this.port = port
        this.net = new LibStratum({ settings: { port: this.port } })
        this.mapJob = new Map<number, IJob>()
        this.mapMiner = new Map<string, IMiner>()
        this.mapHashrate = new Map<string, number>()
        this.jobId = 0
        this.worker = 0
        this.initialize()
        setInterval(() => this.dumpStatus(), 10000)
    }
    public dumpStatus() {
        let totalHashrate: number = 0
        for (const [address, hashrate] of this.mapHashrate) {
            totalHashrate += hashrate
        }
        logger.fatal(`Total Hashrate: ${totalHashrate.toFixed(4)} H/s | Miners [working / total]: ${this.worker} / ${this.mapMiner.size}`)
    }
    public stop() {
        for (const [jobId, job] of this.mapJob) {
            job.solved = true
            this.mapJob.set(jobId, job)
        }
    }
    public putWork(block: Block, prehash: Uint8Array) {
        try {
            if (this.worker > 0) {
                const job = this.newJob(block, prehash)
                this.mapMiner.forEach((miner, key, map) => {
                    if (miner.socket !== undefined && miner.status === MinerStatus.Hired) {
                        this.notifyJob(miner.socket, getRandomIndex(), job)
                    }
                })
            }
        } catch (e) {
            logger.error(`putWork failed: ${e}`)
        }
    }
    private initialize() {
        this.net.on("mining", async (req: any, deferred: any, socket: any) => {
            let miner = this.mapMiner.get(socket.id)
            let job: IJob
            if (miner === undefined) {
                logger.fatal(`New miner socket(${socket.id}) connected`)
                const newMiner: IMiner = {
                    address: "",
                    hashrate: 0,
                    inspector: new MinerInspector(),
                    socket,
                    status: MinerStatus.Applied,
                }
                this.mapMiner.set(socket.id, newMiner)
            }

            switch (req.method) {
                case "subscribe":
                    deferred.resolve([
                        socket.id.toString(),
                        "0",
                        "0",
                        4,
                    ])
                    break
                case "authorize":
                    const address = req.params[0]
                    logger.fatal(`Authorizing miner id: ${address}`)
                    miner = this.mapMiner.get(socket.id)
                    miner.address = checkAddress(address)
                    this.mapMiner.set(socket.id, miner)
                    miner.inspector.setNick(miner)
                    deferred.resolve([true])

                    if (miner.status < MinerStatus.Hired) {
                        miner.status = MinerStatus.OnInterview
                        job = miner.inspector.newInternJob(fakeBlock, genPrehash(), miner.inspector.difficulty)
                        miner.inspector.notifyInternJob(miner.socket, getRandomIndex(), job)
                    }
                    if (miner.status === MinerStatus.Hired) {
                        job = this.mapJob.get(this.jobId)
                        if (job !== undefined) {
                            this.notifyJob(socket, getRandomIndex(), job)
                        }
                    }
                    break
                case "submit":
                    const jobId: number = Number(req.params.job_id)
                    if (miner.status === MinerStatus.OnInterview) {
                        job = miner.inspector.mapJob.get(jobId)
                        if (job !== undefined && !job.solved) {
                            logger.warn(`Intern(${miner.inspector.nick}) submit job id: ${req.params.job_id} / nonce: ${req.params.nonce} / result: ${req.params.result}`)
                            let result = false
                            result = await miner.inspector.completeWork(jobId, req.params.nonce)
                            if (result) {
                                if (miner.inspector.jobId === this.nProblems) {
                                    const hashrate = 1.0 / (miner.inspector.difficulty * 0.001 * miner.inspector.medianTime)
                                    this.updateMinerInfo(socket.id, false, hashrate)
                                    miner.status = MinerStatus.Hired
                                    miner.inspector = null
                                    break
                                }
                                const nextDifficulty = miner.inspector.adjustDifficulty()
                                job = miner.inspector.newInternJob(fakeBlock, genPrehash(), nextDifficulty)
                                miner.inspector.notifyInternJob(miner.socket, getRandomIndex(), job)
                            }
                            deferred.resolve([result])
                        }
                    }
                    if (miner.status === MinerStatus.Hired) {
                        job = this.mapJob.get(jobId)
                        if (job !== undefined && !job.solved) {
                            logger.warn(`Submit job id: ${req.params.job_id} / nonce: ${req.params.nonce} / result: ${req.params.result}`)
                            let result = false
                            result = await this.completeWork(jobId, req.params.nonce)
                            deferred.resolve([result])
                        }
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
            logger.fatal(`Miner socket(${socketId}) closed `)
            this.updateMinerInfo(socketId, true)
            this.mapMiner.delete(socketId)
        })
    }

    private updateMinerInfo(socketId: string, remove: boolean, hashrate?: number) {
        const miner = this.mapMiner.get(socketId)
        if (miner !== undefined) {
            if (hashrate !== undefined) {
                let hashrateSofar = this.mapHashrate.get(miner.address)
                hashrateSofar = (hashrateSofar !== undefined) ? hashrateSofar + hashrate : hashrate
                this.mapHashrate.set(miner.address, hashrateSofar)
            }
            if (remove === true && miner.status === MinerStatus.Hired) {
                this.worker--
            }
            if (remove === false && miner.status < MinerStatus.Hired) {
                this.worker++
            }
        }
    }
    private newJob(block: Block, prehash: Uint8Array): IJob {
        this.jobId++
        if (this.jobId > 0x7FFFFFFF) { this.jobId = 0 }
        this.mapJob.delete(this.jobId - this.numJobBuffer)
        const prehashHex = Buffer.from(prehash as Buffer).toString("hex")
        const target = DifficultyAdjuster.getTarget(block.header.difficulty, 32)
        const targetHex = DifficultyAdjuster.getTarget(block.header.difficulty, 8).toString("hex")
        const job = {
            block,
            id: this.jobId,
            prehash,
            prehashHex,
            solved: false,
            target,
            targetHex,
        }
        this.mapJob.set(this.jobId, job)
        logger.warn(`Created a new job(${this.jobId})`)
        // debugging
        // for (const [key, val] of this.mapJob) { logger.warn(`JobId: ${key}, target: ${val.targetHex}, solved: ${val.solved}`) }
        // for (const [key, val] of this.mapMiner) { logger.warn(`socketId: ${key}, address: ${val.address}`) }
        return job
    }
    private notifyJob(socket: any, index: number, job: IJob) {
        if (socket === undefined) {
            logger.error("(job) undefined of the stratum socket:")
            return
        }
        socket.notify([
            index,
            job.prehashHex,
            job.targetHex,
            job.id,
            "0",
            "0",
            "0",
            "0",
            true,
        ]).then(
            () => {
                logger.fatal(`Put job(${job.id}): ${socket.id}`)
            },
            () => {
                logger.error(`Put job failed: ${socket.id}`)
            },
        )
    }
    private async completeWork(jobId: number, nonceStr: string): Promise<boolean> {
        try {
            if (nonceStr.length !== 16) {
                logger.warn(`Invalid nonce: ${nonceStr}`)
                return false
            }

            const job = this.mapJob.get(jobId)
            if (job === undefined) {
                logger.warn(`Miner submitted unknown/old job(${jobId})`)
                return false
            }

            const nonce = this.hexToLongLE(nonceStr)
            const buffer = Buffer.allocUnsafe(72)
            buffer.fill(job.prehash, 0, 64)
            buffer.writeUInt32LE(nonce.getLowBitsUnsigned(), 64)
            buffer.writeUInt32LE(nonce.getHighBitsUnsigned(), 68)
            const cryptonightHash = await Hash.hashCryptonight(buffer)
            logger.fatal(`nonce: ${nonceStr}, targetHex: ${job.targetHex}, target: ${job.target.toString("hex")}, hash: ${Buffer.from(cryptonightHash).toString("hex")}`)
            if (!DifficultyAdjuster.acceptable(cryptonightHash, job.target)) {
                logger.error(`nonce verification >> received incorrect nonce: ${nonce.toString()}`)
                return false
            }

            if (job.solved) {
                logger.fatal(`Job(${job.id}) already solved`)
                return true
            }

            job.solved = true
            this.mapJob.set(job.id, job)

            const minedBlock = new Block(job.block)
            minedBlock.header.nonce = nonce
            this.minerServer.submitBlock(minedBlock)

            // income distribution
            // const banker = new Banker(this.minerServer, new Map(this.mapHashrate))
            // banker.distributeIncome(240)
            return true
        } catch (e) {
            throw new Error(`Fail to submit nonce: ${e}`)
        }
    }
    private hexToLongLE(val: string): Long {
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

}
