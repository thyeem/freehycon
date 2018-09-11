import { configure, getLogger } from "log4js"
import { runFreehycon } from "./freehycon"
import commandLineArgs = require("command-line-args")

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

var cluster = require('cluster')
var os = require('os')
const logger = getLogger("stratumMain")
function main() {
    if (cluster.isMaster) {
        console.log(`Master created`)
        runFreehycon(true)
        os.cpus().forEach(() => {
            cluster.fork()
        })
    }
    else {
        console.log(`Worker Created ${cluster.worker.id}`)
        runFreehycon(false)
    }
}

main()
