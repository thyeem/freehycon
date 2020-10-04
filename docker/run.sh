#!/bin/bash 

function init() {
    /etc/init.d/mongodb start 
    /etc/init.d/rabbitmq-server start 

    rabbitmqctl add_user freehycon freehycon
    rabbitmqctl set_user_tags freehycon administrator
    rabbitmqctl set_permissions -p / freehycon ".*" ".*" ".*"
}

function main() {
    cd /root/main 
    pm2 start --name "main" npm -- run main
}

function sub() {
    cd /root/sub
    pm2 start --name "sub" npm -- run sub
}

function stratum() {
    cd /root/stratum 
    pm2 start --name "stratum" npm -- run stratum 
}

case "$1" in 
	--main)    init; main ;;
	--sub)     init; sub ;;
	--stratum) init; stratum ;;
	--all)     init; main; sub; stratum ;;
	*)         echo "Usage: $0 [ --main | --sub | --stratum | --all ]"
esac 

