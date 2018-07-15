import { getLogger } from "log4js"
import { IJob } from "./freehyconServer"
const logger = getLogger("MinerInspector")
export class MinerInspector {
    public readonly numJobBuffer: number = 10
    public readonly medianTime = 5000
    public readonly minDeltaTime = this.medianTime * 0.05
    public readonly maxDeltaTime = this.medianTime * 3
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

    constructor(difficulty: number, alpha: number) {
        this.jobId = 0
        this.alpha = alpha
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
        let timeDelta: number
        if (this.jobId === 1) {
            timeDelta = this.targetTime
        } else {
            timeDelta = this.timeJobComplete - this.timeJobStart
            if (timeDelta < this.minDeltaTime) { timeDelta = this.minDeltaTime }
            if (timeDelta > this.maxDeltaTime) { timeDelta = this.maxDeltaTime }
        }
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
