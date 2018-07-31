import { MongoServer } from "./mongoServer"
import { FreeHyconServer } from "./freehyconServer"
export async function freehyconProgram() {
    console.log(`freehycon`)
    const mongo = new MongoServer()
    const freeHyconServer = new FreeHyconServer(mongo, undefined, 9081)

}


