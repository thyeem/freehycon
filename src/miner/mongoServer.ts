import { Db, MongoClient } from "mongodb"
import { Block } from "../common/block"
import { IMinedBlocks, IPoolMiner } from "./dataCenter"
export class MongoServer {
    public static readonly timeoutPutWork = 1000
    public static readonly timeoutSubmit = 1000
    public static readonly timeoutPayWages = 10000
    public static readonly timeoutUpdateBlockStatus = 1800000
    public static readonly confirmations = 50
    private url: string = "mongodb://localhost:27017"
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
    public async addMiners(minersInfo: IPoolMiner) {
        if (this.db === undefined) { return }
        const info = this.db.collection(`InfoPool`)
        await info.remove({})
        await info.insertOne({
            minersCount: minersInfo.minersCount,
            poolHashrate: minersInfo.poolHashrate,
            poolHashshare: minersInfo.poolHashshare,
        })
        if (minersInfo.minerGroups.length > 0) {
            const miners = this.db.collection(`MinerGroups`)
            await miners.remove({})
            await miners.insertMany(minersInfo.minerGroups)
        }
    }
    public async loadMiners() {
        const returnRows: any[] = []
        if (this.db === undefined) { return returnRows }
        const collection = this.db.collection(`MinerGroups`)
        const rows = await collection.find({}).limit(1000).toArray()
        for (const one of rows) { returnRows.push(one) }
        return returnRows
    }
    public async payWages(wageInfo: any) {
        const info = this.db.collection(`PayWages`)
        info.insertOne({
            blockHash: wageInfo.blockHash,
            rewardBase: wageInfo.rewardBase,
            roundHash: wageInfo.roundHash,
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

    public async getMinedBlocks(): Promise<any[]> {
        const collection = this.db.collection(`MinedBlocks`)
        const rows = await collection.find({}).limit(100).toArray()
        return rows
    }
}
