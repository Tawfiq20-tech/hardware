#!/bin/bash
#
# Onefinity CNC Controller - Kiosk Mode Launcher
# Starts Chromium in full-screen kiosk mode for CNC operation
#

set -e

# Configuration
KIOSK_URL="${KIOSK_URL:-http://localhost:6080}"
CHROMIUM_USER_DIR="/home/cnc/.config/chromium-kiosk"
LOG_FILE="/opt/onefinity/logs/kiosk.log"

# Logging function
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

log "Starting Onefinity CNC Kiosk Mode..."

# Wait for X server to be ready
while ! xset q &>/dev/null; do
    log "Waiting for X server..."
    sleep 1
done
log "X server is ready"

# Wait for network to be ready
log "Waiting for network..."
for i in {1..30}; do
    if ping -c 1 localhost &>/dev/null; then
        log "Network is ready"
        break
    fi
    sleep 1
done

# Wait for web service to be ready
log "Waiting for web service at $KIOSK_URL..."
for i in {1..60}; do
    if curl -s -o /dev/null -w "%{http_code}" "$KIOSK_URL" | grep -q "200\|301\|302"; then
        log "Web service is ready"
        break
    fi
    log "Web service not ready yet (attempt $i/60)..."
    sleep 2
done

# Disable screen saver and power management
log "Disabling screen saver and power management..."
xset s off
xset s noblank
xset -dpms

# Hide mouse cursor after inactivity (5 seconds)
if command -v unclutter &>/dev/null; then
    log "Starting unclutter to hide mouse cursor..."
    unclutter -idle 5 -root &
fi

# Set display resolution (optional, adjust as needed)
# xrandr --output HDMI-1 --mode 1920x1080

# Configure touchscreen (if xinput-calibrator data is available)
if [ -f "/etc/X11/xorg.conf.d/99-calibration.conf" ]; then
    log "Touchscreen calibration found"
fi

# Clear any previous Chromium crash flags
rm -rf "$CHROMIUM_USER_DIR/Singleton*" 2>/dev/null || true
rm -rf "$CHROMIUM_USER_DIR/Default/Preferences.bak" 2>/dev/null || true

# Create Chromium user directory
mkdir -p "$CHROMIUM_USER_DIR"

# Chromium kiosk flags
CHROMIUM_FLAGS=(
    # Kiosk mode
    --kiosk
    --start-fullscreen
    
    # Disable UI elements
    --noerrdialogs
    --disable-infobars
    --no-first-run
    --disable-session-crashed-bubble
    --disable-crash-reporter
    --disable-features=TranslateUI
    --disable-features=Translate
    
    # Performance optimizations
    --disk-cache-size=1
    --media-cache-size=1
    --disable-background-networking
    --disable-sync
    --disable-default-apps
    --disable-extensions
    
    # Touch support
    --touch-events=enabled
    --enable-features=OverlayScrollbar
    
    # Disable prompts
    --no-default-browser-check
    --disable-popup-blocking
    --disable-prompt-on-repost
    
    # User data directory
    --user-data-dir="$CHROMIUM_USER_DIR"
    
    # Target URL
    "$KIOSK_URL"
)

# Log Chromium version
CHROMIUM_VERSION=$(chromium-browser --version 2>/dev/null || echo "unknown")
log "Chromium version: $CHROMIUM_VERSION"

# Launch Chromium in kiosk mode
log "Launching Chromium with URL: $KIOSK_URL"
log "Chromium flags: ${CHROMIUM_FLAGS[*]}"

# Start Chromium and log output
chromium-browser "${CHROMIUM_FLAGS[@]}" 2>&1 | tee -a "$LOG_FILE" &
CHROMIUM_PID=$!

log "Chromium started with PID: $CHROMIUM_PID"

# Monitor Chromium process
while kill -0 $CHROMIUM_PID 2>/dev/null; do
    sleep 10
done

log "Chromium process ended, kiosk mode stopped"
exit 0
