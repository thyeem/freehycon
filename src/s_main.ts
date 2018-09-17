import { configure, getLogger } from "log4js"
import { showHelp } from "./help"
const logger = getLogger("Main")
configure({
    appenders: {
        console: {
            type: "log4js-protractor-appender",
        },
        fileLogs: {
            filename: `./logs/${new Date().getFullYear()}-${(new Date().getMonth()) + 1}-${new Date().getDate()}/logFile.log`,
            keepFileExt: true,
            maxLogSize: 16777216,
            pattern: ".yyyy-MM-dd",
            type: "dateFile",
        },
    },
    categories: {
        default: { appenders: ["console", "fileLogs"], level: "info" },
    },
})

import commandLineArgs = require("command-line-args")
const optionDefinitions = [
    { name: "api", alias: "a", type: Boolean },
    { name: "api_port", alias: "A", type: Number },
    { name: "bootstrap", type: Boolean },
    { name: "blockchain_info", alias: "B", type: String },
    { name: "config", alias: "c", type: String },
    { name: "cpuMiners", alias: "m", type: Number },
    { name: "data", alias: "d", type: String },
    { name: "disable_upnp", alias: "x", type: Boolean },
    { name: "disable_nat", alias: "N", type: Boolean },
    { name: "genesis", alias: "G", type: String },
    { name: "help", alias: "h", type: Boolean },
    { name: "lite", type: Boolean },
    { name: "minerAddress", alias: "M", type: String },
    { name: "networkid", alias: "n", type: String },
    { name: "nonLocal", alias: "l", type: Boolean },
    { name: "peer", type: String, multiple: true, defaultOption: true },
    { name: "port", alias: "p", type: Number },
    { name: "postfix", alias: "P", type: String },
    { name: "public_rest", alias: "R", type: Boolean },
    { name: "str_port", alias: "s", type: Number },
    { name: "verbose", alias: "v", type: Boolean, defaultOption: false },
    { name: "visualize", alias: "V", type: Boolean },
    { name: "wallet", alias: "W", type: Boolean },
    { name: "writing", alias: "w", type: Boolean },
    { name: "stratum", alias: "S", type: Boolean },
    { name: "banker", alias: "b", type: Boolean },
    { name: "collector", alias: "C", type: Boolean },
]

export const globalOptions = commandLineArgs(optionDefinitions)
