import { configure, getLogger } from "log4js"
import { StratumServer } from "./stratumServer"
import { MongoServer } from "./mongoServer"
import cluster = require('cluster');
import os = require('os');
import commandLineArgs = require("command-line-args")
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
    }
    else {
        const mongo = new MongoServer()
        const stratumServer = new StratumServer(mongo, 9081)
    }
}
function run() {
    if (cluster.isMaster) {
        console.log(`Master created`)
        runClusterStratum(true)
        os.cpus().forEach(() => {
            cluster.fork()
        })
    }
    else {
        console.log(`Worker Created ${cluster.worker.id}`)
        runClusterStratum(false)
    }
}
run()
