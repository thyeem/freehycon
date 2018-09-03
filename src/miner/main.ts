import { FreeHyconServer } from "./freehyconServer";
import { MongoServer } from "./mongoServer";
import { runFreehycon } from "./freehycon";
const cluster = require("cluster");
const http = require("http");
const numCPUs = require("os").cpus().length;

if (cluster.isMaster) {
  console.log(`Master ${process.pid} is running`);

  //  runFreehycon(true);

  // Fork workers.
  for (let i = 0; i < 1; i++) {
    cluster.fork();
  }

  cluster.on("exit", (worker: any, code: any, signal: any) => {
    console.log(`worker ${worker.process.pid} died`);
  });
} else {
  runFreehycon(false);

  console.log(`Worker ${process.pid} started`);
}
