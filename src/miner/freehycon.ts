import cluster = require("cluster")
import { configure, getLogger } from "log4js"
import os = require("os")
import { MongoServer } from "./mongoServer"
import { StratumServer } from "./stratumServer"
const logger = getLogger("FreeHycon")

configure({
    appenders: {
        console: {
            type: "log4js-protractor-appender",
        },
        fileLogs: {
            filename: `./logs/${new Date().getFullYear()}-${(new Date().getMonth()) + 1}-${new Date().getDate()}/logFile.log`,
            keepFileExt: true,
            maxLogSize: 16777216,
            pattern: ".yyyy-MM-dd",
            type: "dateFile",
        },
    },
    categories: {
        default: { appenders: ["console", "fileLogs"], level: "info" },
    },
})
async function runClusterStratum(isMaster: boolean) {
    if (isMaster) {
        const mongo = new MongoServer()
    } else {
        const mongo = new MongoServer()
        const stratumServer = new StratumServer(mongo, 9081)
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
        logger.info(`Worker Created ${cluster.worker.id}`)
        runClusterStratum(false)
    }
}
run()
