import { FreeHyconServer } from "./freehyconServer"
import { MongoServer } from "./mongoServer"
export async function runFreehycon() {
    const mongo = new MongoServer()
    const freeHyconServer = new FreeHyconServer(mongo, undefined, 9081)
}
