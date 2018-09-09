import { FreeHyconServer } from "./freehyconServer"
import { MongoServer } from "./mongoServer"
export async function runFreehycon(isMaster: boolean) {
    if (isMaster) {
        const mongo = new MongoServer()
    }
    else {
        const mongo = new MongoServer()
        const freeHyconServer = new FreeHyconServer(mongo, 9081)
    }
}
