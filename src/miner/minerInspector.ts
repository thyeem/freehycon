import { getLogger } from "log4js"
import { IJob } from "./freehyconServer"
const logger = getLogger("MinerInspector")
export class MinerInspector {
    public readonly numJobBuffer: number = 10
    public medianTime: number
    public alpha: number
    public targetTime: number
    public tEMA: number
    public pEMA: number
    public difficulty: number
    public jobId: number
    public submits: number
    public timeJobStart: number
    public timeJobComplete: number
    public timeJobLock: boolean
    public mapJob: Map<number, IJob>

    constructor(difficulty: number, alpha: number, medianTime: number) {
        this.jobId = 0
        this.alpha = alpha
        this.medianTime = medianTime
        this.targetTime = this.medianTime / Math.LN2
        this.difficulty = difficulty
        this.tEMA = this.targetTime
        this.pEMA = this.difficulty
        this.timeJobLock = false
        this.timeJobStart = 0
        this.timeJobComplete = 0
        this.mapJob = new Map<number, IJob>()
        this.submits = 0
    }
    public adjustDifficulty() {
        const timeDelta = (this.jobId === 1) ? this.targetTime : this.timeJobComplete - this.timeJobStart
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
    public stop() {
        for (const [key, miner] of this.mapJob) {
            miner.solved = true
        }
    }
}
