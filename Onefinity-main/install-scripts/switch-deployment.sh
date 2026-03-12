#!/bin/bash
#
# Onefinity CNC Controller - Deployment Mode Switcher
# Switch between Docker and native deployment
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="/opt/onefinity/config/deployment.conf"
LOG_FILE="/var/log/onefinity-switch.log"

# Logging function
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    echo "Please run as root: sudo $0 [docker|native]"
    exit 1
fi

# Get target mode
TARGET_MODE="$1"

if [ -z "$TARGET_MODE" ]; then
    echo "Usage: $0 [docker|native]"
    echo ""
    echo "Current mode:"
    if [ -f "$CONFIG_FILE" ]; then
        cat "$CONFIG_FILE"
    else
        echo "No deployment mode configured"
    fi
    exit 1
fi

if [ "$TARGET_MODE" != "docker" ] && [ "$TARGET_MODE" != "native" ]; then
    echo "Error: Mode must be 'docker' or 'native'"
    exit 1
fi

log "========================================"
log "Switching to $TARGET_MODE deployment"
log "========================================"

# Stop all services
log "Stopping all services..."
if [ "$TARGET_MODE" = "docker" ]; then
    # Switching to Docker, stop native services
    log "Stopping native services..."
    systemctl stop onefinity-backend.service 2>/dev/null || true
    systemctl stop onefinity-frontend.service 2>/dev/null || true
    systemctl stop redis-onefinity.service 2>/dev/null || true
    systemctl disable onefinity-backend.service 2>/dev/null || true
    systemctl disable onefinity-frontend.service 2>/dev/null || true
    systemctl disable redis-onefinity.service 2>/dev/null || true
    
    # Enable Docker service
    log "Enabling Docker deployment..."
    systemctl enable onefinity-docker.service
    systemctl start onefinity-docker.service
    
    # Update environment
    if [ -f "/opt/onefinity/config/.env" ]; then
        sed -i 's|redis://localhost:6379|redis://redis:6379|g' /opt/onefinity/config/.env
    fi
    
else
    # Switching to native, stop Docker services
    log "Stopping Docker services..."
    systemctl stop onefinity-docker.service 2>/dev/null || true
    systemctl disable onefinity-docker.service 2>/dev/null || true
    
    # Stop Docker containers
    if command -v docker-compose &>/dev/null && [ -f "/opt/onefinity/app/docker-compose.yml" ]; then
        cd /opt/onefinity/app
        docker-compose down 2>/dev/null || true
    fi
    
    # Enable native services
    log "Enabling native deployment..."
    systemctl enable redis-onefinity.service
    systemctl enable onefinity-backend.service
    systemctl enable onefinity-frontend.service
    systemctl start redis-onefinity.service
    systemctl start onefinity-backend.service
    systemctl start onefinity-frontend.service
    
    # Update environment
    if [ -f "/opt/onefinity/config/.env" ]; then
        sed -i 's|redis://redis:6379|redis://localhost:6379|g' /opt/onefinity/config/.env
    fi
fi

# Update deployment mode file
log "Updating deployment configuration..."
echo "DEPLOYMENT_MODE=$TARGET_MODE" > "$CONFIG_FILE"

log "Deployment mode switched to: $TARGET_MODE"
log ""
log "Checking service status..."
sleep 3

if [ "$TARGET_MODE" = "docker" ]; then
    systemctl status onefinity-docker.service --no-pager
    echo ""
    echo "Docker containers:"
    docker ps
else
    systemctl status onefinity-backend.service --no-pager
    systemctl status onefinity-frontend.service --no-pager
fi

log ""
log "Switch complete! Access interface at:"
log "  http://$(hostname).local:6080 (Docker)"
log "  http://$(hostname).local (Native)"
