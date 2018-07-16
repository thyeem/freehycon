import * as fs from "fs-extra"
import { getLogger } from "log4js"
import { IMiner, MinerStatus } from "./freehyconServer"
const logger = getLogger("PoolData")
interface IPoolData {
    poolHashrate: number
    minersCount: number
    miners: IPoolMiner[]
}
interface IPoolMiner {
    nodeCount: number
    address: string
    hashrate: number
}
export class PoolData {
    private readonly outFile = "freehycon.json"
    private minerMap: Map<string, IMiner>
    private walletMap: Map<string, IPoolMiner>
    constructor(minerMap: Map<string, IMiner>) {
        this.minerMap = minerMap
        this.walletMap = new Map<string, IPoolMiner>()
    }
    public async release(mined: number) {
        try {
            let poolHashrate = 0
            let workerHash = 0
            let worker = 0
            const minersCount = this.minerMap.size
            for (const [key, miner] of this.minerMap) {
                poolHashrate += miner.hashrate
                if (miner.status === MinerStatus.Working) {
                    workerHash += miner.hashrate
                    worker++
                }
                const mapQuery = this.walletMap.get(miner.address)
                if (mapQuery === undefined) {
                    const poolMiner: IPoolMiner = {
                        address: miner.address,
                        hashrate: miner.hashrate,
                        nodeCount: 1,
                    }
                    this.walletMap.set(miner.address, poolMiner)
                } else {
                    mapQuery.nodeCount++
                    mapQuery.hashrate += miner.hashrate
                }
            }

            const miners: IPoolMiner[] = Array.from(this.walletMap.values())
            miners.sort((a, b) => {
                return b.hashrate - a.hashrate
            })
            const data: IPoolData = {
                miners,
                minersCount,
                poolHashrate,
            }
            logger.warn(`${mined} blocks mined | total(${minersCount}): ${poolHashrate.toFixed(1)} H/s | working(${worker}): ${workerHash.toFixed(1)} H/s`)
            await fs.writeFileSync(this.outFile, JSON.stringify(data))
        } catch (e) {
            logger.warn(`failed to write/dump out the pool info: ${e}`)
        }
    }
}
