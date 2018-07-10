import { getLogger } from "log4js"
import Long = require("long")
import { Block } from "../common/block"
import { Hash } from "../util/hash"
import { hexToLongLE, IJob, IMiner } from "./freehyconServer"

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
    public jobId: number
    public mapJob: Map<number, IJob>
    public dynamic: boolean

    constructor(difficulty: number, alpha: number, dynamic: boolean) {
        this.jobId = 0
        this.alpha = alpha
        this.targetTime = this.medianTime / Math.LN2
        this.difficulty = difficulty
        this.tEMA = this.targetTime
        this.pEMA = this.difficulty
        this.tJobStart = 0
        this.tJobEnd = 0
        this.mapJob = new Map<number, IJob>()
        this.dynamic = dynamic
    }
    public adjustDifficulty(): number {
        const timeDelta = (this.jobId === 1) ? this.targetTime : this.tJobEnd - this.tJobStart
        const tEMA = this.calcEMA(timeDelta, this.tEMA)
        const pEMA = this.calcEMA(this.difficulty, this.pEMA)
        const nextDifficulty = (tEMA * pEMA) / this.targetTime
        this.tEMA = tEMA
        this.pEMA = pEMA
        this.difficulty = nextDifficulty
        if (this.dynamic) {
            this.alpha -= 0.0015
            if (this.alpha < 0.01) { this.alpha = 0.01 }
        }
        return nextDifficulty
    }
    public calcEMA(newValue: number, previousEMA: number) {
        const newEMA = this.alpha * newValue + (1 - this.alpha) * previousEMA
        return newEMA
    }
}
