# Onefinity CNC Controller - Installation Guide

## Overview

This guide will walk you through installing the Onefinity CNC Controller on your Raspberry Pi, either from a pre-built image or from scratch.

## Hardware Requirements

### Minimum Requirements
- Raspberry Pi 4 (4GB RAM)
- 16GB microSD card (Class 10 or better)
- 5V 3A USB-C power supply
- Ethernet cable or Wi-Fi
- USB CNC controller (GRBL/grblHAL compatible)

### Recommended Setup
- Raspberry Pi 5 (8GB RAM)
- 32GB microSD card (UHS-I or better)
- Official Raspberry Pi power supply
- Gigabit Ethernet connection
- 7" Raspberry Pi Touch Display
- Quality USB cable for CNC controller

## Method 1: Flash Pre-Built Image (Easiest)

### Step 1: Download Image

Download the latest image:
- `onefinity-cnc-v1.0.0-rpi5-arm64.img.xz`
- `onefinity-cnc-v1.0.0-rpi5-arm64.img.xz.sha256` (checksum)

### Step 2: Verify Checksum

**Windows (PowerShell):**
```powershell
Get-FileHash onefinity-cnc-v1.0.0-rpi5-arm64.img.xz -Algorithm SHA256
```

**macOS/Linux:**
```bash
sha256sum -c onefinity-cnc-v1.0.0-rpi5-arm64.img.xz.sha256
```

### Step 3: Flash to SD Card

**Option A: Raspberry Pi Imager (Recommended)**

1. Download [Raspberry Pi Imager](https://www.raspberrypi.com/software/)
2. Insert SD card
3. Open Raspberry Pi Imager
4. Choose OS → Use custom
5. Select downloaded `.img.xz` file
6. Choose SD card
7. Click Write
8. Wait for completion

**Option B: balenaEtcher**

1. Download [balenaEtcher](https://www.balena.io/etcher/)
2. Open Etcher
3. Select downloaded image file
4. Select SD card
5. Flash!

**Option C: Command Line (Linux/macOS)**

```bash
# Extract image
xz -d onefinity-cnc-v1.0.0-rpi5-arm64.img.xz

# Find SD card device
lsblk

# Write to SD card (replace /dev/sdX with your SD card)
sudo dd if=onefinity-cnc-v1.0.0-rpi5-arm64.img of=/dev/sdX bs=4M status=progress conv=fsync

# Eject safely
sudo eject /dev/sdX
```

### Step 4: First Boot

1. Insert SD card into Raspberry Pi
2. Connect:
   - Ethernet cable (or configure Wi-Fi later)
   - USB CNC controller
   - Monitor/touchscreen
   - Keyboard (for setup)
3. Power on

The system will:
- Boot Raspberry Pi OS
- Run first-boot wizard automatically
- Expand filesystem
- Configure services
- Reboot (takes ~5 minutes)

### Step 5: Access Interface

After automatic reboot:

**Local (touchscreen):**
- Kiosk mode starts automatically
- Interface loads at `http://localhost:6080`

**Remote (another computer):**
- `http://onefinity-cnc.local:6080` (via mDNS)
- Or `http://192.168.1.xxx:6080` (find IP: `hostname -I`)

### Step 6: Initial Configuration

1. **Change default password:**
   ```bash
   ssh cnc@onefinity-cnc.local
   # Password: onefinity
   passwd
   ```

2. **Connect CNC controller:**
   - Plug in USB cable
   - Click "Connect" in web interface
   - Select serial port
   - Test jog controls

3. **Calibrate touchscreen (if applicable):**
   ```bash
   DISPLAY=:0 /opt/onefinity/hardware/touchscreen-calibrate.sh
   ```

## Method 2: Manual Installation (Advanced)

### Prerequisites

Fresh Raspberry Pi OS Desktop (64-bit) installation.

### Step 1: Download Application Files

```bash
# On your computer, download or clone repository
git clone https://github.com/your-repo/Onefinity-main.git
cd Onefinity-main

# Or download ZIP and extract
```

### Step 2: Copy Files to Raspberry Pi

```bash
# Copy entire directory to Pi
scp -r Onefinity-main pi@raspberrypi.local:/home/pi/

# Or use USB drive, SFTP, etc.
```

### Step 3: Run Base Setup

```bash
ssh pi@raspberrypi.local

cd Onefinity-main
sudo chmod +x install-scripts/*.sh
sudo ./install-scripts/setup-base.sh
```

This installs:
- Essential packages
- Creates cnc user
- Configures firewall
- Enables mDNS
- Optimizes system

### Step 4: Copy Application Files

```bash
sudo mkdir -p /opt/onefinity
sudo cp -r Onefinity-main/* /opt/onefinity/
sudo chown -R cnc:cnc /opt/onefinity
```

### Step 5: Choose Deployment Mode

**Option A: Docker (Recommended)**

```bash
cd /opt/onefinity
sudo ./install-scripts/install-docker.sh
sudo systemctl start onefinity-docker.service
```

**Option B: Native**

```bash
cd /opt/onefinity
sudo ./install-scripts/install-native.sh
sudo systemctl start redis-onefinity.service
sudo systemctl start onefinity-backend.service
sudo systemctl start onefinity-frontend.service
```

### Step 6: Configure Kiosk Mode (Optional)

```bash
# Copy kiosk configuration
sudo cp kiosk/lightdm.conf /etc/lightdm/lightdm.conf.d/90-onefinity-kiosk.conf
sudo cp kiosk/xorg.conf /etc/X11/xorg.conf.d/10-onefinity-display.conf

# Setup autostart
mkdir -p /home/cnc/.config/autostart
cp kiosk/onefinity.desktop /home/cnc/.config/autostart/
chown -R cnc:cnc /home/cnc/.config

# Reboot to activate
sudo reboot
```

## Network Configuration

### Ethernet (Automatic)

Plug in Ethernet cable - DHCP assigns IP automatically.

### Wi-Fi Setup

**Method 1: Desktop UI**
1. Click Wi-Fi icon in taskbar
2. Select network
3. Enter password

**Method 2: Command Line**
```bash
sudo raspi-config
# System Options → Wireless LAN
# Enter SSID and password
```

**Method 3: Configuration File**
```bash
sudo nano /etc/wpa_supplicant/wpa_supplicant.conf

# Add:
network={
    ssid="YourNetworkName"
    psk="YourPassword"
}

# Restart networking
sudo systemctl restart networking
```

### Static IP (Optional)

```bash
sudo /opt/onefinity/hardware/network-setup.sh

# Select option 2: Configure static IP
# Follow prompts
```

Or manually:
```bash
sudo nano /etc/dhcpcd.conf

# Add at end:
interface eth0
static ip_address=192.168.1.100/24
static routers=192.168.1.1
static domain_name_servers=8.8.8.8

# Restart
sudo systemctl restart dhcpcd
```

## Troubleshooting Installation

### SD Card Won't Boot

- **Verify image integrity:** Check SHA256 checksum
- **Reflash card:** Try different SD card reader
- **Check power supply:** Use official 5V 3A adapter
- **Try different card:** Some brands more reliable

### Can't Access Web Interface

1. **Check services running:**
   ```bash
   sudo systemctl status onefinity-docker.service
   # or
   sudo systemctl status onefinity-backend.service
   ```

2. **Check network:**
   ```bash
   hostname -I  # Get IP address
   ping onefinity-cnc.local  # Test mDNS
   ```

3. **Check firewall:**
   ```bash
   sudo ufw status
   # Should allow ports 6070, 6080
   ```

4. **Check logs:**
   ```bash
   sudo journalctl -u onefinity-backend.service -n 50
   ```

### Serial Port Not Detected

1. **Check USB connection:**
   ```bash
   lsusb  # Should see CNC controller
   dmesg | tail  # Check kernel messages
   ```

2. **Check device files:**
   ```bash
   ls -la /dev/ttyUSB* /dev/ttyACM*
   ```

3. **Check permissions:**
   ```bash
   groups cnc  # Should include 'dialout'
   sudo usermod -a -G dialout cnc
   # Logout and login again
   ```

4. **Test serial connection:**
   ```bash
   screen /dev/ttyUSB0 115200
   # Type ? and press Enter (GRBL status)
   # Ctrl+A then K to exit
   ```

### Kiosk Mode Not Starting

1. **Check autostart:**
   ```bash
   ls -la /home/cnc/.config/autostart/onefinity.desktop
   ```

2. **Check LightDM config:**
   ```bash
   cat /etc/lightdm/lightdm.conf.d/90-onefinity-kiosk.conf
   ```

3. **Check logs:**
   ```bash
   cat /opt/onefinity/logs/kiosk.log
   ```

4. **Test manually:**
   ```bash
   DISPLAY=:0 /opt/onefinity/kiosk/kiosk-start.sh
   ```

### High CPU/Memory Usage

Docker mode uses more resources:

1. **Switch to native mode:**
   ```bash
   sudo /opt/onefinity/install-scripts/switch-deployment.sh native
   ```

2. **Increase swap:**
   ```bash
   sudo nano /etc/dphys-swapfile
   # Set CONF_SWAPSIZE=2048
   sudo dphys-swapfile setup
   sudo dphys-swapfile swapon
   ```

3. **Disable unused services:**
   ```bash
   sudo /opt/onefinity/optimization/disable-services.sh
   ```

## Next Steps

After successful installation:

1. **Read Usage Guide** - Learn how to use the interface
2. **Configure CNC settings** - Set work coordinates, speeds
3. **Test with sample G-code** - Verify functionality
4. **Setup backups** - Protect your configuration
5. **Join community** - Get help and share tips

## Getting Help

- **Documentation:** `/opt/onefinity/docs/`
- **Logs:** `/opt/onefinity/logs/`
- **Health check:** `sudo /opt/onefinity/monitoring/health-check.sh`
- **Community forum:** [Link to forum]
- **GitHub issues:** [Link to issues]

## Security Recommendations

⚠️ **Before production use:**

1. Change default password: `passwd`
2. Setup SSH key authentication
3. Keep system updated: `sudo apt update && sudo apt upgrade`
4. Review firewall rules: `sudo ufw status`
5. Backup configuration regularly

## Appendix: System Specifications

### Default Credentials
- **User:** cnc
- **Password:** onefinity (CHANGE THIS!)
- **SSH:** Enabled
- **Hostname:** onefinity-cnc

### Port Configuration
- **22:** SSH
- **80:** HTTP (native mode)
- **443:** HTTPS (if configured)
- **6070:** Backend API (Docker mode)
- **6080:** Frontend (Docker mode)
- **6060:** Redis (Docker mode)

### File Locations
- **Application:** `/opt/onefinity/app`
- **Configuration:** `/opt/onefinity/config`
- **Logs:** `/opt/onefinity/logs`
- **Backups:** `/opt/onefinity/backups`
- **Scripts:** `/opt/onefinity/install-scripts`

### Service Names
**Docker Mode:**
- `onefinity-docker.service`

**Native Mode:**
- `redis-onefinity.service`
- `onefinity-backend.service`
- `onefinity-frontend.service`

**Kiosk Mode:**
- `onefinity-kiosk.service` (optional)
- Or autostart via `/home/cnc/.config/autostart/`
