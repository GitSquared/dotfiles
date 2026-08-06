#!/bin/bash
UNIT="$1"
HOSTNAME=$(hostname)

{
  echo "Subject: [straylight] $UNIT failed"
  echo "From: gabriel@saillard.dev"
  echo "To: gabriel@saillard.dev"
  echo ""
  echo "$UNIT failed on $HOSTNAME at $(date)"
  echo ""
  echo "=== Journal output ==="
  journalctl -u "$UNIT" -n 100 --no-pager
} | msmtp gabriel@saillard.dev
