import { getLogger } from "log4js"
import { runFreehycon } from "./freehycon"
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
