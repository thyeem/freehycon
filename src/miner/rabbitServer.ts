import { connect, Connection, Channel } from "amqplib";
import { getLogger } from "log4js";
const logger = getLogger("RabbitMQ");
export class RabbitmqServer {
  conn: Connection = undefined;
  channel: Channel = undefined;
  ip: string = "amqp://localhost";
  //ip: string = "amqp://172.31.20.102"
  queueName: string = "hello";
  public constructor(queueName: string) {
    if (queueName !== undefined) this.queueName = queueName;
    this.initialize();
  }
  public async initialize() {
    logger.info(`Server ${this.ip}   Queue ${this.queueName}`);
    this.conn = await connect(this.ip);
    this.channel = await this.conn.createChannel();
    this.channel.assertQueue(this.queueName, { durable: false });
  }

  public finalize() {
    this.conn.close();
  }

  public receive(callback: (msg: any) => void) {
    this.channel.consume(
      this.queueName,
      /*(msg: any) => {
        console.log(" [x] Received %s", msg.content.toString());
      }*/
      callback,
      { noAck: true }
    );
  }

  public send(msg: any) {
    this.channel.sendToQueue(this.queueName, Buffer.from(msg));
  }
}