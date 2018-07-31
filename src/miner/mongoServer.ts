import { Block } from "../common/block"

import { MongoClient, Mongodb } from "mongodb"

import * as assert from "assert"
import { equal } from "assert"
import { delay } from "delay"
import { MinerServer } from "./minerServer"

export class MongoServer {
    private minerServer: MinerServer
    private url: string = "mongodb://localhost:27017"
    private dbName = "freehycon"
    private maxCountPerQuery = 10

    private client: MongoClient
    private db: Mongodb
    constructor(minerServer: MinerServer) {
        assert.ok(minerServer)
        this.minerServer = minerServer
        this.initialize()
    }

    public async initialize() {
        this.client = await MongoClient.connect(this.url)
        this.db = this.client.db(this.dbName)
    }
    async testServer() {
        var client: MongoClient = await MongoClient.connect(this.url)
        const db = client.db(this.dbName)
        const collection = db.collection(`Miner`)

        while (true) {

            console.log(`server`)
            console.time(`Mongodb Test`)
            await collection.insertMany([{ Name: "Amazon", Hashpower: 0, Time: new Date() }])
            console.timeEnd(`Mongodb Test`)

            await delay(1000)
        }

        //  await client.close()

    }

    async testClient() {
        var client: MongoClient = await MongoClient.connect(this.url)
        const db = client.db(this.dbName)
        const collection = db.collection(`Miner`)

        while (true) {

            //  console.log(`client`)                     
            var rows: any[] = await collection.find({}).limit(this.maxCountPerQuery).toArray()
            // console.log(`Rows=${rows.length}`)
            if (rows.length > 0) {
                console.time(`Mongodb Test`)
                for (let m of rows) {
                    console.log(`ID=${m._id}`)
                    collection.deleteOne({ _id: m._id })
                }
                // await collection.insertMany([{Name:"Amazon",Hashpower:0,Time:new Date()}])
                console.timeEnd(`Mongodb Test`)
            }
            await delay(200)
        }
    }

    // write to db
    public async  putWork(block: Block, prehash: Uint8Array) {
        const collection = this.db.collection(`Works`)

        var jsonInfo = { block: JSON.stringify(block), prehash: JSON.stringify(prehash) }
        let putWorkData = { block: block.encode(), prehash: Buffer.from(prehash), time: new Date(), info: jsonInfo }
        await collection.remove({})
        await collection.insertOne(putWorkData)


    }

    public async pollingPutWork(): Promise<any[]> {
        const collection = this.db.collection(`Works`)
        var rows: any[] = await collection.find({}).limit(this.maxCountPerQuery).toArray()
        var returnRows: any[] = []
        for (let one of rows) {
            //console.log(`processing`)
            var block = Block.decode(one.block.buffer)
            var prehash = Buffer.from(one.prehash.buffer as Buffer)
            returnRows.push({ block: block, prehash: prehash, time: one.time })

        }
        return returnRows
    }

    public async submitBlock(block: Block, prehash: Uint8Array) {
        console.log(`Submit Block`)
        const collection = this.db.collection(`Submits`)
        let submit = { block: block.encode(), prehash: Buffer.from(prehash), time: new Date(), info: JSON.stringify(block) }
        await collection.insertOne(submit)
    }

    public async pollingSubmitWork(): Promise<any[]> {
        const collection = this.db.collection(`Submits`)
        var rows: any[] = await collection.find({}).limit(1000).toArray()
        var returnRows: any[] = []
        for (let one of rows) {
            collection.deleteOne({ _id: one._id })
            //console.log(`processing`)
            var block = Block.decode(one.block.buffer)
            var prehash = Buffer.from(one.prehash.buffer as Buffer)
            returnRows.push({ block: block, prehash: prehash, time: one.time })

        }
        return returnRows
    }

    public async addMinedBlock(block: Block) {
        console.log(`Add Mined Block`)
        const collection = this.db.collection(`MinedBlocks`)
        let mined = { block: block.encode(), time: new Date(), info: JSON.stringify(block) }
        await collection.insertOne(mined)
    }


    public async writeMiners(minersInfo: any) {
        const info = this.db.collection(`Info`)
        await info.remove({})
        await info.insertOne({
            minersCount: minersInfo.minersCount,
            poolHashrate: minersInfo.poolHashrate,
            poolHashshare: minersInfo.poolHashshare
        })

        const miners = this.db.collection(`MinerGroups`)
        await miners.remove({})
        await miners.insertMany(minersInfo.minerGroups)
    }
}