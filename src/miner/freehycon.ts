import { MongoServer } from "./mongoServer"
import { FreeHyconServer } from "./freehyconServer"
async function program() {
    console.log(`freehycon`)
    const mongo = new MongoServer()
    const freeHyconServer = new FreeHyconServer(mongo, undefined, 9081)

}


program()