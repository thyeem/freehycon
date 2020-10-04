#!/bin/bash 

p_main="-p 8148:8148"
p_sub="-p 8149:8149"
p_stratum="-p 9081:9081"
p_mongo="-p 27017:27017"

function main() {
    sudo docker run -d $p_main $p_mongo -it freehycon /bin/bash -c "/root/run.sh --main; while true;do sleep 100; done"
}

function sub() {
    sudo docker run -d $p_sub $p_mongo -it freehycon /bin/bash -c "/root/run.sh --sub; while true;do sleep 100; done"
}

function stratum() {
    sudo docker run -d $p_stratum $p_mongo -it freehycon /bin/bash -c "/root/run.sh --stratum; while true;do sleep 100; done"
}

function all() {
    sudo docker run -d $p_main $p_sub $p_stratum $p_mongo -it freehycon /bin/bash -c "/root/run.sh --all; while true;do sleep 100; done"
}

case "$1" in 
	--main)    main ;;
	--sub)     sub ;;
	--stratum) stratum ;;
	--all)     all ;;
	*)         echo "Usage: $0 [ --main | --sub | --stratum | --all ]"
esac 

