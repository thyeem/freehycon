import { FreeHyconServer } from "./freehyconServer"
import { MongoServer } from "./mongoServer"
export async function runFreehycon(port: number) {
    const mongo = new MongoServer()
    const freeHyconServer = new FreeHyconServer(mongo, port)
}
