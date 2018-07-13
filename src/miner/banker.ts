import { getLogger } from "log4js"
import { hyconfromString } from "../api/client/stringUtil"
import { Address } from "../common/address"
import { SignedTx } from "../common/txSigned"
import { Hash } from "../util/hash"
import { Wallet } from "../wallet/wallet"
import { IMiner } from "./freehyconServer"
import { MinerServer } from "./minerServer"

interface ISendTx {
    name: string
    address: string
    amount: number
    minerFee: number
    nonce: number
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
    private readonly poolFee: number = 0.029
    private readonly txFee: number = 0.000000001
    private readonly cofounder: string[] = ["H2SN5XxvYBSH7ftT9MdrH6HLM1sKg6XTQ", "H2mD7uNVXrVjhgsLAgoBj9WhVhURZ6X9C"]

    constructor(minerServer: MinerServer, mapMiner: Map<string, IMiner>) {
        this.minerServer = minerServer
        this.mapMiner = mapMiner
        this.banker = Wallet.generate(bankerRecover)
    }
    public async distributeIncome(income: number) {
        try {
            let hashrateTotal: number = 0
            const net = income * (1.0 - this.poolFee) - this.txFee * (this.mapMiner.size + this.cofounder.length)
            logger.error(`distribution: ${net.toFixed(9)} HYC | fee(${(this.poolFee * 100).toFixed(1)}%): ${(income * this.poolFee).toFixed(9)} HYC`)
            for (const [key, miner] of this.mapMiner) {
                hashrateTotal += miner.hashrate
            }

            for (const [key, miner] of this.mapMiner) {
                const amount = net * miner.hashrate / hashrateTotal - this.txFee
                if (amount < 0) { continue }
                const tx = await this.makeTx(miner.address, amount, this.txFee)
                const newTx = await this.minerServer.txpool.putTxs([tx])
                this.minerServer.network.broadcastTxs(newTx)
            }
            for (const to of this.cofounder) {
                const amount = (income - net) * 0.5 - this.txFee
                if (amount < 0) { continue }
                const tx = await this.makeTx(to, amount, this.txFee)
                const newTx = await this.minerServer.txpool.putTxs([tx])
                this.minerServer.network.broadcastTxs(newTx)
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
        logger.warn(`sent ${tx.amount.toFixed(9)} HYC to ${tx.address} (${new Hash(signedTx).toString()})`)
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
