import { getLogger } from "log4js"
import { Db, MongoClient } from "mongodb"
import { Block } from "../common/block"
import { IMinedBlocks, IPoolSumary, IWorkMan, IMiner } from "./dataCenter"
import { IWorker } from "./freehyconServer"
const uuidv4 = require('uuid/v4');

const logger = getLogger("MongoServer")
export class MongoServer {
    public static readonly isReal = true
    public static readonly debugRabbit = false

    public static readonly timeoutPayWages = 30000
    public static readonly timeoutUpdateBlockStatus = 1800000
    public static readonly confirmations = 12
    private url: string = "mongodb://localhost:27017"

    private dbName = "freehycon"
    private client: MongoClient
    private db: Db

    public key: string = ""
    constructor() {
        this.key = uuidv4();
        logger.info(`MongoDB UniqueID ${this.key}`)
        if (MongoServer.isReal) {
            this.url = "mongodb://172.31.20.102:27017"
        }
        this.init()
    }
    public async init() {
        this.client = await MongoClient.connect(this.url)
        this.db = this.client.db(this.dbName)
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
    public async getBlacklist(): Promise<any[]> {
        const collection = this.db.collection(`Blacklist`)
        const rows = await collection.find({}).toArray()
        return rows
    }
    public async addDisconnections(disconnInfo: { address: string, workerId: string, timeStamp: number }) {
        if (disconnInfo === undefined) { return }
        const collection = this.db.collection(`Disconnections`)
        await collection.insertOne(disconnInfo)
    }

    public async removeClusterAllWorkers() {
        const collection = this.db.collection(`ClusterWorkers`)
        await collection.remove({ })
    }

    public async getClusterAllWorkers(): Promise<any[]> {
        const collection = this.db.collection(`ClusterWorkers`)
        const rows = await collection.find({}).toArray()
        return rows
    }
    public async updateClusterWorkers(mw: IWorker[]) {
        if (this.db === undefined) { return }
        if (mw.length > 0) {
            let newWorkers: any[] = []
            for (let w of mw) {
                let newone: any = {
                    key: this.key,
                    socket: w.socket.id,
                    workerId: w.workerId,
                    address: w.address,
                    fee: w.fee,
                    hashrate: w.hashrate,
                    hashshare: w.hashshare,
                    status: w.status,
                    career: w.career,
                    tick: w.tick,
                    tickLogin: w.tickLogin
                }
                newWorkers.push(newone)

            }
            //           logger.info(`Workers ${JSON.stringify(newWorkers)}`)
            const collection = this.db.collection(`ClusterWorkers`)
            await collection.remove({ key: this.key })
            await collection.insertMany(newWorkers)
        }

    }
}
