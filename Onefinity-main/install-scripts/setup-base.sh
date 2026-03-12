#!/bin/bash
#
# Onefinity CNC Controller - Base System Setup Script
# Prepares the base system with required packages and configuration
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_FILE="/var/log/onefinity-setup.log"

# Logging function
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

log "======================================"
log "Onefinity CNC - Base System Setup"
log "======================================"

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    echo "Please run as root: sudo $0"
    exit 1
fi

# Update package lists
log "Updating package lists..."
apt update

# Upgrade existing packages
log "Upgrading existing packages..."
apt upgrade -y

# Install essential packages
log "Installing essential packages..."
apt install -y \
    curl wget git vim nano \
    build-essential python3 python3-pip \
    net-tools avahi-daemon avahi-utils \
    ufw fail2ban unattended-upgrades

# Create onefinity user if doesn't exist
if ! id "cnc" &>/dev/null; then
    log "Creating cnc user..."
    useradd -m -s /bin/bash -G sudo,dialout,video,audio,plugdev cnc
    echo "cnc:onefinity" | chpasswd
    log "User 'cnc' created with default password 'onefinity' - CHANGE THIS!"
fi

# Create application directories
log "Creating application directories..."
mkdir -p /opt/onefinity/{app,config,logs,backups,scripts,kiosk,first-boot,monitoring,optimization}
chown -R cnc:cnc /opt/onefinity

# Configure serial port access
log "Configuring serial port access..."
usermod -a -G dialout cnc

# Enable mDNS
log "Enabling mDNS (Avahi)..."
systemctl enable avahi-daemon
systemctl start avahi-daemon

# Configure firewall
log "Configuring firewall..."
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment 'SSH'
ufw allow 80/tcp comment 'HTTP'
ufw allow 443/tcp comment 'HTTPS'
ufw allow 6070/tcp comment 'Backend'
ufw allow 6080/tcp comment 'Frontend'
ufw allow 5353/udp comment 'mDNS'
ufw --force enable

# Configure automatic security updates
log "Configuring automatic security updates..."
dpkg-reconfigure -plow unattended-upgrades

# Disable unnecessary services
log "Disabling unnecessary services..."
systemctl disable bluetooth 2>/dev/null || true
systemctl disable cups 2>/dev/null || true
systemctl disable ModemManager 2>/dev/null || true

# Configure swap
log "Configuring swap..."
if [ -f /etc/dphys-swapfile ]; then
    sed -i 's/^CONF_SWAPSIZE=.*/CONF_SWAPSIZE=1024/' /etc/dphys-swapfile
    dphys-swapfile setup
    dphys-swapfile swapon
fi

# Set GPU memory
log "Configuring GPU memory..."
if [ -f /boot/config.txt ]; then
    if ! grep -q "^gpu_mem=" /boot/config.txt; then
        echo "gpu_mem=256" >> /boot/config.txt
    fi
fi

log "Base system setup complete!"
log "Next steps:"
log "  1. Run install-docker.sh OR install-native.sh"
log "  2. Configure kiosk mode (optional)"
log "  3. Reboot the system"
