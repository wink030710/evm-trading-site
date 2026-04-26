awk '/Not allowed function found in transaction / { if (!seen[$0]++) print }' /home/g7/.pm2/logs/server-out.log > filter2.log

awk '/Insufficient / { if (!seen[$0]++) print }' /home/g7/.pm2/logs/server-out.log > filter3.log