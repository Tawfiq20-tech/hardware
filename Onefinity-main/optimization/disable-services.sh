#!/bin/bash
#
# Onefinity CNC Controller - Disable Unnecessary Services
# Disables services not needed for CNC operation to save resources
#

set -e

LOG_FILE="/var/log/onefinity-optimization.log"

# Logging function
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

log "Disabling unnecessary services..."

# List of services to disable
SERVICES_TO_DISABLE=(
    "bluetooth.service"
    "hciuart.service"
    "cups.service"
    "cups-browsed.service"
    "ModemManager.service"
    "triggerhappy.service"
    "avahi-daemon.service"  # Only if mDNS not needed
    "wpa_supplicant.service"  # Only if Wi-Fi not used
)

# Disable services
for service in "${SERVICES_TO_DISABLE[@]}"; do
    if systemctl is-enabled "$service" &>/dev/null; then
        systemctl disable "$service" 2>/dev/null && log "Disabled $service" || log "Could not disable $service"
        systemctl stop "$service" 2>/dev/null && log "Stopped $service" || true
    else
        log "$service already disabled or doesn't exist"
    fi
done

log "Service optimization complete!"
