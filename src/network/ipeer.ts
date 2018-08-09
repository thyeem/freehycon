
import { Block } from "../common/block"
import { AnyBlockHeader } from "../common/blockHeader"
import { SignedTx } from "../common/txSigned"
import * as proto from "../serialization/proto"
import { IStatus } from "../serialization/proto"
import { IPeer } from "../serialization/proto"
import { Hash } from "../util/hash"
import { IBlockTxs } from "./rabbit/rabbitPeer"

export interface IPeer {
    status(): Promise<IStatus>
    ping(): Promise<number>
    putTxs(txs: SignedTx[]): Promise<boolean>
    getTxs(minFee?: number): Promise<SignedTx[]>
    getBlockTxs(hashes: Hash[]): Promise<IBlockTxs[]>
    getHash(height: number): Promise<Hash | undefined>
    getBlocksByHashes(hashes: Hash[]): Promise<Block[]>
    getHeadersByHashes(hashes: Hash[]): Promise<AnyBlockHeader[]>
    getBlocksByRange(fromHeight: number, count: number): Promise<Block[]>
    getHeadersByRange(fromHeight: number, count: number): Promise<AnyBlockHeader[]>
    getTip(header?: boolean): Promise<{ hash: Hash, height: number, totalwork: number }>
    getPeers(count?: number): Promise<proto.IPeer[]>
    getInfo(): string
    disconnect(): void
}
