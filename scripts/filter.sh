#!/usr/bin/env bash
# Usage: ./filter.sh [path/to/server-out.log]
# Single awk pass: line filters (deduped) + SS58 blocks between '=' separator lines (deduped blocks).
set -euo pipefail

LOG="${1:-/home/g7/.pm2/logs/server-out.log}"
ADDR='5DJ9HHjsE4NTNX4w46zAmtEWNMFESb6FUbfcuQRwm9qVRjAM'
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

awk -v ADDR="$ADDR" -v BASE="$SCRIPT_DIR" '
  BEGIN {
    f2 = BASE "/filter2.log"
    f3 = BASE "/filter3.log"
    f4 = BASE "/filter4.log"
    f5 = BASE "/filter_blocks_ss58.log"
  }
  function flush_block() {
    if (buf != "" && index(buf, ADDR) > 0) {
      if (!seen5[buf]++) {
        if (lead_sep != "") printf "%s", lead_sep > f5
        printf "%s", buf > f5
      }
    }
  }
  /^=+$/ {
    flush_block()
    lead_sep = $0 ORS
    buf = ""
    next
  }
  {
    if (/^Not allowed function found in transaction / && !seen2[$0]++) print $0 > f2
    if (/^Insufficient / && !seen3[$0]++) print $0 > f3
    if (substr($0, 1, length(ADDR)) == ADDR && !seen4[$0]++) print $0 > f4
    buf = buf $0 ORS
  }
  END {
    flush_block()
    close(f2); close(f3); close(f4); close(f5)
  }
' "$LOG"

echo "Wrote ${SCRIPT_DIR}/filter2.log"
echo "Wrote ${SCRIPT_DIR}/filter3.log"
echo "Wrote ${SCRIPT_DIR}/filter4.log"
echo "Wrote ${SCRIPT_DIR}/filter_blocks_ss58.log"
