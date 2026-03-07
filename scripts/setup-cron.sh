#!/bin/bash
# Install cron jobs to auto-update the dashboard snapshot
#
# Runs update-snapshot.sh at: 5am, noon, and 9pm daily
#
# Usage:
#   ./scripts/setup-cron.sh          # Install cron jobs
#   ./scripts/setup-cron.sh --remove # Remove cron jobs

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UPDATE_SCRIPT="${SCRIPT_DIR}/update-snapshot.sh"
INGEST_COMPUTING="${SCRIPT_DIR}/ingest-computing.sh"

if [ ! -f "$UPDATE_SCRIPT" ]; then
  echo "ERROR: update-snapshot.sh not found at $UPDATE_SCRIPT"
  exit 1
fi

chmod +x "$UPDATE_SCRIPT"
[ -f "$INGEST_COMPUTING" ] && chmod +x "$INGEST_COMPUTING"

# Remove mode
if [[ "${1}" == "--remove" ]]; then
  crontab -l 2>/dev/null | grep -v "$UPDATE_SCRIPT" | grep -v "$INGEST_COMPUTING" | crontab -
  echo "Cron jobs removed."
  echo "Remaining crontab:"
  crontab -l 2>/dev/null || echo "  (empty)"
  exit 0
fi

# Install mode — remove old entries first, then add fresh ones
(
  crontab -l 2>/dev/null | grep -v "$UPDATE_SCRIPT" | grep -v "$INGEST_COMPUTING"
  echo "0  5 * * * ${UPDATE_SCRIPT} >> ${SCRIPT_DIR}/../logs/cron.log 2>&1"
  echo "0 12 * * * ${UPDATE_SCRIPT} >> ${SCRIPT_DIR}/../logs/cron.log 2>&1"
  echo "0 21 * * * ${UPDATE_SCRIPT} >> ${SCRIPT_DIR}/../logs/cron.log 2>&1"
  echo "30 11 * * * ${INGEST_COMPUTING} >> ${SCRIPT_DIR}/../logs/cron.log 2>&1"
) | crontab -

echo "Cron jobs installed:"
echo ""
crontab -l | grep -E "$UPDATE_SCRIPT|$INGEST_COMPUTING"
echo ""
echo "Logs will be written to: ${SCRIPT_DIR}/../logs/"
echo "  auto-update.log  — full output from each run"
echo "  cron.log         — cron stdout/stderr"
echo ""
echo "To check status:  crontab -l"
echo "To remove:        ./scripts/setup-cron.sh --remove"
