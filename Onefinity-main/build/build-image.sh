#!/bin/bash
#
# Onefinity CNC Controller - Image Build Script
# Automates the process of building a Raspberry Pi OS image
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="$SCRIPT_DIR/build"
IMAGE_NAME="onefinity-cnc-v1.0.0-rpi5-arm64.img"
COMPRESSED_IMAGE="${IMAGE_NAME}.xz"

# Configuration
RPI_OS_BASE_URL="https://downloads.raspberrypi.org/raspios_arm64/images"
RPI_OS_VERSION="2024-03-15"  # Update to latest version
USE_PISHRINK=true

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Logging
log() {
    echo -e "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

log_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

log_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

log_error() {
    echo -e "${RED}✗ $1${NC}"
}

# Check requirements
check_requirements() {
    log "Checking requirements..."
    
    local missing=()
    
    command -v wget >/dev/null 2>&1 || missing+=("wget")
    command -v xz >/dev/null 2>&1 || missing+=("xz-utils")
    command -v dd >/dev/null 2>&1 || missing+=("coreutils")
    command -v losetup >/dev/null 2>&1 || missing+=("mount")
    
    if [ ${#missing[@]} -gt 0 ]; then
        log_error "Missing required packages: ${missing[*]}"
        log "Install with: sudo apt install ${missing[*]}"
        exit 1
    fi
    
    if [ "$USE_PISHRINK" = true ] && ! command -v pishrink.sh >/dev/null 2>&1; then
        log_warning "PiShrink not found. Image will not be compressed optimally."
        log "Install from: https://github.com/Drewsif/PiShrink"
        USE_PISHRINK=false
    fi
    
    log_success "All requirements met"
}

# Download base image
download_base_image() {
    log "Downloading base Raspberry Pi OS image..."
    
    mkdir -p "$BUILD_DIR"
    cd "$BUILD_DIR"
    
    # This is a placeholder - adjust URL for actual image
    local base_image_url="${RPI_OS_BASE_URL}/raspios_arm64-${RPI_OS_VERSION}/raspios_arm64-${RPI_OS_VERSION}.img.xz"
    
    if [ ! -f "raspios-base.img.xz" ]; then
        log "Downloading from $base_image_url..."
        wget -O raspios-base.img.xz "$base_image_url" || {
            log_error "Download failed"
            exit 1
        }
    else
        log_warning "Base image already downloaded, skipping"
    fi
    
    log "Extracting image..."
    if [ ! -f "raspios-base.img" ]; then
        xz -d -k raspios-base.img.xz
    fi
    
    log_success "Base image ready"
}

# Copy and customize image
customize_image() {
    log "Customizing image..."
    
    # Copy base image
    cp raspios-base.img "$IMAGE_NAME"
    
    # Mount image (requires root)
    log "Mounting image..."
    sudo mkdir -p /mnt/onefinity-image
    
    # Find loop device
    LOOP_DEVICE=$(sudo losetup -f --show "$IMAGE_NAME")
    log "Using loop device: $LOOP_DEVICE"
    
    # Mount partitions
    sudo partprobe "$LOOP_DEVICE"
    sleep 2
    
    # Mount root partition (usually p2)
    sudo mount "${LOOP_DEVICE}p2" /mnt/onefinity-image
    
    # Mount boot partition
    sudo mount "${LOOP_DEVICE}p1" /mnt/onefinity-image/boot
    
    # Copy application files
    log "Copying application files..."
    sudo cp -r "$PROJECT_ROOT"/{backend,frontend,config,systemd,kiosk,hardware,first-boot,install-scripts,monitoring,optimization,nginx} \
        /mnt/onefinity-image/opt/onefinity/
    
    # Set permissions
    sudo chown -R 1000:1000 /mnt/onefinity-image/opt/onefinity
    
    # Install first-boot service
    log "Installing first-boot service..."
    sudo cp "$PROJECT_ROOT/first-boot/onefinity-firstboot.service" \
        /mnt/onefinity-image/etc/systemd/system/
    sudo chroot /mnt/onefinity-image systemctl enable onefinity-firstboot.service
    
    # Copy boot config optimizations
    log "Applying boot configuration..."
    sudo cat "$PROJECT_ROOT/optimization/config.txt.patch" >> /mnt/onefinity-image/boot/config.txt
    
    # Unmount
    log "Unmounting image..."
    sudo umount /mnt/onefinity-image/boot
    sudo umount /mnt/onefinity-image
    sudo losetup -d "$LOOP_DEVICE"
    sudo rmdir /mnt/onefinity-image
    
    log_success "Image customized"
}

# Shrink image
shrink_image() {
    if [ "$USE_PISHRINK" = true ]; then
        log "Shrinking image with PiShrink..."
        sudo pishrink.sh "$IMAGE_NAME"
        log_success "Image shrunk"
    else
        log_warning "Skipping image shrinking (PiShrink not available)"
    fi
}

# Compress image
compress_image() {
    log "Compressing image..."
    
    if [ -f "$COMPRESSED_IMAGE" ]; then
        rm "$COMPRESSED_IMAGE"
    fi
    
    xz -9 -k "$IMAGE_NAME"
    
    log_success "Image compressed: $COMPRESSED_IMAGE"
}

# Generate checksum
generate_checksum() {
    log "Generating SHA256 checksum..."
    
    sha256sum "$COMPRESSED_IMAGE" > "${COMPRESSED_IMAGE}.sha256"
    
    log_success "Checksum generated"
    cat "${COMPRESSED_IMAGE}.sha256"
}

# Create release notes
create_release_notes() {
    log "Creating release notes..."
    
    cat > release-notes.md <<EOF
# Onefinity CNC Controller - Raspberry Pi OS Image

**Version:** 1.0.0
**Build Date:** $(date '+%Y-%m-%d')
**Target Hardware:** Raspberry Pi 5 (compatible with Pi 4)
**Base OS:** Raspberry Pi OS Desktop (64-bit) - $RPI_OS_VERSION

## Features

- Auto-start kiosk mode on touchscreen
- Dual deployment support (Docker and Native)
- Pre-configured for CNC operation
- USB serial port support
- mDNS enabled (onefinity-cnc.local)
- Firewall configured
- Automatic security updates
- Optimized for Raspberry Pi 5

## Installation

1. Download the image:
   - \`$COMPRESSED_IMAGE\`
   - Verify checksum with \`$COMPRESSED_IMAGE.sha256\`

2. Flash to SD card (16GB+ recommended):
   - Using Raspberry Pi Imager
   - Or balenaEtcher
   - Or dd: \`sudo dd if=$IMAGE_NAME of=/dev/sdX bs=4M status=progress\`

3. Insert SD card into Raspberry Pi

4. First boot will:
   - Expand filesystem
   - Run setup wizard
   - Configure hostname
   - Enable services
   - Reboot automatically

5. After reboot:
   - Kiosk mode starts automatically
   - Access web interface at: http://onefinity-cnc.local:6080
   - Default user: cnc / password: onefinity (CHANGE THIS!)

## Default Configuration

- Hostname: onefinity-cnc
- Deployment mode: Docker
- Kiosk enabled: Yes
- SSH enabled: Yes
- Firewall enabled: Yes
- Ports open: 22 (SSH), 80 (HTTP), 6070 (Backend), 6080 (Frontend)

## Hardware Requirements

- Raspberry Pi 5 (8GB recommended) or Pi 4 (4GB+)
- 16GB+ SD card (32GB+ recommended)
- USB CNC controller (GRBL compatible)
- Optional: Touchscreen display
- Network connection (Ethernet or Wi-Fi)

## Post-Installation

1. Change default password:
   \`\`\`bash
   passwd
   \`\`\`

2. Configure Wi-Fi (if needed):
   \`\`\`bash
   sudo raspi-config
   \`\`\`

3. Switch deployment mode (if needed):
   \`\`\`bash
   sudo /opt/onefinity/install-scripts/switch-deployment.sh native
   \`\`\`

4. Calibrate touchscreen (if applicable):
   \`\`\`bash
   DISPLAY=:0 /opt/onefinity/hardware/touchscreen-calibrate.sh
   \`\`\`

## Support

- Documentation: /opt/onefinity/docs/
- Logs: /opt/onefinity/logs/
- Configuration: /opt/onefinity/config/

## Checksums

\`\`\`
$(cat "${COMPRESSED_IMAGE}.sha256")
\`\`\`

## Build Information

- Built on: $(date)
- Build host: $(hostname)
- Build script: $0

EOF

    log_success "Release notes created: release-notes.md"
}

# Main build process
main() {
    log "======================================"
    log "Onefinity CNC - Image Builder"
    log "======================================"
    echo ""
    
    # Check if running as root (needed for mount operations)
    if [ "$EUID" -ne 0 ]; then
        log_error "This script must be run as root for image customization"
        log "Usage: sudo $0"
        exit 1
    fi
    
    check_requirements
    
    # Option to skip download if image exists
    if [ -f "$BUILD_DIR/raspios-base.img" ]; then
        read -p "Base image exists. Re-download? (y/N) " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            download_base_image
        fi
    else
        download_base_image
    fi
    
    customize_image
    shrink_image
    compress_image
    generate_checksum
    create_release_notes
    
    echo ""
    log_success "Image build complete!"
    log "Output files:"
    log "  - Image: $BUILD_DIR/$COMPRESSED_IMAGE"
    log "  - Checksum: $BUILD_DIR/$COMPRESSED_IMAGE.sha256"
    log "  - Release notes: $BUILD_DIR/release-notes.md"
    log ""
    log "Flash to SD card with:"
    log "  xz -d $COMPRESSED_IMAGE"
    log "  sudo dd if=$IMAGE_NAME of=/dev/sdX bs=4M status=progress"
}

# Run if executed directly
if [ "${BASH_SOURCE[0]}" -eq "${0}" ]; then
    main "$@"
fi
