var cluster = require('cluster');
var http = require('http');
var numCPUs = require('os').cpus().length;
var Server = require('stratum').Server;


import { FreeHyconServer } from "./freehyconServer"
import { MongoServer } from "./mongoServer"
export async function runFreehycon(port: number) {
    if (cluster.isMaster) {
        // Fork workers.
        for (var i = 0; i < numCPUs; i++) {
            cluster.fork();
        }

        cluster.on('online', function (worker: any) {
            console.log('worker ' + worker.process.pid + ' online');
        });

        cluster.on('death', function (worker: any) {
            console.log('worker ' + worker.pid + ' died');
        });
    } else {
        const mongo = new MongoServer()
        const freeHyconServer = new FreeHyconServer(mongo, port)
    }
}

runFreehycon(9081)