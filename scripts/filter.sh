awk '
/^=+$/ {
  # At a separator: evaluate finished block in `block`
  if (block != "") {
    if (block ~ /Mev have staked/ && block !~ /Staking\.\.\./) {
      if (prev_block != "") {
        print prev_block
        print "================================================================================================================================================"
      }
      print block
      print ""  # blank line between matches
    }
    prev_block = block
    block = ""
  }
  next
}
{
  block = block $0 ORS
}
END {
  if (block != "") {
    if (block ~ /Mev have staked/ && block !~ /Staking\.\.\./) {
      if (prev_block != "") {
        print prev_block
        print "================================================================================================================================================"
      }
      print block
    }
  }
}
' /home/g7/.pm2/logs/server-out.log > filter1.log

awk '/Not allowed function found in transaction / { if (!seen[$0]++) print }' /home/g7/.pm2/logs/server-out.log > filter2.log

awk '/Infu / { if (!seen[$0]++) print }' /home/g7/.pm2/logs/server-out.log > filter3.log

awk '/Calls: / { if (!seen[$0]++) print }' /home/g7/.pm2/logs/server-out.log > filter4.log