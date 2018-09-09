import { getLogger } from "log4js"
var cluster = require('cluster')
var os = require('os')
const logger = getLogger("stratumMain")
function main() {
    if (cluster.isMaster) {
        console.log(`Master created`)
        os.cpus().forEach(() => {
            cluster.fork()
        })


    }
    else {
        console.log(`Worker Created ${cluster.worker.id}`)
    }
}

main()
