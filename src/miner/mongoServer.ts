import { getLogger } from "log4js"
import { Db, MongoClient } from "mongodb"
import { ILastBlock, IMinedBlocks, IMinerCluster, IMinerReward, IPoolSumary, IWorkerCluster } from "./collector"
import { FC } from "./config"
import { IWorker, parseKey } from "./stratumServer"
const logger = getLogger("MongoServer")

export class MongoServer {
    public db: Db
    private url: string
    private client: MongoClient
    private dbName = "freehycon"

    constructor() {
        this.url = (FC.MODE_INSERVICE) ? FC.URL_MONGO_SERVICE : FC.URL_MONGO_DEBUG
        this.init()
    }
    public async init() {
        this.client = await MongoClient.connect(this.url)
        this.db = this.client.db(this.dbName)
    }

    public async resetWorkers() {
        const collection = this.db.collection(FC.MONGO_WORKERS)
        await collection.remove({})
    }
    public async findWorker(key: string): Promise<IWorker> {
        const collection = this.db.collection(FC.MONGO_WORKERS)
        const rows = await collection.find({ _id: key }).limit(1).toArray()
        let worker: IWorker
        if (rows.length === 1) { worker = convertToIWorker(rows[0]) }
        return worker
    }
    public async offWorker(key: string) {
        const [ip, address, workerId] = parseKey(key)
        let collection = this.db.collection(FC.MONGO_WORKERS)
        await collection.update({ _id: key }, { $set: { alive: false } })
        collection = this.db.collection(FC.MONGO_DISCONNECTIONS)
        await collection.insertOne({
            address,
            timestamp: Date.now(),
            workerId,
        })
    }
    public async updateWorkers(workers: IWorkerCluster[]) {
        if (workers.length < 1) { return }
        const collection = this.db.collection(FC.MONGO_WORKERS)
        for (const worker of workers) {
            await collection.update({ _id: worker._id }, worker, { upsert: true })
        }
    }
    public async cleanWorkers() {
        const collection = this.db.collection(FC.MONGO_WORKERS)
        await collection.find().forEach((doc) => {
            if (doc.alive === false) { collection.remove({ _id: doc._id }) }
        })
    }
    public async getWorkers(): Promise<IWorkerCluster[]> {
        const collection = this.db.collection(FC.MONGO_WORKERS)
        const rows = await collection.find().toArray()
        return rows
    }
    public async updateMiners(miners: IMinerCluster[]) {
        if (miners.length < 1) { return }
        const collection = this.db.collection(FC.MONGO_MINERS)
        await collection.remove({})
        await collection.insertMany(miners)
    }
    public async updateSummary(summary: IPoolSumary) {
        const collection = this.db.collection(FC.MONGO_POOL_SUMMARY)
        await collection.remove({})
        await collection.insertOne(summary)
    }
    public async updateRewardBase(rewardBase: IMinerReward[]) {
        if (rewardBase.length < 1) { return }
        const collection = this.db.collection(FC.MONGO_REWARD_BASE)
        await collection.remove({})
        await collection.insertMany(rewardBase)
    }
    public async getRewardBase(): Promise<IMinerReward[]> {
        const collection = this.db.collection(FC.MONGO_REWARD_BASE)
        const rows = await collection.find().toArray()
        return rows
    }
    public async addMinedBlock(block: IMinedBlocks) {
        const collection = this.db.collection(FC.MONGO_MINED_BLOCKS)
        await collection.insertOne(block)
    }
    public async addPayWage(payment: any) {
        const collection = this.db.collection(FC.MONGO_PAY_WAGES)
        const rows = await collection.find({ _id: payment.blockHash }).toArray()
        if (rows.length > 0) { return }
        await collection.insertOne(payment)
    }
    public async getPayWages() {
        const collection = this.db.collection(FC.MONGO_PAY_WAGES)
        const rows = await collection.find().toArray()
        return rows
    }
    public async deletePayWage(payId: string) {
        const collection = this.db.collection(FC.MONGO_PAY_WAGES)
        await collection.deleteOne({ _id: payId })
    }
    public async countPayWages() {
        const collection = this.db.collection(FC.MONGO_PAY_WAGES)
        return await collection.find().count()
    }
    public async updateBlockStatus(blockhash: string, isMainchain: boolean) {
        const collection = this.db.collection(FC.MONGO_MINED_BLOCKS)
        await collection.update({ _id: blockhash }, { $set: { mainchain: isMainchain } })
    }
    public async updateLastBlock(block: ILastBlock) {
        const collection = this.db.collection(FC.MONGO_LAST_BLOCK)
        await collection.remove({})
        await collection.insertOne(block)
    }
    public async getBlacklist() {
        const collection = this.db.collection(FC.MONGO_BLACKLIST)
        const rows = await collection.find().toArray()
        return rows
    }
}
function convertToIWorker(worker: IWorkerCluster): IWorker {
    const converted: IWorker = {
        address: worker.address,
        career: 0,
        client: undefined,
        fee: worker.fee,
        hashrate: 0,
        hashshare: worker.hashshare,
        inspector: undefined,
        invalid: 0,
        ip: worker.ip,
        status: undefined,
        tick: Date.now(),
        tickLogin: Date.now() - worker.elapsed,
        workerId: worker.workerId,
    }
    return converted
}
