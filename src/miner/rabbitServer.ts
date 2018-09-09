import { connect, Connection, Channel } from "amqplib";
import { getLogger } from "log4js";
import { MongoServer } from './mongoServer';

const logger = getLogger("RabbitMQ");
export class RabbitmqServer {
  conn: Connection = undefined;
  channel: Channel = undefined;
  ip: string = "amqp://localhost";
  //ip: string = 
  queueName: string = "hello";
  public constructor(queueName: string) {
    if (MongoServer.isReal) {
      this.ip = "amqp://freehycon:freehycon@172.31.20.102"
    }
    if (queueName !== undefined) this.queueName = queueName;

  }
  public async initialize() {
    logger.info(`Server ${this.ip}   Queue ${this.queueName}`);
    this.conn = await connect(this.ip);
    this.channel = await this.conn.createChannel();
    this.channel.assertExchange(this.queueName, 'fanout', { durable: false });
  }

  public finalize() {
    this.conn.close();
  }

  public async receive(callback: (msg: any) => void) {
    let tmpQueue = await this.channel.assertQueue('', { exclusive: true })
    this.channel.bindQueue(tmpQueue.queue, this.queueName, '')
    this.channel.consume(
      tmpQueue.queue,
      callback,
      { noAck: true }
    )
  }

  public send(msg: any) {
    if (this.channel !== undefined)
      this.channel.publish(this.queueName, '', Buffer.from(msg));
  }
}
