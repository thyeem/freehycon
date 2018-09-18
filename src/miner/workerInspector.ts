import { getLogger } from "log4js"
import { FC } from "./freehycon"
import { IJob } from "./stratumServer"
const logger = getLogger("Workernspector")
interface IJobTimer {
    start: number
    end: number
    lock: boolean
}
export class WorkerInspector {
    public readonly numJobBuffer: number = FC.NUM_JOB_BUFFER
    public jobId: number
    public alpha: number
    public targetTime: number
    public tEMA: number
    public pEMA: number
    public difficulty: number
    public medianTime: number
    public minDeltaTime: number
    public maxDeltaTime: number
    public submits: number
    public jobTimer: IJobTimer
    public mapJob: Map<number, IJob>
    public mapDemote: Map<number, NodeJS.Timer>
    public warning: number

    constructor(medianTime: number, difficulty: number, alpha: number) {
        this.jobId = 0
        this.medianTime = medianTime
        this.difficulty = difficulty
        this.alpha = alpha
        this.targetTime = this.medianTime / Math.LN2
        this.tEMA = this.targetTime
        this.pEMA = this.difficulty
        this.minDeltaTime = this.medianTime / Math.LN2 * FC.TOLERANCE_MIN_SIGMA_INSPECTOR
        this.maxDeltaTime = this.medianTime / Math.LN2 * FC.TOLERANCE_MAX_SIGMA_INSPECTOR
        this.jobTimer = { start: 0, end: 0, lock: false }
        this.mapJob = new Map<number, IJob>()
        this.mapDemote = new Map<number, NodeJS.Timer>()
        this.submits = 0
        this.warning = 0
    }
    public adjustDifficulty() {
        let timeDelta: number
        if (this.jobId === 1) {
            timeDelta = this.targetTime
        } else {
            timeDelta = this.jobTimer.end - this.jobTimer.start
            if (timeDelta <= 0) { timeDelta = this.targetTime }
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
        for (const [key, miner] of this.mapJob) { miner.solved = true }
    }
}
