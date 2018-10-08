import { getLogger } from "log4js"
import "reflect-metadata"
import { Connection, createConnection } from "typeorm"
import { AsyncLock } from "../common/asyncLock"
import * as proto from "../serialization/proto"
import { Hash } from "../util/hash"
import { INetwork } from "./inetwork"
import { IPeerDatabase } from "./ipeerDatabase"
import { PeerModel } from "./peerModel"
const logger = getLogger("PeerDb")
export class PeerDatabase implements IPeerDatabase {
    public static ipeer2key(peer: proto.IPeer): number {
        const hash = new Hash(peer.host + "!" + peer.port.toString())
        let key = 0
        for (let i = 0; i < 6; i++) {
            key = key * 256 + hash[i]
        }
        return key
    }
    public static model2ipeer(peerModel: PeerModel): proto.IPeer {
        const peer: proto.IPeer = {
            active: peerModel.active,
            currentQueue: peerModel.currentQueue,
            failCount: peerModel.failCount,
            host: peerModel.host,
            lastAttempt: peerModel.lastAttempt,
            lastSeen: peerModel.lastSeen,
            port: peerModel.port,
            successCount: peerModel.successCount,
        }
        return peer
    }
    private connection: Connection
    private maxPeerCount: number = 200
    private network: INetwork
    private path: string

    constructor(network: INetwork, path: string) {
        this.network = network
        this.path = path
    }
    public async init() {
        try {
            this.connection = await createConnection({
                database: `${this.path}sql`,
                entities: [PeerModel],
                synchronize: true,
                type: "sqlite",
            })
            await this.reset()
        } catch (e) {
            logger.debug(`DB init error: ${e}`)
        }
    }
    public async seen(peer: proto.IPeer): Promise<proto.IPeer> {
        if (peer.port > 10000) {
            return
        }
        const key = PeerDatabase.ipeer2key(peer)
        const peerExist = await this.connection.manager.findOne(PeerModel, { key })
        if (peerExist) {
            peerExist.lastSeen = Date.now()
            peerExist.successCount += 1
            peerExist.active = true
            const ret = PeerDatabase.model2ipeer(await this.connection.manager.save(peerExist))
            logger.debug(`seen peer : ${ret.host}~${ret.port}~${ret.active}`)
            return ret
        } else {
            const newPeer = new PeerModel()
            newPeer.key = key
            newPeer.host = peer.host
            newPeer.port = peer.port
            newPeer.lastSeen = Date.now()
            newPeer.successCount = 1
            newPeer.active = true
            const ret = PeerDatabase.model2ipeer(await this.connection.manager.save(newPeer))
            logger.debug(`seen peer : ${ret.host}~${ret.port}~${ret.active}`)
            return ret
        }
    }
    public async fail(peer: proto.IPeer): Promise<proto.IPeer> {
        if (peer.port > 10000) { return }
        const key = PeerDatabase.ipeer2key(peer)
        // this.removePeer(key)
    }
    public async removePeer(key: number) {
        // await this.connection.manager.delete(PeerModel, { key })
    }
    public remove(peer: proto.IPeer) {
        const key = PeerDatabase.ipeer2key(peer)
        // this.removePeer(key)
    }

    public async deactivate(key: number) {
        const peerExist = await this.connection.manager.findOne(PeerModel, { key })
        if (peerExist) {
            peerExist.active = false
            await this.connection.manager.save(peerExist)
            logger.debug(`deactivate peer successful with key ${key}`)
        }
    }
    public async putPeers(peers: proto.IPeer[]) {
        const tp = peers.splice(0, this.maxPeerCount)
        await this.doPutPeers(tp)
    }
    public async getRandomPeer(): Promise<proto.IPeer> {
        const sql: string = `SELECT * FROM peer_model ORDER BY RANDOM() DESC LIMIT 1`
        const rows = await this.connection.manager.query(sql)
        const res = PeerDatabase.model2ipeer(rows[0])
        return res
    }
    public async get(key: number): Promise<proto.IPeer> {
        const res = await this.connection.manager.findOne(PeerModel, { key })
        if (res) {
            return PeerDatabase.model2ipeer(res)
        } else {
            // peer with the key not exist
            return undefined
        }
    }
    public async getKeys(): Promise<number[]> {
        const rets = await this.connection.manager.query("Select key from peer_model")
        if (rets) {
            const keys = []
            for (const ret of rets) {
                keys.push(ret.key)
            }
            return keys
        } else {
            // no peers in db
            return undefined
        }
    }
    public async removeAll(): Promise<void> {
        await this.connection.manager.clear(PeerModel)
    }
    private async doPutPeers(peers: proto.IPeer[]) {
        await this.connection.manager.transaction(async (manager) => {
            for (const peer of peers) {
                const key = PeerDatabase.ipeer2key(peer)
                const peerExist = await manager.findOne(PeerModel, { key })
                if (!peerExist) {
                    const peerModel = new PeerModel()
                    peerModel.key = key
                    peerModel.host = peer.host
                    peerModel.port = peer.port
                    await manager.save(peerModel)
                }
            }
        })
    }
    private async reset() {
        const keys = await this.getKeys()
        await this.connection.manager.transaction(async (manager) => {
            for (const key of keys) {
                const res = await manager.findOne(PeerModel, { key })
                res.active = false
                await manager.save(res)
            }
        })
    }
}
