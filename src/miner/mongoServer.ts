import { Db, MongoClient } from "mongodb"
import { Block } from "../common/block"
import { IMinedBlocks, IPoolSumary, IWorkMan, IMiner } from "./dataCenter"
export class MongoServer {
    public static readonly timeoutPutWork = 200
    public static readonly timeoutSubmit = 200
    public static readonly timeoutPayWages = 30000
    public static readonly timeoutUpdateBlockStatus = 1800000
    public static readonly confirmations = 50
    //private url: string = "mongodb://localhost:27017"
    private url: string = "mongodb://172.31.20.102:27017"
    private dbName = "freehycon"
    private client: MongoClient
    private db: Db
    constructor() {
        this.init()
    }
    public async init() {
        this.client = await MongoClient.connect(this.url)
        this.db = this.client.db(this.dbName)
    }
    public async putWork(block: Block, prehash: Uint8Array) {
        const collection = this.db.collection(`Works`)
        const putWorkData = { block: block.encode(), prehash: Buffer.from(prehash) }
        await collection.remove({})
        await collection.insertOne(putWorkData)
    }
    public async pollingPutWork() {
        const returnRows: any[] = []
        if (this.db === undefined) { return returnRows }
        const collection = this.db.collection(`Works`)
        const rows = await collection.find({}).limit(10).toArray()
        for (const one of rows) {
            const block = Block.decode(one.block.buffer)
            const prehash = Buffer.from(one.prehash.buffer as Buffer)
            returnRows.push({ block, prehash })
        }
        return returnRows
    }
    public async submitBlock(block: Block, prehash: Uint8Array) {
        const collection = this.db.collection(`Submits`)
        const submit = { block: block.encode(), prehash: Buffer.from(prehash) }
        await collection.remove({})
        await collection.insertOne(submit)
    }
    public async pollingSubmitWork() {
        const returnRows: any[] = []
        if (this.db === undefined) { return returnRows }
        const collection = this.db.collection(`Submits`)
        const rows = await collection.find({}).limit(10).toArray()
        for (const one of rows) {
            collection.deleteOne({ _id: one._id })
            const block = Block.decode(one.block.buffer)
            const prehash = Buffer.from(one.prehash.buffer as Buffer)
            returnRows.push({ block, prehash })
        }
        return returnRows
    }
    public async addMinedBlock(block: IMinedBlocks) {
        const collection = this.db.collection(`MinedBlocks`)
        await collection.insertOne(block)
    }
    public async addSummary(summary: IPoolSumary) {
        const collection = this.db.collection(`PoolSummary`)
        await collection.remove({})
        await collection.insertOne(summary)
    }
    public async addMiners(miners: IMiner[]) {
        if (this.db === undefined) { return }
        if (miners.length > 0) {
            const collection = this.db.collection(`Miners`)
            await collection.remove({})
            await collection.insertMany(miners)
        }
    }
    public async addWorkers(workers: IWorkMan[]) {
        if (workers.length > 0) {
            const collection = this.db.collection(`Workers`)
            await collection.remove({})
            await collection.insertMany(workers)
        }
    }
    public async loadWorkers() {
        const returnRows: any[] = []
        if (this.db === undefined) { return returnRows }
        const collection = this.db.collection(`Workers`)
        const rows = await collection.find().toArray()
        for (const one of rows) { returnRows.push(one) }
        return returnRows
    }
    public async payWages(wageInfo: any) {
        const info = this.db.collection(`PayWages`)
        info.insertOne({
            blockHash: wageInfo.blockHash,
            rewardBase: wageInfo.rewardBase,
        })
    }
    public async pollingPayWages() {
        const returnRows: any[] = []
        if (this.db === undefined) { return returnRows }
        const collection = this.db.collection(`PayWages`)
        const rows = await collection.find({}).limit(100).toArray()
        for (const one of rows) { returnRows.push(one) }
        return returnRows
    }
    public async deletePayWage(payId: string) {
        const collection = this.db.collection(`PayWages`)
        collection.deleteOne({ _id: payId })
    }

    public async updateBlockStatus(blockhash: string, isMainchain: boolean) {
        const collection = this.db.collection(`MinedBlocks`)
        await collection.update({ hash: blockhash }, { $set: { mainchain: isMainchain } }, { upsert: false })
    }
    public async updateLastBlock(block: { height: number, blockHash: string, miner: string, ago: string }) {
        const collection = this.db.collection(`LastBlock`)
        await collection.remove({})
        await collection.insertOne(block)
    }

    public async getMinedBlocks(): Promise<any[]> {
        const collection = this.db.collection(`MinedBlocks`)
        const rows = await collection.find({}).limit(100).toArray()
        return rows
    }
    public async addDisconnections(disconnInfo: { address: string, workerId: string, timeStamp: number }) {
        if (disconnInfo === undefined) { return }
        const collection = this.db.collection(`Disconnections`)
        await collection.insertOne(disconnInfo)
    }
}
