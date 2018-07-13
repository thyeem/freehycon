import { getLogger } from "log4js"
import Long = require("long")
import { Block } from "../common/block"
import { Hash } from "../util/hash"
import { hexToLongLE, IJob, IMiner } from "./freehyconServer"

const logger = getLogger("MinerInspector")
export class MinerInspector {
    public readonly medianTime: number = 5000
    public readonly numJobBuffer: number = 10
    public alpha: number
    public targetTime: number
    public tEMA: number
    public pEMA: number
    public timeJobComplete: number
    public difficulty: number
    public jobId: number
    public mapJob: Map<number, IJob>
    public submits: number

    constructor(difficulty: number, alpha: number) {
        this.jobId = 0
        this.alpha = alpha
        this.targetTime = this.medianTime / Math.LN2
        this.difficulty = difficulty
        this.tEMA = this.targetTime
        this.pEMA = this.difficulty
        this.timeJobComplete = 0
        this.mapJob = new Map<number, IJob>()
        this.submits = 0
    }
    public adjustDifficulty(timeJobStart: number) {
        const timeDelta = (this.jobId === 1) ? this.targetTime : this.timeJobComplete - timeJobStart
        const tEMA = this.calcEMA(timeDelta, this.tEMA)
        const pEMA = this.calcEMA(this.difficulty, this.pEMA)
        const nextDifficulty = (tEMA * pEMA) / this.targetTime
        this.tEMA = tEMA
        this.pEMA = pEMA
        this.difficulty = nextDifficulty
    }
    public calcEMA(newValue: number, previousEMA: number) {
        const newEMA = this.alpha * newValue + (1 - this.alpha) * previousEMA
        return newEMA
    }
}
