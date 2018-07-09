import { getLogger } from "log4js"
import Long = require("long")
import { Block } from "../common/block"
import { Hash } from "../util/hash"
import { IJob, IMiner } from "./freehyconServer"

const logger = getLogger("MinerInspector")
export class MinerInspector {
    public readonly medianTime: number = 10000
    public readonly numJobBuffer: number = 10
    public alpha: number
    public targetTime: number
    public tEMA: number
    public pEMA: number
    public tJobStart: number
    public tJobEnd: number
    public difficulty: number
    // public onJob: IJob
    public jobId: number
    public nick: string
    public mapJob: Map<number, IJob>

    constructor() {
        this.jobId = 0
        this.alpha = 0.1
        this.targetTime = this.medianTime / Math.LN2
        this.tEMA = this.targetTime
        this.pEMA = 0.01
        this.difficulty = 0.01
        this.tJobStart = 0
        this.tJobEnd = 0
        this.mapJob = new Map<number, IJob>()
    }

    public adjustDifficulty(): number {
        const timeDelta = (this.jobId === 1) ? this.targetTime : this.tJobEnd - this.tJobStart
        const tEMA = this.calcEMA(timeDelta, this.tEMA)
        const pEMA = this.calcEMA(this.difficulty, this.pEMA)
        const nextDifficulty = (tEMA * pEMA) / this.targetTime
        if (this.alpha <= 0.01) {
            this.alpha = 0.01
        } else {
            this.alpha -= 0.00125
        }
        this.tEMA = tEMA
        this.pEMA = pEMA
        this.difficulty = nextDifficulty
        return nextDifficulty
    }
    public calcEMA(newValue: number, previousEMA: number) {
        const newEMA = this.alpha * newValue + (1 - this.alpha) * previousEMA
        return newEMA
    }

    public getTarget(p: number, length: number = 32) {
        if (p > 1) {
            logger.warn(`Difficulty(${p.toExponential()}) is too low, anything is possible.`)
            p = 1
        }
        if (p < Math.pow(0x100, -length)) {
            logger.warn(`Difficulty(${p.toExponential()}) is too high, give up now.`)
            p = Math.pow(0x100, -length)
        }
        const target = Buffer.alloc(length)
        let carry = 0
        for (let i = length - 1; i >= 0; i--) {
            carry = (0x100 * carry) + (p * 0xFF)
            target[i] = Math.floor(carry)
            carry -= target[i]
        }
        return target
    }

    public acceptable(hash: Uint8Array | Hash, target: Uint8Array): boolean {
        if (!(hash instanceof Hash) && hash.length !== 32) {
            throw new Error(`Expected 32 byte hash, got ${hash.length} bytes`)
        }
        for (let i = 31; i >= 0; i--) {
            if (hash[i] < target[i]) {
                return true
            }
            if (hash[i] > target[i]) {
                return false
            }
        }
        return true
    }
    public newInternJob(block: Block, prehash: Uint8Array, difficulty: number): IJob {
        this.jobId++
        this.mapJob.delete(this.jobId - this.numJobBuffer)
        const prehashHex = Buffer.from(prehash as Buffer).toString("hex")
        const target = this.getTarget(difficulty, 32)
        const targetHex = this.getTarget(difficulty, 8).toString("hex")
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
        logger.fatal(`Intern(${this.nick}) created a new job(${job.id})`)
        return job
    }
    public notifyInternJob(socket: any, index: number, job: IJob) {
        if (socket === undefined) {
            logger.error(`Intern(${this.nick}) undefined of the stratum socket:`)
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
                this.tJobStart = Date.now()
                logger.fatal(`Intern(${this.nick}) put job(${job.id}): ${socket.id}`)
            },
            () => {
                logger.error(`Intern(${this.nick}) put job failed: ${socket.id}`)
            },
        )
    }

    public async completeWork(jobId: number, nonceStr: string): Promise<boolean> {
        try {
            if (nonceStr.length !== 16) {
                logger.warn(`Intern(${this.nick}) invalid nonce: ${nonceStr}`)
                return false
            }

            const job = this.mapJob.get(jobId)
            if (job === undefined) {
                logger.warn(`Intern(${this.nick}) miner submitted unknown/old job(${jobId})`)
                return false
            }

            const nonce = this.hexToLongLE(nonceStr)
            const buffer = Buffer.allocUnsafe(72)
            buffer.fill(job.prehash, 0, 64)
            buffer.writeUInt32LE(nonce.getLowBitsUnsigned(), 64)
            buffer.writeUInt32LE(nonce.getHighBitsUnsigned(), 68)
            const cryptonightHash = await Hash.hashCryptonight(buffer)
            logger.fatal(`nonce: ${nonceStr}, targetHex: ${job.targetHex}, target: ${job.target.toString("hex")}, hash: ${Buffer.from(cryptonightHash).toString("hex")}`)
            if (!this.acceptable(cryptonightHash, job.target)) {
                logger.error(`Intern(${this.nick}) nonce verification >> received incorrect nonce: ${nonce.toString()}`)
                return false
            }

            if (job.solved) {
                logger.fatal(`Intern(${this.nick}) job(${job.id}) already solved`)
                return true
            }
            job.solved = true
            this.tJobEnd = Date.now()
            logger.error(`Estimated hashrate: ${(1.0 / (this.difficulty * 0.001 * this.medianTime)).toFixed(4)} H/s`)
            logger.error(`difficulty alpha: ${this.alpha}`)
            return true
        } catch (e) {
            throw new Error(`Intern(${this.nick}) Fail to submit nonce: ${e}`)
        }
    }
    public setNick(miner: IMiner) {
        this.nick = miner.address.slice(0, 6) + ":" + miner.socket.id.slice(0, 6)
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
