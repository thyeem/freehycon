import { IMiner, MinerStatus } from "./freehyconServer"

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
    private data: IPoolData
    private minerMap: Map<string, IMiner>
    private walletMap: Map<string, IPoolMiner>
    constructor(minerMap: Map<string, IMiner>) {
        this.minerMap = minerMap
        this.walletMap = new Map<string, IPoolMiner>()
        this.data = { poolHashrate: 0, minersCount: 0, miners: [] }
    }
    public dumpInfo() {
        let totalHashrate = 0
        const minersCount = this.minerMap.size
        for (const [key, miner] of this.minerMap) {
            totalHashrate += miner.hashrate
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
    }
}
