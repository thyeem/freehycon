import {MongoClient, Mongodb, Binary} from "mongodb"
import * as assert from "assert"
import {equal} from "assert"
import delay from "delay"
import { MinerServer } from "./minerServer"
import { Block } from "../common/block"
export class MongoServer {
    minerServer: MinerServer
    url:string  = 'mongodb://localhost:27017'
    dbName = 'freehycon'
    maxCountPerQuery= 10

    client: MongoClient
    db: Mongodb
    constructor(minerServer: MinerServer) {
        assert.ok(minerServer)
        this.minerServer = minerServer       
        this.initialize() 
    }

   public async initialize() {
     this.client =await MongoClient.connect(this.url)
     this.db= this.client.db(this.dbName)
    }
    async testServer() {
        var client: MongoClient =await MongoClient.connect(this.url)
        const db = client.db(this.dbName)
        const collection=db.collection(`Miner`)
       
        while(true) {
            
            console.log(`server`)      
            console.time(`Mongodb Test`)     
            await collection.insertMany([{Name:"Amazon",Hashpower:0,Time:new Date()}])
            console.timeEnd(`Mongodb Test`)

            await delay(1000)
         }
                  
      //  await client.close()
       
    }

    async testClient() {
        var client: MongoClient =await MongoClient.connect(this.url)
        const db = client.db(this.dbName)
        const collection=db.collection(`Miner`)
       
        while(true) {
            
          //  console.log(`client`)                     
            var rows:any [] = await  collection.find({}).limit(this.maxCountPerQuery).toArray()
           // console.log(`Rows=${rows.length}`)
           if (rows.length>0) {
            console.time(`Mongodb Test`)  
            for (let m of rows) {
                console.log(`ID=${m._id}`)
                collection.deleteOne({_id:m._id})
            }
           // await collection.insertMany([{Name:"Amazon",Hashpower:0,Time:new Date()}])
            console.timeEnd(`Mongodb Test`)
           }   
            await delay(200)
         }
    }

    // write to db
    public async  putWork(block: Block, prehash: Uint8Array) {
        const collection=this.db.collection(`Works`)
        
        let putWorkData= {block: block.encode(), prehash: Buffer.from(prehash), time: new Date()}
         await collection.remove({})
        await collection.insertOne( putWorkData)

        
    }

    public async pollingPutWork() : Promise<any[]>
    {
        const collection=this.db.collection(`Works`)
        var rows:any [] = await  collection.find({}).limit(this.maxCountPerQuery).toArray()
        var returnRows: any[]= []
        for (let one of rows) {
            //console.log(`processing`)
            var block = Block.decode( one.block.buffer)
            var prehash = Buffer.from(one.prehash.buffer as Buffer)
            returnRows.push({block: block, prehash: prehash})
        
        }
        return returnRows
    }

    public async submitBlock(block:Block) {
        console.log(`Submit Block`)
    }

  
}