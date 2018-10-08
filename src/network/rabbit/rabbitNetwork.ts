import { randomBytes } from "crypto"
import { getLogger } from "log4js"
import * as net from "net"
import { ITxPool } from "../../common/itxPool"
import { IConsensus } from "../../consensus/iconsensus"
import { globalOptions } from "../../main"
import { FC } from "../../miner/freehycon"
import * as proto from "../../serialization/proto"
import { Hash } from "../../util/hash"
import { INetwork } from "../inetwork"
import { IPeer } from "../ipeer"
import { NatUpnp } from "../nat"
import { PeerDatabase } from "../peerDatabase"
import { UpnpClient, UpnpServer } from "../upnp"
import { RabbitPeer } from "./rabbitPeer"

const logger = getLogger("Network")

export class RabbitNetwork implements INetwork {
    public static useSelfConnection = false
    public static seeds: proto.IPeer[] = [
        { host: "rapid1.hycon.io", port: 8148 },
    ]
    public static ipNormalise(ipv6: string): string {
        const ipTemp: string[] = ipv6.split(":")
        if (ipTemp.length === 4) {
            return ipTemp[3]
        } else { return ipv6 }
    }
    public networkid: string = "hycon"
    public readonly version: number = 9
    public socketTimeout: number
    public port: number
    public publicPort: number
    public guid: string // unique id to prevent self connecting
    public peers: Map<number, RabbitPeer>
    private txPool: ITxPool
    private consensus: IConsensus
    private server: net.Server

    private peerDatabase: PeerDatabase
    private targetConnectedPeers: number
    private upnpServer: UpnpServer
    private upnpClient: UpnpClient
    private natUpnp: NatUpnp

    constructor(txPool: ITxPool, consensus: IConsensus, port: number = 8148, peerDbPath: string = "peerdb", networkid: string = "hycon") {
        this.socketTimeout = FC.TIMEOUT_NETWORK_SOCKET
        this.txPool = txPool
        this.consensus = consensus
        this.port = port
        this.networkid = networkid
        this.targetConnectedPeers = 20
        this.peers = new Map<number, RabbitPeer>()
        this.peerDatabase = new PeerDatabase(this, peerDbPath)
        this.guid = new Hash(randomBytes(32)).toString()
        this.consensus.on("txs", (txs) => { this.broadcastTxs(txs) })
        logger.info(`TcpNetwork Port=${port} Session Guid=${this.guid}`)
    }

    public async getPeerDb(): Promise<proto.IPeer[]> {
        try {
            const peerList: proto.IPeer[] = []
            let isActive: boolean = false
            const keys = await this.peerDatabase.getKeys()
            for (const key of keys) {
                isActive = this.peers.has(key)
                try {
                    const value = await this.peerDatabase.get(key)
                    value.active = isActive
                    peerList.push(value)
                } catch (error) {
                    // success
                }
            }
            return peerList
        } catch (e) {
            logger.warn(`Get keys failed: ${e}`)
            return
        }
    }

    public async addPeer(ip: string, port: number): Promise<void> {
        // add or update to the database
        // await this.peerDatabase.seen({ host: ip, port })
        this.connect(ip, port).catch(() => undefined)
    }

    public async getConnection(): Promise<proto.IPeer[]> {
        try {
            const values = Array.from(this.peers.values())
            const connection: proto.IPeer[] = []
            for (const value of values) {
                const tp: proto.IPeer = {
                    host: value.socketBuffer.getIp(),
                    port: value.socketBuffer.getPort(),
                }
                const key: number = PeerDatabase.ipeer2key(tp)
                const peer: proto.IPeer = await this.peerDatabase.get(key)
                if (peer) {
                    peer.active = true
                    peer.currentQueue = value.socketBuffer.getQueueLength()
                    connection.push(peer)
                } else {
                    tp.active = true
                    tp.currentQueue = value.socketBuffer.getQueueLength()
                    tp.successCount = 1
                    tp.failCount = 0
                    tp.lastAttempt = 0
                    tp.lastSeen = Date.now()
                    connection.push(tp)
                }
            }
            return connection
        } catch (e) {
            logger.warn(`GetConnection: ${e}`)
        }
    }
    public getConnectionCount(): number {
        return this.peers.size
    }
    public getIPeers(exempt?: RabbitPeer): proto.IPeer[] {
        const ipeers: proto.IPeer[] = []
        for (const peer of this.peers.values()) {
            if (!peer.listenPort || exempt === peer) {
                continue
            }
            ipeers.push({
                host: peer.socketBuffer.getIp(),
                port: peer.listenPort,
            })
        }
        return ipeers
    }

    public broadcastTxs(txs: proto.ITx[], exempt?: RabbitPeer): void {
        const packet = proto.Network.encode({ putTx: { txs } }).finish()
        this.broadcast(packet, exempt)
    }

    public broadcastBlocks(blocks: proto.IBlock[]): void {
        const packet = proto.Network.encode({ putBlock: { blocks } }).finish()
        this.broadcast(packet)
    }

    public async broadcast(packet: Uint8Array, exempt?: RabbitPeer) {
        for (const [key, peer] of this.peers) {
            if (peer !== exempt) {
                peer.sendPacket(packet).catch((e) => logger.debug(e)) // TODO:
            }
        }
    }
    public async start(): Promise<boolean> {
        logger.debug(`Tcp Network Started`)
        // initial peerDB
        if (this.peerDatabase !== undefined) {
            try {
                await this.peerDatabase.init()
            } catch (e) {
                logger.error(`Fail to init peerdatabase table: ${e}`)
            }
        }
        this.server = net.createServer(async (socket) => {
            if (this.peers.size < this.targetConnectedPeers) {
                this.accept(socket).catch(() => undefined)
            }
        })
        this.server.on("error", (e) => logger.warn(`Listen socket error: ${e}`))
        await new Promise<boolean>((resolve, reject) => {
            this.server.once("error", reject)
            this.server.listen(this.port, () => {
                logger.info(`Listening ${this.port}`)
                resolve()
            })
        })
        this.server.on("error", (error) => logger.error(`${error}`))
        let useUpnp = true
        let useNat = true
        if (globalOptions.disable_upnp) { useUpnp = false }
        if (globalOptions.disable_nat) { useNat = false }
        if (useUpnp) {
            this.upnpServer = new UpnpServer(this.port)
            this.upnpClient = new UpnpClient(this)
        }
        if (useNat) {
            this.natUpnp = new NatUpnp(this.port, this)
            await this.natUpnp.run()
            if (this.natUpnp.publicPort) {
                this.publicPort = this.natUpnp.publicPort
            }
        }

        await this.connectSeedLoop()
        await this.connectLoop()
        this.showInfo()
        return true
    }

    public async connectSeedLoop() {
        this.connectSeeds().catch(() => undefined)
        setTimeout(() => {
            this.connectSeedLoop()
        }, 30000)

    }
    public async connectLoop() {
        this.connectToPeer().catch(() => undefined)
        setTimeout(() => this.connectLoop(), 1000)
    }
    public showInfo() {
        logger.info(`Peers Count=${this.peers.size}`)
        setTimeout(() => {
            this.showInfo()
        }, 10000)
    }
    public getRandomPeer(): IPeer {
        const index = Math.floor(Math.random() * this.peers.size)
        const key = Array.from(this.peers.keys())[index]
        return this.peers.get(key)
    }
    public getRandomPeers(count: number = 1): IPeer[] {
        const randomList: number[] = []
        const iPeer: IPeer[] = []
        const key: number[] = Array.from(this.peers.keys())
        while (randomList.length < count) {
            const index = Math.floor(Math.random() * this.peers.size)
            if (randomList.indexOf(index) === -1) {
                randomList.push(index)
                iPeer.push(this.peers.get(key[index]))
            }
        }
        return iPeer
    }
    public getPeers(): IPeer[] {
        const peers: IPeer[] = []
        for (const peer of this.peers.values()) {
            peers.push(peer)
        }
        return peers
    }
    public async connect(host: string, port: number, save: boolean = true): Promise<RabbitPeer> {
        const ipeer = { host, port }
        const key = PeerDatabase.ipeer2key(ipeer)
        let ret: RabbitPeer = await new Promise<RabbitPeer>(async (resolve, reject) => {
            logger.debug(`Attempting to connect to ${host}:${port}...`)
            const socket = new net.Socket()
            socket.setTimeout(FC.TIMEOUT_NETWORK_SOCKET)
            socket.once("error", () => reject(`Failed to connect to ${host}:${port}`))
            socket.once("timeout", () => reject(`Timeout to connect to ${host}:${port}`))
            socket.connect({ host, port }, async () => {
                try {
                    const newPeer = await this.newConnection(socket, save)
                    ipeer.host = socket.remoteAddress
                    resolve(newPeer)
                } catch (e) {
                    reject(e)
                }
            })
        })
        return ret
    }
    private async accept(socket: net.Socket): Promise<void> {
        try {
            socket.once("error", (e) => logger.debug(`Accept socket error: ${e}`))
            logger.fatal(`Incoming peer connection ${RabbitNetwork.ipNormalise(socket.remoteAddress)}:${socket.remotePort}`)
            const peer = await this.newConnection(socket)
        } catch (e) {
            logger.debug(e)
        }
    }
    private async newConnection(socket: net.Socket, save: boolean = true): Promise<RabbitPeer> {
        try {
            const peer = new RabbitPeer(socket, this, this.consensus, this.txPool, this.peerDatabase)
            const peerStatus = await peer.detectStatus()
            const port = (peerStatus.publicPort > 0 && peerStatus.publicPort < 65535) ? peerStatus.publicPort : peerStatus.port
            const ipeer = { host: socket.remoteAddress, port }
            const key = PeerDatabase.ipeer2key(ipeer)

            socket.on("error", async () => {
                try {
                    socket.end()
                    this.peers.delete(key)
                    this.peerDatabase.deactivate(key)
                    logger.debug(`error in connection to ${ipeer.host}:${ipeer.port}`)
                } catch (e) {
                    logger.debug(e)
                }
            })
            socket.on("timeout", async () => {
                try {
                    socket.end()
                    this.peers.delete(key)
                    this.peerDatabase.deactivate(key)
                    logger.warn(`connection timeout on ${ipeer.host}:${ipeer.port}`)
                } catch (e) {
                    logger.debug(e)
                }
            })
            socket.on("close", async () => {
                try {
                    socket.end()
                    this.peers.delete(key)
                    this.peerDatabase.deactivate(key)
                    logger.warn(`disconnected from ${ipeer.host}:${ipeer.port}`)
                } catch (e) {
                    logger.debug(e)
                }
            })
            socket.on("end", async () => {
                try {
                    socket.end()
                    this.peers.delete(key)
                    this.peerDatabase.deactivate(key)
                    logger.debug(`ended connection with ${ipeer.host}:${ipeer.port}`)
                } catch (e) {
                    logger.debug(e)
                }
            })
            socket.setTimeout(this.socketTimeout)
            this.peers.set(key, peer)

            if (save) {
                await this.peerDatabase.seen(ipeer)
                const newIPeers = await peer.getPeers()
                const info: proto.IPeer[] = []
                for (const newIPeer of newIPeers) {
                    info.push({ host: newIPeer.host, port: newIPeer.port, failCount: 0 })
                }
                await this.peerDatabase.putPeers(info)
            }
            logger.info(`New connection(${peerStatus.version})  ${peer.socketBuffer.getInfo()}`)
            return peer
        } catch (e) { }
    }

    private async connectToPeer(): Promise<void> {
        if (this.peers.size >= this.targetConnectedPeers) { return }
        const ipeer = await this.peerDatabase.getRandomPeer()
        try {
            if (ipeer === undefined) { return }
            await this.connect(ipeer.host, ipeer.port).catch(() => undefined)
        } catch (e) {
            logger.debug(`Connecting to Peer: ${e}`)
            this.peerDatabase.remove(ipeer)
        }
    }
    private async connectSeeds() {
        if (this.peers.size >= 5) { return }
        for (const seed of RabbitNetwork.seeds) {
            this.connect(seed.host, seed.port, false).then(async (rabbitPeer) => {
                const peers = await rabbitPeer.getPeers()
                rabbitPeer.disconnect()
                const info: proto.IPeer[] = []
                for (const peer of peers) {
                    info.push({ host: peer.host, port: peer.port })
                }
                await this.peerDatabase.putPeers(info)
            }).catch(() => undefined)
        }
    }
}
