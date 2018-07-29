import {MongoClient, Mongodb} from "mongodb"
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

        let info = {block:JSON.stringify(block), prehash:JSON.stringify(prehash)}
        let putWorkData= {block: block, prehash: prehash, info: info, time: new Date()}
        collection.insertOne( putWorkData)

        /*
        setTimeout( async ()=> {
            var result = await collection.deleteMany( {prehash: prehash})
            console.log(result)
        }, 50000)*/
    }

    public async submitBlock(block:Block) {
        console.log(`Submit Block`)
    }
}