import cluster = require("cluster")
import { getLogger } from "log4js"
import os = require("os")
import { globalOptions } from "../main"
import { MongoServer } from "./mongoServer"
import { StratumServer } from "./stratumServer"
const logger = getLogger("FreeHycon")

// tslint:disable-next-line:object-literal-sort-keys
async function runClusterStratum(isMaster: boolean, id: string = "") {
    if (isMaster) {
        const mongo = new MongoServer()
    } else {
        const mongo = new MongoServer()
        const stratumServer = new StratumServer(mongo, id, 9081)
    }
}
function run() {
    if (cluster.isMaster) {
        logger.info(`Master created`)
        runClusterStratum(true)
        os.cpus().forEach(() => {
            cluster.fork()
        })
    } else {
        logger.info(`Worker created ${cluster.worker.id}`)
        runClusterStratum(false, padNum(cluster.worker.id, 3))
    }
}
function padNum(num: number, length: number): string {
    return ("0".repeat(length - 1) + num).slice(-length)
}
if (globalOptions.stratum) { run() }
