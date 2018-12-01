import { Hash } from "./hash"
import { FC } from "../miner/config"
import { globalOptions } from "../main"
let getmac = require('getmac')

async function getGuid() {
    const macid = await new Promise((resolve, reject) => {
        getmac.getMac(function (err: any, macAddress: string) {
            resolve(macAddress);
        })
    })
    const guid = new Hash(macid.toString() + globalOptions.port).toString()
    console.log(`guid: ${guid}`)
    console.log(`macAddress: ${macid}`)
    console.log(`port: ${globalOptions.port}`)
    // console.log(`isCommander: ${guid === FC.COMMANDER_GUID}`)
    // console.log(`isMessenger: ${FC.MESSENGERS_GUID.indexOf(guid) > -1}`)
}

getGuid()
