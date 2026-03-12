#!/bin/bash
#
# Onefinity CNC Controller - First Boot Setup Wizard
# Interactive configuration script that runs on first boot
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="/opt/onefinity/config/deployment.conf"
LOG_FILE="/opt/onefinity/logs/first-boot.log"
COMPLETION_FLAG="/opt/onefinity/.first-boot-complete"

# Logging function
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# Check if already completed
if [ -f "$COMPLETION_FLAG" ]; then
    log "First boot setup already completed. Exiting."
    exit 0
fi

log "==================================="
log "Onefinity CNC - First Boot Setup"
log "==================================="

#
#================================================================
# Step 1: Expand Filesystem
# ================================================================
expand_filesystem() {
    log "Step 1: Expanding filesystem..."
    
    if command -v raspi-config &>/dev/null; then
        log "Expanding root partition..."
        raspi-config nonint do_expand_rootfs
        log "Filesystem will expand on next reboot"
    else
        log "raspi-config not found, skipping filesystem expansion"
    fi
}

# ================================================================
# Step 2: Set Timezone and Locale
# ================================================================
configure_locale() {
    log "Step 2: Configuring locale and timezone..."
    
    # Detect or prompt for timezone
    if [ -n "$1" ]; then
        TIMEZONE="$1"
    else
        # Try to detect timezone
        TIMEZONE=$(timedatectl show --property=Timezone --value 2>/dev/null || echo "UTC")
        log "Current timezone: $TIMEZONE"
    fi
    
    # Set timezone
    timedatectl set-timezone "$TIMEZONE" 2>/dev/null || log "Could not set timezone"
    
    log "Timezone set to: $(timedatectl show --property=Timezone --value)"
}

# ================================================================
# Step 3: Configure Hostname
# ================================================================
configure_hostname() {
    log "Step 3: Configuring hostname..."
    
    local hostname="${1:-onefinity-cnc}"
    
    # Set hostname
    hostnamectl set-hostname "$hostname"
    
    # Update /etc/hosts
    sed -i "s/127\.0\.1\.1.*/127.0.1.1\t$hostname/" /etc/hosts
    
    log "Hostname set to: $hostname"
}

# ================================================================
# Step 4: Configure Network
# ================================================================
configure_network() {
    log "Step 4: Configuring network..."
    
    # Enable mDNS (Avahi)
    if command -v avahi-daemon &>/dev/null; then
        systemctl enable avahi-daemon
        systemctl start avahi-daemon
        log "mDNS enabled: $(hostname).local"
    fi
    
    # Configure firewall
    if command -v ufw &>/dev/null; then
        log "Configuring firewall..."
        ufw --force reset >/dev/null 2>&1
        ufw default deny incoming
        ufw default allow outgoing
        ufw allow 22/tcp comment 'SSH'
        ufw allow 80/tcp comment 'HTTP'
        ufw allow 443/tcp comment 'HTTPS'
        ufw allow 6070/tcp comment 'Backend'
        ufw allow 6080/tcp comment 'Frontend'
        ufw allow 5353/udp comment 'mDNS'
        ufw --force enable
        log "Firewall configured"
    fi
}

# ================================================================
# Step 5: Choose Deployment Mode
# ================================================================
choose_deployment() {
    log "Step 5: Configuring deployment mode..."
    
    local mode="${1:-docker}"
    
    # Save deployment mode
    mkdir -p "$(dirname "$CONFIG_FILE")"
    echo "DEPLOYMENT_MODE=$mode" > "$CONFIG_FILE"
    
    log "Deployment mode set to: $mode"
    
    if [ "$mode" = "docker" ]; then
        log "Enabling Docker deployment..."
        systemctl enable docker
        systemctl enable onefinity-docker.service
        systemctl disable onefinity-backend.service 2>/dev/null || true
        systemctl disable onefinity-frontend.service 2>/dev/null || true
        systemctl disable redis-onefinity.service 2>/dev/null || true
    else
        log "Enabling native deployment..."
        systemctl enable redis-onefinity.service
        systemctl enable onefinity-backend.service
        systemctl enable onefinity-frontend.service
        systemctl disable onefinity-docker.service 2>/dev/null || true
    fi
}

# ================================================================
# Step 6: Configure Users and Permissions
# ================================================================
configure_users() {
    log "Step 6: Configuring users and permissions..."
    
    # Add cnc user to required groups
    usermod -a -G dialout,video,audio,plugdev,docker cnc 2>/dev/null || log "Some groups may not exist"
    
    # Set permissions on application directories
    chown -R cnc:cnc /opt/onefinity/app 2>/dev/null || log "App directory not found"
    chown -R cnc:cnc /opt/onefinity/logs 2>/dev/null || log "Logs directory not found"
    
    log "User permissions configured"
}

# ================================================================
# Step 7: Disable Unnecessary Services
# ================================================================
disable_services() {
    log "Step 7: Disabling unnecessary services..."
    
    # List of services to disable (save resources)
    local services=(
        "bluetooth"
        "hciuart"
        "cups"
        "cups-browsed"
        "ModemManager"
        "triggerhappy"
    )
    
    for service in "${services[@]}"; do
        if systemctl is-enabled "$service" &>/dev/null; then
            systemctl disable "$service" 2>/dev/null || true
            log "Disabled $service"
        fi
    done
}

# ================================================================
# Step 8: Configure Kiosk Mode
# ================================================================
configure_kiosk() {
    log "Step 8: Configuring kiosk mode..."
    
    local enable_kiosk="${1:-true}"
    
    if [ "$enable_kiosk" = "true" ]; then
        # Copy kiosk configuration
        if [ -d "/opt/onefinity/kiosk" ]; then
            # Configure LightDM auto-login
            if [ -f "/opt/onefinity/kiosk/lightdm.conf" ]; then
                cp /opt/onefinity/kiosk/lightdm.conf /etc/lightdm/lightdm.conf.d/90-onefinity-kiosk.conf
                log "LightDM auto-login configured"
            fi
            
            # Copy Xorg configuration
            if [ -f "/opt/onefinity/kiosk/xorg.conf" ]; then
                mkdir -p /etc/X11/xorg.conf.d
                cp /opt/onefinity/kiosk/xorg.conf /etc/X11/xorg.conf.d/10-onefinity-display.conf
                log "Xorg display configured"
            fi
            
            # Setup autostart for cnc user
            mkdir -p /home/cnc/.config/autostart
            if [ -f "/opt/onefinity/kiosk/onefinity.desktop" ]; then
                cp /opt/onefinity/kiosk/onefinity.desktop /home/cnc/.config/autostart/
                chown -R cnc:cnc /home/cnc/.config
                log "Kiosk autostart configured"
            fi
            
            log "Kiosk mode enabled"
        fi
    else
        log "Kiosk mode disabled"
    fi
}

# ================================================================
# Step 9: Initialize Application
# ================================================================
initialize_application() {
    log "Step 9: Initializing application..."
    
    # Create required directories
    mkdir -p /opt/onefinity/{app,config,logs,backups}
    chown -R cnc:cnc /opt/onefinity
    
    # Copy environment template if not exists
    if [ ! -f "/opt/onefinity/config/.env" ]; then
        if [ -f "/opt/onefinity/app/config/env.production.template" ]; then
            cp /opt/onefinity/app/config/env.production.template /opt/onefinity/config/.env
            log "Environment file created"
        fi
    fi
    
    log "Application initialized"
}

# ================================================================
# Step 10: Mark Setup Complete
# ================================================================
mark_complete() {
    log "Step 10: Finalizing setup..."
    
    # Create completion flag
    touch "$COMPLETION_FLAG"
    chmod 644 "$COMPLETION_FLAG"
    
    log "First boot setup completed successfully!"
}

# ================================================================
# Main Setup Process
# ================================================================
main() {
    log "Starting first boot setup..."
    
    # Parse command line arguments or use defaults
    HOSTNAME="${HOSTNAME:-onefinity-cnc}"
    TIMEZONE="${TIMEZONE:-UTC}"
    DEPLOYMENT_MODE="${DEPLOYMENT_MODE:-docker}"
    KIOSK_ENABLED="${KIOSK_ENABLED:-true}"
    
    # Run setup steps
    expand_filesystem
    configure_locale "$TIMEZONE"
    configure_hostname "$HOSTNAME"
    configure_network
    choose_deployment "$DEPLOYMENT_MODE"
    configure_users
    disable_services
    configure_kiosk "$KIOSK_ENABLED"
    initialize_application
    mark_complete
    
    log "==================================="
    log "Setup complete! System will reboot."
    log "After reboot, access at:"
    log "  - http://$HOSTNAME.local:6080"
    log "  - http://$(hostname -I | awk '{print $1}'):6080"
    log "==================================="
    
    # Schedule reboot
    log "Rebooting in 10 seconds..."
    sleep 10
    reboot
}

# Run main setup
main "$@"
