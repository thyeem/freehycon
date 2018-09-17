import cluster = require("cluster")
import { getLogger } from "log4js"
import os = require("os")
import { globalOptions } from "../main"
import { MongoServer } from "./mongoServer"
import { StratumServer } from "./stratumServer"
const logger = getLogger("FreeHycon")

export const FC = {
    ALPHA_INTERN: 0.3,
    ALPHA_INTERVIEW: 0.1,
    BANKER_TX_FEE: 0.000038317,
    BANKER_WALLET_FOUNDER: ["H2mD7uNVXrVjhgsLAgoBj9WhVhURZ6X9C", "H2SN5XxvYBSH7ftT9MdrH6HLM1sKg6XTQ"],
    BANKER_WALLET_FREEHYCON: "H2nVWAEBuFRMYBqUN4tLXfoHhc93H7KVP",
    BANKER_WALLET_FREEMINER: "H4HBmorUaLXWahcbivgWXUdx8fSUnGpPr",
    BANKER_WALLET_MNEMONIC: "erase slice behave detail render spell spoil canvas pluck great panel fashion",
    BANKER_WALLET_PASSPHRASE: "Ga,b9jG;8aN97JiM",
    DEBUG_DIFFICULTY_INTERN: 0.1,
    DEBUG_NUM_INTERN_PROBLEMS: 5,
    DEBUG_NUM_INTERVIEW_PROBLEMS: 5,
    DEBUG_PERIOD_DAYOFF: 5,
    INITIAL_HASHRATE: 20,
    INTEVAL_CANDIDATE_BLOCK: 10000,
    INTEVAL_PATROL_BLACKLIST: 30000,
    INTEVAL_PAY_WAGES: 30000,
    INTEVAL_STRATUM_RELEASE_DATA: 10000,
    INTEVAL_UPDATE_LAST_BLOCK: 5000,
    MEANTIME_INTERN: 20000,
    MEANTIME_INTERVIEW: 20000,

    MODE_INSERVICE: false,
    MODE_RABBITMQ_DEBUG: false,

    MONGO_BLACKLIST: "Blacklist",
    MONGO_DISCONNECTIONS: "Disconnections",
    MONGO_LAST_BLOCK: "LastBlock",
    MONGO_MINED_BLOCKS: "MinedBlocks",
    MONGO_MINERS: "Miners",
    MONGO_PAY_WAGES: "PayWages",
    MONGO_POOL_SUMMARY: "PoolSummary",
    MONGO_REWARD_BASE: "RewardBase",
    MONGO_WORKERS: "Workers",

    NUM_DAYOFF_PROBLEMS: 1,
    NUM_INTERN_PROBLEMS: 20,
    NUM_INTERVIEW_PROBLEMS: 20,
    NUM_JOB_BUFFER: 10,
    NUM_TXS_CONFIRMATIONS: 5,
    PERIOD_DAYOFF: 100,

    THRESHOLD_MIN_HASHRATE: 30,
    TRHESHOLD_BLACKLIST: 30,
}

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
        logger.info(`Worker created ${cluster.worker.id}`)
        runClusterStratum(false)
    }
}
if (globalOptions.stratum) { run() }
