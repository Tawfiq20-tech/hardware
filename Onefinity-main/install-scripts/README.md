# Installation Scripts

This directory contains installation and setup scripts for Onefinity CNC Controller on Raspberry Pi.

## Scripts

### `setup-base.sh`
Base system setup script that prepares the Raspberry Pi:
- Updates and upgrades packages
- Creates cnc user
- Configures serial port access
- Enables mDNS (Avahi)
- Configures firewall (UFW)
- Sets up automatic security updates
- Disables unnecessary services
- Configures swap and GPU memory

**Usage:**
```bash
sudo ./setup-base.sh
```

### `install-docker.sh`
Docker deployment installation:
- Installs Docker and Docker Compose
- Adds cnc user to docker group
- Copies Docker Compose configuration
- Sets up environment files
- Installs systemd service
- Pulls Docker images
- Sets deployment mode to docker

**Usage:**
```bash
sudo ./install-docker.sh
```

### `install-native.sh`
Native deployment installation:
- Installs Node.js, Redis, and Nginx
- Installs backend dependencies
- Builds frontend (if needed)
- Configures Nginx
- Sets up environment files
- Installs systemd services
- Sets deployment mode to native

**Usage:**
```bash
sudo ./install-native.sh
```

### `switch-deployment.sh`
Switch between deployment modes:
- Stops current deployment
- Disables current services
- Enables new deployment
- Updates configuration files
- Starts new services

**Usage:**
```bash
# Switch to Docker
sudo ./switch-deployment.sh docker

# Switch to Native
sudo ./switch-deployment.sh native

# Check current mode
sudo ./switch-deployment.sh
```

## Installation Workflows

### Fresh Installation (Docker)

1. **Prepare base system:**
   ```bash
   sudo ./setup-base.sh
   ```

2. **Install Docker deployment:**
   ```bash
   sudo ./install-docker.sh
   ```

3. **Start services:**
   ```bash
   sudo systemctl start onefinity-docker.service
   ```

4. **Access interface:**
   - `http://onefinity-cnc.local:6080`

### Fresh Installation (Native)

1. **Prepare base system:**
   ```bash
   sudo ./setup-base.sh
   ```

2. **Install native deployment:**
   ```bash
   sudo ./install-native.sh
   ```

3. **Start services:**
   ```bash
   sudo systemctl start redis-onefinity.service
   sudo systemctl start onefinity-backend.service
   sudo systemctl start onefinity-frontend.service
   ```

4. **Access interface:**
   - `http://onefinity-cnc.local`

### Switch Between Modes

**From Docker to Native:**
```bash
sudo ./switch-deployment.sh native
```

**From Native to Docker:**
```bash
sudo ./switch-deployment.sh docker
```

## Prerequisites

### Before Running setup-base.sh

- Raspberry Pi OS (Desktop or Lite) installed
- Internet connection (for package installation)
- Root access (sudo)
- Minimum 8GB SD card

### Before Running install-docker.sh

- `setup-base.sh` completed
- Application files copied to `/opt/onefinity/app`
- At least 2GB free space (for Docker images)

### Before Running install-native.sh

- `setup-base.sh` completed
- Application source files in `/opt/onefinity/app`
- At least 1GB free space (for dependencies)

## Application Files Setup

Before installation, copy application files:

```bash
# Create application directory
sudo mkdir -p /opt/onefinity/app

# Copy backend
sudo cp -r /path/to/Onefinity-main/backend /opt/onefinity/app/

# Copy frontend (built or source)
sudo cp -r /path/to/Onefinity-main/frontend /opt/onefinity/app/

# Copy configuration templates
sudo cp -r /path/to/Onefinity-main/config /opt/onefinity/app/

# Copy systemd services
sudo cp -r /path/to/Onefinity-main/systemd /opt/onefinity/app/

# Copy other resources
sudo cp -r /path/to/Onefinity-main/{kiosk,hardware,first-boot} /opt/onefinity/

# Set permissions
sudo chown -R cnc:cnc /opt/onefinity
```

## Configuration

### Environment Variables

Edit `/opt/onefinity/config/.env` after installation:

```bash
sudo nano /opt/onefinity/config/.env
```

Key settings:
- `DEPLOYMENT_MODE` - docker or native
- `REDIS_URL` - redis://localhost:6379 (native) or redis://redis:6379 (docker)
- `LOG_LEVEL` - info, debug, warn, error
- `KIOSK_URL` - URL for kiosk mode
- `SERIAL_BAUDRATE` - Baud rate for CNC controller

### Deployment Mode

Check current deployment mode:
```bash
cat /opt/onefinity/config/deployment.conf
```

## Verification

### Check System Status

```bash
# Check services
sudo systemctl status onefinity-docker.service  # Docker mode
sudo systemctl status onefinity-backend.service # Native mode

# Check Docker containers
docker ps

# Check network connectivity
ping onefinity-cnc.local

# Check firewall
sudo ufw status

# Check logs
sudo journalctl -u onefinity-backend.service -n 50
```

### Test Web Interface

```bash
# Check if services are responding
curl -I http://localhost:6080  # Docker
curl -I http://localhost       # Native

# Check backend API
curl http://localhost:6070/api/health
```

### Verify Hardware Access

```bash
# Check serial ports
ls -la /dev/ttyUSB* /dev/ttyACM*

# Check user groups
groups cnc

# Check Docker device access (Docker mode only)
docker exec onefinity-backend ls -la /dev/ttyUSB0
```

## Troubleshooting

### Base Setup Issues

**Problem:** Package installation fails
```bash
# Update package lists
sudo apt update
sudo apt upgrade

# Check network
ping google.com

# Check disk space
df -h
```

**Problem:** User creation fails
```bash
# Check if user exists
id cnc

# Create manually
sudo useradd -m -s /bin/bash cnc
sudo usermod -a -G sudo,dialout,video,audio,plugdev cnc
```

### Docker Installation Issues

**Problem:** Docker service won't start
```bash
# Check Docker status
sudo systemctl status docker

# View logs
sudo journalctl -u docker -n 50

# Restart Docker
sudo systemctl restart docker
```

**Problem:** Permission denied for Docker
```bash
# Add user to docker group
sudo usermod -a -G docker cnc

# Logout and login again, or reboot
sudo reboot
```

**Problem:** Cannot pull images
```bash
# Check network
ping docker.io

# Pull manually
cd /opt/onefinity/app
sudo docker-compose pull
```

### Native Installation Issues

**Problem:** Node.js version too old
```bash
# Check version
node --version

# Install newer version
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs
```

**Problem:** npm install fails
```bash
# Clear npm cache
npm cache clean --force

# Install with verbose output
cd /opt/onefinity/app/backend
npm install --verbose
```

**Problem:** Nginx configuration error
```bash
# Test configuration
sudo nginx -t

# Check error log
sudo tail -f /var/log/nginx/error.log

# Verify file exists
ls -la /etc/nginx/sites-available/onefinity
```

### Switching Issues

**Problem:** Services don't stop/start
```bash
# Force stop all
sudo systemctl stop onefinity-docker.service
sudo systemctl stop onefinity-backend.service
sudo systemctl stop onefinity-frontend.service
sudo systemctl stop redis-onefinity.service

# Kill Docker containers
docker stop $(docker ps -aq)

# Then switch again
sudo ./switch-deployment.sh [mode]
```

## Uninstallation

### Remove Docker Deployment

```bash
# Stop and disable service
sudo systemctl stop onefinity-docker.service
sudo systemctl disable onefinity-docker.service

# Remove Docker containers and images
cd /opt/onefinity/app
docker-compose down --volumes --rmi all

# Remove service file
sudo rm /etc/systemd/system/onefinity-docker.service
sudo systemctl daemon-reload
```

### Remove Native Deployment

```bash
# Stop and disable services
sudo systemctl stop onefinity-backend.service onefinity-frontend.service redis-onefinity.service
sudo systemctl disable onefinity-backend.service onefinity-frontend.service redis-onefinity.service

# Remove service files
sudo rm /etc/systemd/system/onefinity-*.service
sudo rm /etc/systemd/system/redis-onefinity.service
sudo systemctl daemon-reload

# Remove Nginx configuration
sudo rm /etc/nginx/sites-enabled/onefinity
sudo rm /etc/nginx/sites-available/onefinity
sudo systemctl reload nginx
```

### Complete Removal

```bash
# Remove application files
sudo rm -rf /opt/onefinity

# Remove user (optional)
sudo userdel -r cnc

# Remove packages (optional)
sudo apt remove --purge docker.io docker-compose nodejs redis-server
sudo apt autoremove
```

## Logs

All scripts write logs to `/var/log/`:

```bash
# View installation logs
sudo tail -f /var/log/onefinity-setup.log
sudo tail -f /var/log/onefinity-docker-install.log
sudo tail -f /var/log/onefinity-native-install.log
sudo tail -f /var/log/onefinity-switch.log
```

## Best Practices

1. **Run setup-base.sh first** before any deployment
2. **Choose one deployment mode** initially (recommend Docker for beginners)
3. **Test thoroughly** before production use
4. **Backup configuration** before switching modes
5. **Monitor logs** during installation
6. **Verify each step** before proceeding
7. **Keep scripts updated** with latest versions

## Security Notes

- All scripts require root access
- Default password is set for cnc user - **CHANGE IT!**
- Firewall is configured automatically
- SSH is enabled by default - use key authentication
- Review scripts before running in production

## Integration with Image Building

For automated image creation, include in post-install:

```bash
# In image build process
chroot /mnt/image /opt/onefinity/install-scripts/setup-base.sh
chroot /mnt/image /opt/onefinity/install-scripts/install-docker.sh
```

Or use systemd oneshot service to run on first boot.

## References

- [Docker Installation](https://docs.docker.com/engine/install/debian/)
- [Node.js on Raspberry Pi](https://nodejs.org/en/download/package-manager/)
- [Nginx Configuration](https://nginx.org/en/docs/)
- [Systemd Services](https://www.freedesktop.org/software/systemd/man/systemd.service.html)
