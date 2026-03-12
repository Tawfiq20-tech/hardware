#!/bin/bash
#
# Onefinity CNC Controller - Native Deployment Installation
# Installs Node.js, Redis, Nginx and sets up native services
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="/opt/onefinity/app"
LOG_FILE="/var/log/onefinity-native-install.log"

# Logging function
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

log "========================================="
log "Onefinity CNC - Native Installation"
log "========================================="

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    echo "Please run as root: sudo $0"
    exit 1
fi

# Install Node.js
log "Installing Node.js..."
if ! command -v node &>/dev/null; then
    apt update
    apt install -y nodejs npm
    log "Node.js installed: $(node --version)"
else
    log "Node.js already installed: $(node --version)"
fi

# Install Redis
log "Installing Redis..."
if ! command -v redis-server &>/dev/null; then
    apt install -y redis-server redis-tools
    systemctl enable redis-server
    systemctl start redis-server
    log "Redis installed and started"
else
    log "Redis already installed"
fi

# Install Nginx
log "Installing Nginx..."
if ! command -v nginx &>/dev/null; then
    apt install -y nginx
    systemctl enable nginx
    systemctl start nginx
    log "Nginx installed and started"
else
    log "Nginx already installed"
fi

# Setup backend
log "Setting up backend..."
if [ -d "$APP_DIR/backend" ]; then
    cd "$APP_DIR/backend"
    log "Installing backend dependencies..."
    npm ci --production
    log "Backend dependencies installed"
else
    log "Warning: Backend directory not found at $APP_DIR/backend"
fi

# Setup frontend
log "Setting up frontend..."
if [ -d "$APP_DIR/frontend/dist" ]; then
    log "Frontend build found"
elif [ -d "$APP_DIR/frontend" ]; then
    log "Building frontend..."
    cd "$APP_DIR/frontend"
    npm ci
    npm run build
    log "Frontend built successfully"
else
    log "Warning: Frontend directory not found at $APP_DIR/frontend"
fi

# Copy Nginx configuration
log "Configuring Nginx..."
if [ -f "$SCRIPT_DIR/../nginx/onefinity-native.conf" ]; then
    cp "$SCRIPT_DIR/../nginx/onefinity-native.conf" /etc/nginx/sites-available/onefinity
    ln -sf /etc/nginx/sites-available/onefinity /etc/nginx/sites-enabled/
    rm -f /etc/nginx/sites-enabled/default
    nginx -t
    systemctl reload nginx
    log "Nginx configured"
fi

# Copy environment file
log "Configuring environment..."
if [ ! -f "/opt/onefinity/config/.env" ]; then
    if [ -f "$SCRIPT_DIR/../config/env.production.template" ]; then
        cp "$SCRIPT_DIR/../config/env.production.template" /opt/onefinity/config/.env
        # Update for native deployment
        sed -i 's|redis://redis:6379|redis://localhost:6379|g' /opt/onefinity/config/.env
        log "Environment file created"
    fi
fi

# Install systemd services
log "Installing systemd services..."
for service in redis-onefinity onefinity-backend onefinity-frontend; do
    if [ -f "$SCRIPT_DIR/../systemd/$service.service" ]; then
        cp "$SCRIPT_DIR/../systemd/$service.service" /etc/systemd/system/
        log "Installed $service.service"
    fi
done

# Reload systemd and enable services
systemctl daemon-reload
systemctl enable redis-onefinity.service
systemctl enable onefinity-backend.service
systemctl enable onefinity-frontend.service

log "Services enabled"

# Set permissions
log "Setting permissions..."
chown -R cnc:cnc "$APP_DIR"
chown -R cnc:cnc /opt/onefinity

# Create deployment mode file
echo "DEPLOYMENT_MODE=native" > /opt/onefinity/config/deployment.conf

# Create log directories
mkdir -p /opt/onefinity/logs/sessions
chown -R cnc:cnc /opt/onefinity/logs

log "Native installation complete!"
log ""
log "To start services:"
log "  sudo systemctl start redis-onefinity.service"
log "  sudo systemctl start onefinity-backend.service"
log "  sudo systemctl start onefinity-frontend.service"
log ""
log "Or start all at once:"
log "  sudo systemctl start onefinity-native.target"
log ""
log "To check status:"
log "  sudo systemctl status onefinity-backend.service"
log "  sudo systemctl status onefinity-frontend.service"
log ""
log "Access interface at:"
log "  http://$(hostname).local"
log "  http://$(hostname -I | awk '{print $1}')"
