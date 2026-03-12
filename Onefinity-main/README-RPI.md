# Onefinity CNC Controller - Raspberry Pi OS Image

Complete Raspberry Pi OS image for running Onefinity CNC Controller with automatic kiosk mode, touchscreen support, and dual deployment options.

## Quick Start

1. **Download image**: `onefinity-cnc-v1.0.0-rpi5-arm64.img.xz`
2. **Flash to SD card** (16GB+) using Raspberry Pi Imager or Etcher
3. **Insert SD card** into Raspberry Pi 5
4. **Power on** - First boot configures automatically (~5 minutes)
5. **Access interface**: `http://onefinity-cnc.local:6080`

Default credentials: `cnc` / `onefinity` (CHANGE THIS!)

## Features

✅ **Auto-start Kiosk Mode** - Boots directly to CNC interface on touchscreen
✅ **Dual Deployment** - Choose Docker or Native deployment
✅ **USB Serial Support** - Plug-and-play GRBL/grblHAL controllers
✅ **mDNS Enabled** - Access via `onefinity-cnc.local`
✅ **Pre-configured Firewall** - Secure by default
✅ **Optimized for Pi 5** - Hardware acceleration, resource tuning
✅ **Automatic Security Updates** - Keep system secure
✅ **Comprehensive Documentation** - Everything you need to know

## Hardware Requirements

### Minimum
- Raspberry Pi 4 (4GB RAM)
- 16GB microSD card
- USB CNC controller (GRBL compatible)

### Recommended
- Raspberry Pi 5 (8GB RAM)
- 32GB microSD card (UHS-I)
- 7" Raspberry Pi Touch Display
- Gigabit Ethernet

## Documentation

- **[Installation Guide](docs/INSTALLATION_GUIDE.md)** - Detailed installation instructions
- **[Test Plan](docs/TEST_PLAN.md)** - Complete testing checklist
- **[Project Status](docs/STATUS.md)** - Implementation status and features

## Directory Structure

```
.
├── backend/                    # Backend Node.js application
├── frontend/                   # Frontend React application
├── rpi-config/                 # Raspberry Pi image configuration
│   ├── image-config.yaml       # rpi-image-gen config
│   └── packages.list           # Required packages
├── systemd/                    # Systemd service files
│   ├── onefinity-docker.service
│   ├── onefinity-backend.service
│   ├── onefinity-frontend.service
│   └── redis-onefinity.service
├── kiosk/                      # Kiosk mode configuration
│   ├── kiosk-start.sh          # Chromium kiosk launcher
│   ├── onefinity.desktop       # Autostart entry
│   ├── lightdm.conf            # Auto-login config
│   └── xorg.conf               # Display settings
├── hardware/                   # Hardware configuration
│   ├── 99-serial-permissions.rules
│   ├── touchscreen-calibrate.sh
│   └── network-setup.sh
├── first-boot/                 # First boot wizard
│   ├── onefinity-setup-wizard.sh
│   └── onefinity-firstboot.service
├── install-scripts/            # Installation scripts
│   ├── setup-base.sh
│   ├── install-docker.sh
│   ├── install-native.sh
│   └── switch-deployment.sh
├── nginx/                      # Nginx configuration
│   └── onefinity-native.conf
├── optimization/               # System optimization
│   ├── disable-services.sh
│   └── config.txt.patch
├── monitoring/                 # Health checks
│   └── health-check.sh
├── build/                      # Image building
│   └── build-image.sh
├── config/                     # Configuration templates
│   └── env.production.template
└── docs/                       # Documentation
    ├── INSTALLATION_GUIDE.md
    └── TEST_PLAN.md
```

## Building the Image

### Prerequisites

- Linux system (Ubuntu 22.04+ recommended)
- 20GB+ free disk space
- Root access
- Internet connection

### Build Process

```bash
# Install dependencies
sudo apt install wget xz-utils coreutils mount

# Optional: Install PiShrink for smaller images
wget https://raw.githubusercontent.com/Drewsif/PiShrink/master/pishrink.sh
chmod +x pishrink.sh
sudo mv pishrink.sh /usr/local/bin/

# Build image
cd build
sudo ./build-image.sh
```

Output:
- `onefinity-cnc-v1.0.0-rpi5-arm64.img.xz` - Compressed image
- `onefinity-cnc-v1.0.0-rpi5-arm64.img.xz.sha256` - Checksum
- `release-notes.md` - Release documentation

## Manual Installation

If you prefer to build from source:

1. **Install base OS**: Raspberry Pi OS Desktop (64-bit)

2. **Run setup scripts**:
   ```bash
   sudo ./install-scripts/setup-base.sh
   sudo ./install-scripts/install-docker.sh  # or install-native.sh
   ```

3. **Configure kiosk mode** (optional):
   ```bash
   sudo cp kiosk/lightdm.conf /etc/lightdm/lightdm.conf.d/
   sudo cp kiosk/xorg.conf /etc/X11/xorg.conf.d/
   mkdir -p ~/.config/autostart
   cp kiosk/onefinity.desktop ~/.config/autostart/
   ```

## Deployment Modes

### Docker (Default)
- Containerized deployment
- Easy updates
- Isolated environment
- Higher memory usage (~500MB overhead)

### Native
- Direct system installation
- Lower memory usage
- Better performance
- More complex updates

**Switch modes:**
```bash
sudo /opt/onefinity/install-scripts/switch-deployment.sh [docker|native]
```

## Configuration

### Environment Variables

Edit `/opt/onefinity/config/.env`:

```bash
# Deployment mode
DEPLOYMENT_MODE=docker

# Backend settings
PORT=4000
REDIS_URL=redis://localhost:6379

# Kiosk settings
KIOSK_URL=http://localhost:6080
KIOSK_ENABLED=true

# Hardware settings
SERIAL_BAUDRATE=115200
```

### Network

```bash
# Set hostname
sudo hostnamectl set-hostname my-cnc

# Configure static IP
sudo /opt/onefinity/hardware/network-setup.sh

# Setup Wi-Fi
sudo raspi-config
```

### Security

```bash
# Change password
passwd

# Setup SSH keys
ssh-keygen
ssh-copy-id user@onefinity-cnc.local

# Check firewall
sudo ufw status
```

## Monitoring

### Health Check

```bash
sudo /opt/onefinity/monitoring/health-check.sh
```

Checks:
- CPU temperature
- CPU/memory/disk usage
- Service status
- Network connectivity
- Serial ports

### Logs

```bash
# Application logs
tail -f /opt/onefinity/logs/first-boot.log
tail -f /opt/onefinity/logs/kiosk.log

# Service logs
sudo journalctl -u onefinity-backend -f
sudo journalctl -u onefinity-docker -f

# Nginx logs
tail -f /var/log/nginx/onefinity.access.log
```

## Troubleshooting

### Can't access web interface

1. Check services: `sudo systemctl status onefinity-backend`
2. Check network: `ping onefinity-cnc.local`
3. Check firewall: `sudo ufw status`
4. Check logs: `sudo journalctl -u onefinity-backend -n 50`

### Serial port not detected

1. Check USB: `lsusb`
2. Check devices: `ls /dev/ttyUSB*`
3. Check permissions: `groups` (should include dialout)
4. Test connection: `screen /dev/ttyUSB0 115200`

### High resource usage

1. Check: `htop`
2. Switch to native: `sudo ./install-scripts/switch-deployment.sh native`
3. Disable services: `sudo ./optimization/disable-services.sh`

### Kiosk won't start

1. Check logs: `cat /opt/onefinity/logs/kiosk.log`
2. Test manually: `DISPLAY=:0 /opt/onefinity/kiosk/kiosk-start.sh`
3. Check autostart: `ls ~/.config/autostart/onefinity.desktop`

## Updating

### System Updates

```bash
sudo apt update
sudo apt upgrade
sudo reboot
```

### Application Updates

**Docker mode:**
```bash
cd /opt/onefinity/app
sudo docker-compose pull
sudo systemctl restart onefinity-docker
```

**Native mode:**
```bash
cd /opt/onefinity/app/backend
git pull
npm install
sudo systemctl restart onefinity-backend
```

## Backup and Restore

### Backup Configuration

```bash
sudo tar czf onefinity-backup.tar.gz \
  /opt/onefinity/config \
  /etc/systemd/system/onefinity-*.service \
  /etc/nginx/sites-available/onefinity
```

### Restore Configuration

```bash
sudo tar xzf onefinity-backup.tar.gz -C /
sudo systemctl daemon-reload
sudo systemctl restart onefinity-backend
```

## Contributing

1. Fork the repository
2. Create feature branch: `git checkout -b feature/amazing-feature`
3. Commit changes: `git commit -m 'Add amazing feature'`
4. Push to branch: `git push origin feature/amazing-feature`
5. Open Pull Request

## Testing

Run full test suite:

```bash
# Pre-flight checks
sudo /opt/onefinity/monitoring/health-check.sh

# See docs/TEST_PLAN.md for comprehensive testing
```

## License

[Your License Here]

## Acknowledgments

- Raspberry Pi Foundation
- GRBL Project
- grblHAL Project
- Community contributors

## Support

- **Issues**: [GitHub Issues]
- **Discussions**: [GitHub Discussions]
- **Documentation**: `/opt/onefinity/docs/`
- **Community**: [Forum/Discord Link]

## Roadmap

- [ ] Web-based configuration UI
- [ ] Multiple machine profiles
- [ ] Cloud backup integration
- [ ] Mobile app
- [ ] Advanced toolpath visualization
- [ ] Camera integration
- [ ] Job scheduling

## Release Notes

### v1.0.0 (2026-02-24)

**Features:**
- Initial release
- Auto-start kiosk mode
- Docker and Native deployment
- USB serial support
- Touchscreen support
- mDNS configuration
- Firewall setup
- Automatic updates
- Health monitoring

**Tested On:**
- Raspberry Pi 5 (8GB)
- Raspberry Pi 4 (4GB, 8GB)
- Various GRBL controllers
- Multiple touchscreen displays

**Known Issues:**
- None at release

---

**Made with ❤️ for the CNC community**
