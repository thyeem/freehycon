#!/usr/local/bin/gnuplot -p

## minimum Fee: x=11958.941141594505
Tend = 11958.941141594505

set grid
set key above
set xrange [0:12000]
set yrange [0:3]
set xlabel "Time spent on FreeHycon (second)"
set ylabel "Pool Fee (%)"

### SET OUTPUT SVG ###########################################
set terminal svg size 600,400 fname 'Georgia' fsize 18
set output 'fee.svg'
set key font    ",16"
set xtics font  ",16" offset 0
set ytics font  ",16" offset 0 
set xlabel font ",18" offset 0,0.5
set ylabel font ",18" offset 3
set style line 1 lc rgb 'red' pt 7 ps 1.2
set style line 2 lc rgb '#ff5d56' pt 7 ps 1.2
set style line 3 lc rgb '#ff9f9b' pt 7 ps 1.2
set style line 4 lc rgb '#f7c3c0' pt 7 ps 1.2

##############################################################
### SET OUTPUT PNG ###########################################
# set terminal pngcairo size 600,400 enhanced font 'arial,18'
# set output 'fee.png'
# set key font    ",16"
# set xtics font  ",16" offset 0
# set ytics font  ",16" offset 0 
# set xlabel font ",18" offset 0,0.2
# set ylabel font ",18" offset 2
# set style line 1 lc rgb 'red' pt 7 ps 2.5
# set style line 2 lc rgb '#ff5d56' pt 7 ps 2.5
# set style line 3 lc rgb '#ff9f9b' pt 7 ps 2.5
# set style line 4 lc rgb '#f7c3c0' pt 7 ps 2.5

##############################################################
### SET OUTPUT WXT ###########################################
# set key font    ",16"
# set xtics font  ",16" offset 0
# set ytics font  ",16" offset 0 
# set xlabel font ",18" offset 0,0.0
# set ylabel font ",18" offset 0
# set style line 1 lc rgb 'red' pt 7 ps 2.5
# set style line 2 lc rgb '#ff5d56' pt 7 ps 2.5
# set style line 3 lc rgb '#ff9f9b' pt 7 ps 2.5
# set style line 4 lc rgb '#f7c3c0' pt 7 ps 2.5
# set bmargin at screen 0.1
##############################################################

set label '2.90 %' at 350, 2.8 font ",18" tc 'red'
set label '1.45 %' at 3500, 1.7 font ",18" tc 'red'
set label '0.725 %' at 7100, 1.0 font ",18" tc 'red'
set label '0.29 %' at 10500, 0.5 font ",18" tc 'red'

pl 2.90 * exp( -log(2)/3600.0 * x ) w l lw 3 lc '#19d694' t 'Pool Fee Decay (Half-life: 1 hour)', \
"<echo '0 2.9'" w p t '0 second (max fee: 2.90 %) ' ls 1, \
"<echo '3600 1.45'" w p t '1 hour elapsed (1.45 %)' ls 2, \
"<echo '7200 0.725'" w p t '2 hours elapsed (0.725 %)' ls 3, \
"<echo '11958.941141594505 0.29'" w p t 'over 3 hours 19 mins (min fee: 0.29 %)' ls 4

pause mouse close