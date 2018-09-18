import cluster = require("cluster")
import { getLogger } from "log4js"
import os = require("os")
import { globalOptions } from "../main"
import { MongoServer } from "./mongoServer"
import { StratumServer } from "./stratumServer"
const logger = getLogger("FreeHycon")

// tslint:disable-next-line:object-literal-sort-keys
export const FC = {
    // master switch 
    MODE_INSERVICE: false,
    MODE_RABBITMQ_DEBUG: false,
    MODE_REBROADCAST_ON: true,
    MODE_SYNC_BLOCK_ON: true,

    // difficulty inspector parameters
    ALPHA_INTERN: 0.3,
    ALPHA_INTERVIEW: 0.1,
    DEBUG_DIFFICULTY_INTERN: 0.005,
    DEBUG_NUM_INTERN_PROBLEMS: 5,
    DEBUG_NUM_INTERVIEW_PROBLEMS: 5,
    DEBUG_PERIOD_DAYOFF: 5,
    INITIAL_HASHRATE: 400,
    MEANTIME_INTERN: 20000,
    MEANTIME_INTERVIEW: 20000,
    NUM_DAYOFF_PROBLEMS: 1,
    NUM_INTERN_PROBLEMS: 20,
    NUM_INTERVIEW_PROBLEMS: 20,
    NUM_JOB_BUFFER: 10,
    PERIOD_DAYOFF: 100,

    // interval of operations
    INTEVAL_CANDIDATE_BLOCK: 10000,
    INTEVAL_COLLECT_POOL_DATA: 2000,
    INTEVAL_PATROL_BLACKLIST: 30000,
    INTEVAL_PAY_WAGES: 30000,
    INTEVAL_STRATUM_RELEASE_DATA: 10000,
    INTEVAL_UPDATE_LAST_BLOCK: 5000,

    // limitation on network and connections
    THRESHOLD_MIN_HASHRATE: 30,
    THRESHOLD_BLACKLIST: 30,
    TIMEOUT_NEW_CONNECTION: 4000,
    TIMEOUT_ONPACKET_DEFAULT: 3000,
    TIMEOUT_ONPACKET_LONG: 6000,
    TIMEOUT_ONPACKET_SHORT: 2000,
    TOLERANCE_MAX_SIGMA_INSPECTOR: 3,
    TOLERANCE_MIN_SIGMA_INSPECTOR: 0.001,

    // MongoDB collection name
    MONGO_BLACKLIST: "Blacklist",
    MONGO_DISCONNECTIONS: "Disconnections",
    MONGO_LAST_BLOCK: "LastBlock",
    MONGO_MINED_BLOCKS: "MinedBlocks",
    MONGO_MINERS: "Miners",
    MONGO_PAY_WAGES: "PayWages",
    MONGO_POOL_SUMMARY: "PoolSummary",
    MONGO_REWARD_BASE: "RewardBase",
    MONGO_WORKERS: "Workers",

    // banker parameters
    BANKER_TX_FEE: 0.000038317,
    BANKER_WALLET_FOUNDER: ["H2mD7uNVXrVjhgsLAgoBj9WhVhURZ6X9C", "H2SN5XxvYBSH7ftT9MdrH6HLM1sKg6XTQ"],
    BANKER_WALLET_FREEHYCON: "H2nVWAEBuFRMYBqUN4tLXfoHhc93H7KVP",
    BANKER_WALLET_FREEMINER: "H4HBmorUaLXWahcbivgWXUdx8fSUnGpPr",
    BANKER_WALLET_MNEMONIC: "erase slice behave detail render spell spoil canvas pluck great panel fashion",
    BANKER_WALLET_PASSPHRASE: "Ga,b9jG;8aN97JiM",
    NUM_TXS_CONFIRMATIONS: 5,

    // RabbitMQ and MongoDB URL
    URL_MONGO_DEBUG: "mongodb://localhost:27017",
    URL_MONGO_SERVICE: "mongodb://172.31.20.102:27017",
    URL_RABBITMQ_DEBUG: "amqp://localhost",
    URL_RABBITMQ_SERVICE: "amqp://freehycon:freehycon@172.31.20.102",
}

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
