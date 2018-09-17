import { getLogger } from "log4js"
import { hyconfromString } from "../api/client/stringUtil"
import { Address } from "../common/address"
import { SignedTx } from "../common/txSigned"
import { Hash } from "../util/hash"
import { Wallet } from "../wallet/wallet"
import { IMinerReward } from "./collector"
import { FC } from "./freehycon"
import { MinerServer } from "./minerServer"

interface ISendTx {
    name: string
    address: string
    amount: number
    minerFee: number
    nonce: number
}
const logger = getLogger("Banker")
export class Banker {
    // Freehycon Wallet: H2nVWAEBuFRMYBqUN4tLXfoHhc93H7KVP
    private carryover: number
    private banker: Wallet
    private minerServer: MinerServer

    constructor(minerServer: MinerServer) {
        this.minerServer = minerServer
        this.carryover = 0
        this.banker = Wallet.generate({
            hint: "freehycon",
            language: "english",
            mnemonic: FC.BANKER_WALLET_MNEMONIC,
            name: "freehycon",
            passphrase: FC.BANKER_WALLET_PASSPHRASE,
        })
    }
    public async distributeIncome(income: number, hash: string, height: number, payments: IMinerReward[]) {
        try {
            logger.error(`distribution (block #${height}: ${hash}) started`)
            income += this.carryover
            let sumFee = 0
            for (const pay of payments) {
                const amount = income * pay.reward - FC.BANKER_TX_FEE
                if (amount <= 0) { continue }
                const fee = income * pay.fee
                sumFee += fee
                const tx = await this.makeTx(pay._id, amount, FC.BANKER_TX_FEE)
                const newTx = await this.minerServer.txpool.putTxs([tx])
                this.minerServer.network.broadcastTxs(newTx)
            }
            for (const to of FC.BANKER_WALLET_FOUNDER) {
                const amount = sumFee * 0.5 - FC.BANKER_TX_FEE
                if (amount <= 0) { continue }
                const tx = await this.makeTx(to, amount, FC.BANKER_TX_FEE)
                const newTx = await this.minerServer.txpool.putTxs([tx])
                this.minerServer.network.broadcastTxs(newTx)
            }
            if (payments.length < 1) {
                this.carryover += 240
                logger.error(`carryover: ${this.carryover} HYC`)
            } else {
                this.carryover = 0
                logger.error(`sent: ${(income - sumFee).toFixed(9)} HYC | sumFee: ${sumFee.toFixed(9)} HYC`)
            }
        } catch (e) {
            logger.fatal(`income distribution failed: ${e}`)
        }
    }
    public async makeTx(to: string, amount: number, minerFee: number): Promise<SignedTx> {
        const nonce = await this.nextNonce(this.banker)
        const tx: ISendTx = {
            address: to,
            amount,
            minerFee,
            name: "freehycon",
            nonce,
        }
        const address = new Address(tx.address)
        const signedTx = this.banker.send(address, hyconfromString(tx.amount.toFixed(9)), tx.nonce, hyconfromString(tx.minerFee.toFixed(9)))
        logger.warn(`sending ${tx.amount.toFixed(9)} HYC to ${tx.address} (${new Hash(signedTx).toString()})`)
        return signedTx
    }
    public async nextNonce(wallet: Wallet): Promise<number> {
        const address = wallet.pubKey.address()
        const account = await this.minerServer.consensus.getAccount(address)
        if (account === undefined) {
            return 0
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
