import { Db, MongoClient } from "mongodb"
import { Block } from "../common/block"
import { Hash } from "../util/hash"
export class MongoServer {
    private url: string = "mongodb://localhost:27017"
    private dbName = "freehycon"
    private maxCountPerQuery = 10

    private client: MongoClient
    private db: Db
    constructor() {
        this.initialize()
    }
    public async initialize() {
        this.client = await MongoClient.connect(this.url)
        this.db = this.client.db(this.dbName)
    }
    public async  putWork(block: Block, prehash: Uint8Array) {
        const collection = this.db.collection(`Works`)
        const jsonInfo = { block: JSON.stringify(block), prehash: JSON.stringify(prehash) }
        const putWorkData = { block: block.encode(), prehash: Buffer.from(prehash), info: jsonInfo }
        await collection.remove({})
        await collection.insertOne(putWorkData)
    }
    public async pollingPutWork(): Promise<any[]> {
        const collection = this.db.collection(`Works`)
        const rows = await collection.find({}).limit(this.maxCountPerQuery).toArray()
        const returnRows = []
        for (const one of rows) {
            const block = Block.decode(one.block.buffer)
            const prehash = Buffer.from(one.prehash.buffer as Buffer)
            returnRows.push({ block, prehash })

        }
        return returnRows
    }
    public async submitBlock(block: Block, prehash: Uint8Array) {
        const collection = this.db.collection(`Submits`)
        const submit = { block: block.encode(), prehash: Buffer.from(prehash), info: JSON.stringify(block) }
        await collection.insertOne(submit)
    }
    public async pollingSubmitWork(): Promise<any[]> {
        const collection = this.db.collection(`Submits`)
        const rows = await collection.find({}).limit(1000).toArray()
        const returnRows = []
        for (const one of rows) {
            collection.deleteOne({ _id: one._id })
            const block = Block.decode(one.block.buffer)
            const prehash = Buffer.from(one.prehash.buffer as Buffer)
            returnRows.push({ block, prehash })

        }
        return returnRows
    }

    public async addMinedBlock(block: Block) {
        const collection = this.db.collection(`MinedBlocks`)
        const mined = { block: block.encode(), info: JSON.stringify(block) }
        await collection.insertOne(mined)
    }
    public async writeMiners(minersInfo: any) {
        if (this.db === undefined) { return }
        const info = this.db.collection(`Info`)
        await info.remove({})
        await info.insertOne({
            minersCount: minersInfo.minersCount,
            poolHashrate: minersInfo.poolHashrate,
            poolHashshare: minersInfo.poolHashshare,
        })
        const miners = this.db.collection(`MinerGroups`)
        await miners.remove({})
        await miners.insertMany(minersInfo.minerGroups)
    }
    public async payWages(wageInfo: any) {
        const info = this.db.collection(`PayWages`)
        info.insertOne(wageInfo)
    }
    public async pollingPayWages(): Promise<any[]> {
        const collection = this.db.collection(`PayWages`)
        const rows: any[] = await collection.find({}).limit(1000).toArray()
        const returnRows: any[] = []
        for (const one of rows) {
            collection.deleteOne({ _id: one._id })
            const hash = new Hash(Buffer.from(one.blockHash.buffer))
            one.blockHash = hash
            returnRows.push(one)
        }
        return returnRows
    }
}
