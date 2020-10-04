FROM        ubuntu:16.04
MAINTAINER  freehycon

COPY        .ssh /root/.ssh
COPY        run.sh /root/run.sh
RUN         apt-get update
RUN         apt-get -y -qq install vim git curl build-essential 
RUN         apt-get -y -qq install libboost-all-dev libudev-dev libuv-dev libusb-dev
RUN         apt-get -y -qq install rabbitmq-server mongodb

RUN         curl -sL https://deb.nodesource.com/setup_8.x | bash -
RUN         apt-get install nodejs
RUN         npm install -g pm2
RUN         git clone https://github.com/freeolpark/freehycon.git /root/main

WORKDIR     /root/main
RUN         git checkout release
RUN         npm run clear 
RUN         npm install 

RUN         cp -af /root/main /root/sub 
RUN         cp -af /root/main /root/stratum 
RUN         sed -i 's/127\.0\.0\.1/0.0.0.0/g' /etc/mongodb.conf

COPY        config.ts /root/main/src/miner/config.ts
COPY        config.ts /root/sub/src/miner/config.ts
COPY        config.ts /root/stratum/src/miner/config.ts
COPY        peerdbsql /root/main/peerdbsql
COPY        peerdbsql /root/sub/peerdbsql
