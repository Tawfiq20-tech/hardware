# Raspberry Pi Image Configuration

This directory contains configuration files for building a custom Raspberry Pi OS image for the Onefinity CNC controller.

## Files

### `image-config.yaml`
Main configuration file for the `rpi-image-gen` tool. Defines:
- Base OS (Raspberry Pi OS Desktop 64-bit)
- System settings (hostname, users, timezone)
- Network configuration (SSH, mDNS, firewall)
- Package installation
- Boot configuration
- Service management
- File overlays (custom scripts and configs)

### `packages.list`
Comprehensive list of Debian packages to install. Organized by category:
- System core and development tools
- Node.js, Python, and runtime environments
- Docker and containerization
- Display server and kiosk mode (X11, Chromium)
- Touchscreen support
- Serial communication utilities
- Network services and security
- Monitoring and management tools

## Usage with rpi-image-gen

1. **Install rpi-image-gen:**
   ```bash
   git clone https://github.com/raspberrypi/rpi-image-gen
   cd rpi-image-gen
   ```

2. **Copy configuration:**
   ```bash
   cp /path/to/rpi-config/image-config.yaml config/
   cp /path/to/rpi-config/packages.list config/
   ```

3. **Prepare overlay directories:**
   Ensure all referenced directories exist:
   - `../systemd/` - Systemd service files
   - `../kiosk/` - Kiosk mode scripts
   - `../hardware/` - udev rules
   - `../install-scripts/` - Setup scripts
   - `../first-boot/` - First boot wizard
   - `../optimization/` - Performance tuning
   - `../monitoring/` - Health checks
   - `../nginx/` - Web server configs
   - `../app-template/` - Application structure

4. **Build the image:**
   ```bash
   ./build.sh --config config/image-config.yaml
   ```

5. **Output:**
   - Image file: `onefinity-cnc-v1.0.0-rpi5-arm64.img.xz`
   - Checksum: `onefinity-cnc-v1.0.0-rpi5-arm64.img.xz.sha256`

## Manual Customization Alternative

If `rpi-image-gen` is not suitable, use these configurations as a reference for manual setup:

1. Flash standard Raspberry Pi OS Desktop (64-bit)
2. Boot and run initial setup
3. Install packages from `packages.list`:
   ```bash
   sudo apt update
   sudo apt install -y $(grep -v '^#' packages.list | grep -v '^$')
   ```
4. Apply configurations from `image-config.yaml` manually
5. Copy overlay files to their destinations
6. Enable/disable services as specified
7. Create image backup:
   ```bash
   sudo dd if=/dev/mmcblk0 of=onefinity-cnc.img bs=4M status=progress
   ```

## Configuration Notes

### User Accounts
- Default user: `cnc` (password must be changed on first boot)
- Groups: `sudo`, `dialout`, `video`, `audio`, `plugdev`

### Network
- Hostname: `onefinity-cnc`
- mDNS enabled: `onefinity-cnc.local`
- SSH enabled by default
- Firewall configured with ufw

### Hardware Support
- USB serial ports: Full support with proper permissions
- Touchscreen: Calibration tools included
- Raspberry Pi 5 optimized: GPU memory, hardware acceleration

### Boot Configuration
- GPU memory: 256MB (for desktop)
- Hardware acceleration: Enabled (vc4-kms-v3d)
- Bluetooth: Disabled by default (can be re-enabled)
- UART: Enabled for debugging

### Services
**Enabled:**
- SSH, Avahi (mDNS), Redis, Nginx, Docker
- UFW (firewall), unattended-upgrades

**Disabled:**
- Bluetooth, CUPS (printing), ModemManager, triggerhappy

## Customization

### To add more packages:
Edit `packages.list` and add package names (one per line)

### To modify system settings:
Edit `image-config.yaml` and adjust values in the respective sections

### To add custom files:
Add overlay entries in `image-config.yaml`:
```yaml
overlays:
  - source: "path/to/source"
    destination: "/path/in/image"
    owner: "user"
    group: "group"
    mode: "0755"
```

### To run custom scripts during build:
Add script paths in `image-config.yaml`:
```yaml
scripts:
  post_install:
    - "/path/to/script.sh"
```

## Target Hardware

- **Primary:** Raspberry Pi 5 (8GB recommended)
- **Compatible:** Raspberry Pi 4 (4GB+)
- **Architecture:** ARM64 (64-bit)
- **Storage:** 16GB+ SD card or SSD

## Dependencies

All required dependencies are listed in `packages.list`. Key components:
- Node.js v18+ (for backend)
- Redis 7+ (for job queue)
- Nginx (for frontend serving)
- Docker & Docker Compose (for container deployment)
- Chromium (for kiosk mode)

## Security Considerations

Default security features:
- UFW firewall enabled (limited ports)
- fail2ban for SSH protection
- Unattended security updates
- Non-root user with sudo access
- SSH enabled (recommend key-based auth)

**Important:** Change default password on first boot!

## Troubleshooting

### Build fails with package errors
- Check internet connection
- Update package lists: `sudo apt update`
- Verify package names are correct for Debian Bookworm

### Image too large
- Remove optional packages (documentation, Bluetooth)
- Disable desktop environment (use Lite variant)
- Reduce GPU memory allocation

### Services don't start
- Check systemd service files in `../systemd/`
- Verify file permissions (executable scripts need 0755)
- Check logs: `journalctl -u service-name`

## References

- [rpi-image-gen GitHub](https://github.com/raspberrypi/rpi-image-gen)
- [Raspberry Pi Documentation](https://www.raspberrypi.com/documentation/)
- [Debian Package Search](https://packages.debian.org/)
