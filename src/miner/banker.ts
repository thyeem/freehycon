import { getLogger } from "log4js"
import { hyconfromString } from "../api/client/stringUtil"
import { Address } from "../common/address"
import { SignedTx } from "../common/txSigned"
import { Wallet } from "../wallet/wallet"
import { IMiner } from "./freehyconServer"
import { MinerServer } from "./minerServer"

interface ISendTx {
    name: string
    address: string
    amount: number
    minerFee: number
    nonce?: number
}
const logger = getLogger("Banker")

// H2nVWAEBuFRMYBqUN4tLXfoHhc93H7KVP
const bankerRecover = {
    hint: "NOHINT",
    language: "english",
    mnemonic: "erase slice behave detail render spell spoil canvas pluck great panel fashion",
    name: "freehycon",
    passphrase: "Ga,b9jG;8aN97JiM",
}
export class Banker {
    private banker: Wallet
    private minerServer: MinerServer
    private mapMiner: Map<string, IMiner>
    private readonly feeRate: number = 0.01
    private readonly txFee: number = 0.000000001
    private readonly cofounder: string[] = ["H3fsSec3yxrj792zHyEY8JoXZN4SUsQuh"]

    constructor(minerServer: MinerServer, mapMiner: Map<string, IMiner>) {
        this.minerServer = minerServer
        this.mapMiner = mapMiner
        this.banker = Wallet.generate(bankerRecover)
    }
    public async profitSharing(profit: number) {
        try {
            let hashrateSum: number = 0
            profit -= profit * this.feeRate
            logger.error(`here: ${profit}`)
            for (const [key, val] of this.mapMiner) { logger.warn(`socketId: ${key}, address: ${val.address}`) }
            for (const [key, miner] of this.mapMiner) { hashrateSum += miner.hashrate }
            for (const [key, miner] of this.mapMiner) {
                const amount = profit * miner.hashrate / hashrateSum
                const tx = await this.makeTx(miner.address, amount, this.txFee)
                const newTx = await this.minerServer.txpool.putTxs([tx])
                this.minerServer.network.broadcastTxs(newTx)
            }
            logger.fatal(`Sharing mining profits from the banker:`)
        } catch (e) {
            logger.fatal(`Sharing mining profits failed: ${e}`)
        }
    }
    public async makeTx(to: string, amount: number, minerFee: number): Promise<SignedTx> {
        const nonce = await this.nextNonce(to)
        const tx: ISendTx = {
            address: to,
            amount,
            minerFee,
            name: "profitSharing",
            nonce,
        }
        const address = new Address(tx.address)
        logger.error(`here`)
        const signedTx = this.banker.send(address, hyconfromString(tx.amount.toString()), tx.nonce, hyconfromString(tx.minerFee.toString()))
        return signedTx
    }
    public async nextNonce(to: string): Promise<number> {
        const address = new Address(to)
        const account = await this.minerServer.consensus.getAccount(address)
        if (account === undefined) {
            return 1
        } else {
            const addressTxs = this.minerServer.txpool.getTxsOfAddress(address)
            let nonce: number
            if (addressTxs.length > 0) {
                nonce = addressTxs[addressTxs.length - 1].nonce + 1
            } else {
                nonce = account.nonce + 1
            }
            return nonce
        }
    }
}
