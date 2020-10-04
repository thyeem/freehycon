#!/bin/bash 

sudo chmod 700 .ssh 
sudo chmod 600 .ssh/id_rsa 
sudo chmod 644 .ssh/id_rsa.pub .ssh/config 

sudo docker build -t freehycon . 

dangling=$(docker images -q -f dangling=true | wc -l)
if [ "$dangling" -gt 0 ]; then 
    sudo docker rmi $(docker images -q -f dangling=true)
fi

