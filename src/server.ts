import { getLogger } from "log4js"
import { HttpServer } from "./api/server/server"
import { ITxPool } from "./common/itxPool"
import { TxPool } from "./common/txPool"
import { Consensus } from "./consensus/consensus"
import { WorldState } from "./consensus/database/worldState"
import { IConsensus } from "./consensus/iconsensus"
import { Sync } from "./consensus/sync"
import { globalOptions } from "./main"
import { MinerServer } from "./miner/minerServer"
import { INetwork } from "./network/inetwork"
import { RabbitNetwork } from "./network/rabbit/rabbitNetwork"
import { RestManager } from "./rest/restManager"
import { Wallet } from "./wallet/wallet"

const logger = getLogger("Server")

export class Server {
    public static subsid = 0

    public readonly consensus: IConsensus
    public readonly network: INetwork
    public readonly miner: MinerServer

    public readonly txPool: ITxPool
    public readonly rest: RestManager
    public worldState: WorldState
    public httpServer: HttpServer
    public sync: Sync
    constructor() {
        const prefix = globalOptions.data
        const postfix = globalOptions.postfix
        this.txPool = new TxPool(this)
        this.worldState = new WorldState(prefix + "worldstate" + postfix, this.txPool)
        this.consensus = new Consensus(this.txPool, this.worldState, prefix + "blockdb" + postfix, prefix + "rawblock" + postfix, prefix + "txDB" + postfix, prefix + "minedDB" + postfix)
        this.network = new RabbitNetwork(this.txPool, this.consensus, globalOptions.port, prefix + "peerdb" + postfix, globalOptions.networkid)
        this.miner = new MinerServer(this.txPool, this.worldState, this.consensus, this.network, globalOptions.cpuMiners, globalOptions.str_port)
        if (globalOptions.api) { this.rest = new RestManager(this) }
    }
    public async run() {
        await this.consensus.init()
        logger.info("Starting server...")
        if (globalOptions.api) {
            logger.debug(`API flag is ${globalOptions.api}`)
            logger.info("Test API")
            logger.info(`API Port ${globalOptions.api_port}`)
            this.httpServer = new HttpServer(this.rest, globalOptions.api_port, globalOptions)
        }
        await this.network.start()
        await Wallet.walletInit()
        if (globalOptions.peer) {
            for (const peer of globalOptions.peer) {
                const [ip, port] = peer.split(":")
                logger.info(`Connecting to ${ip}:${port}`)
                // add peer and record the database
                this.network.addPeer(ip, port).catch((e) => logger.error(`Failed to connect to client: ${e}`))
            }
        }
        await this.runSync()
    }

    public async runSync(): Promise<void> {
        logger.debug(`begin sync`)
        const sync = new Sync(this.network.getRandomPeer(), this.consensus, this.network.version)
        await sync.sync()
        setTimeout(async () => {
            await this.runSync()
        }, 5000)
        logger.debug(`end sync`)
    }
}
