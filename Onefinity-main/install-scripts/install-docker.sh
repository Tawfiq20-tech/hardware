#!/bin/bash
#
# Onefinity CNC Controller - Docker Deployment Installation
# Installs Docker and sets up Docker Compose deployment
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="/opt/onefinity/app"
LOG_FILE="/var/log/onefinity-docker-install.log"

# Logging function
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

log "======================================"
log "Onefinity CNC - Docker Installation"
log "======================================"

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    echo "Please run as root: sudo $0"
    exit 1
fi

# Install Docker
log "Installing Docker..."
if ! command -v docker &>/dev/null; then
    apt update
    apt install -y docker.io docker-compose containerd runc
    systemctl enable docker
    systemctl start docker
    log "Docker installed successfully"
else
    log "Docker already installed"
fi

# Add cnc user to docker group
log "Adding cnc user to docker group..."
usermod -a -G docker cnc

# Verify Docker installation
log "Verifying Docker installation..."
docker --version
docker-compose --version

# Copy application files
log "Setting up application files..."
if [ ! -d "$APP_DIR/backend" ]; then
    log "Warning: Backend directory not found at $APP_DIR/backend"
    log "Please copy application files to $APP_DIR"
fi

# Copy Docker Compose file
if [ -f "$SCRIPT_DIR/../docker-compose.rpi.yml" ]; then
    cp "$SCRIPT_DIR/../docker-compose.rpi.yml" "$APP_DIR/docker-compose.yml"
    log "Docker Compose configuration copied"
fi

# Copy environment file
if [ ! -f "$APP_DIR/.env" ]; then
    if [ -f "$SCRIPT_DIR/../config/env.production.template" ]; then
        cp "$SCRIPT_DIR/../config/env.production.template" "$APP_DIR/.env"
        log "Environment file created"
    fi
fi

# Install systemd service
log "Installing systemd service..."
if [ -f "$SCRIPT_DIR/../systemd/onefinity-docker.service" ]; then
    cp "$SCRIPT_DIR/../systemd/onefinity-docker.service" /etc/systemd/system/
    systemctl daemon-reload
    systemctl enable onefinity-docker.service
    log "Systemd service installed and enabled"
fi

# Set permissions
log "Setting permissions..."
chown -R cnc:cnc "$APP_DIR"

# Pull Docker images (if online)
log "Pulling Docker images..."
cd "$APP_DIR"
if docker-compose -f docker-compose.yml pull 2>/dev/null; then
    log "Docker images pulled successfully"
else
    log "Could not pull images (offline or network issue)"
fi

# Create deployment mode file
echo "DEPLOYMENT_MODE=docker" > /opt/onefinity/config/deployment.conf

log "Docker installation complete!"
log ""
log "To start services:"
log "  sudo systemctl start onefinity-docker.service"
log ""
log "To check status:"
log "  sudo systemctl status onefinity-docker.service"
log "  docker ps"
log ""
log "Access interface at:"
log "  http://$(hostname).local:6080"
log "  http://$(hostname -I | awk '{print $1}'):6080"
