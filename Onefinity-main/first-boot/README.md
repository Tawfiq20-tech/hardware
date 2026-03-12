# First Boot Configuration

This directory contains scripts and configuration for the first-boot setup wizard that runs when the Raspberry Pi boots for the first time.

## Files

### `onefinity-setup-wizard.sh`
Main first-boot setup script that:
1. Expands filesystem to fill SD card
2. Sets timezone and locale
3. Configures hostname
4. Enables mDNS and firewall
5. Chooses deployment mode (Docker or native)
6. Configures users and permissions
7. Disables unnecessary services
8. Sets up kiosk mode
9. Initializes application directories
10. Marks setup as complete and reboots

### `onefinity-firstboot.service`
Systemd service that runs the setup wizard:
- Runs once on first boot only
- Executes before display manager
- Uses condition to check if already completed
- Outputs to journal and console

### `config.json.template`
Configuration template with all available options:
- System settings (hostname, timezone)
- Network configuration (mDNS, firewall, Wi-Fi)
- Deployment mode (Docker or native)
- Kiosk mode settings
- Hardware configuration
- Service management
- Optimization settings
- Security options

## Installation

### For Image Building

1. **Copy files to image overlay:**
   ```bash
   sudo cp first-boot/* /opt/onefinity/first-boot/
   sudo chmod +x /opt/onefinity/first-boot/*.sh
   ```

2. **Install systemd service:**
   ```bash
   sudo cp first-boot/onefinity-firstboot.service /etc/systemd/system/
   sudo systemctl enable onefinity-firstboot.service
   ```

3. **Ensure completion flag doesn't exist:**
   ```bash
   sudo rm -f /opt/onefinity/.first-boot-complete
   ```

### For Manual Installation

1. **Create directories:**
   ```bash
   sudo mkdir -p /opt/onefinity/first-boot
   ```

2. **Copy files:**
   ```bash
   sudo cp first-boot/* /opt/onefinity/first-boot/
   sudo chmod +x /opt/onefinity/first-boot/*.sh
   ```

3. **Install service:**
   ```bash
   sudo cp first-boot/onefinity-firstboot.service /etc/systemd/system/
   sudo systemctl enable onefinity-firstboot.service
   ```

4. **Run manually (optional):**
   ```bash
   sudo /opt/onefinity/first-boot/onefinity-setup-wizard.sh
   ```

## Configuration

### Environment Variables

The wizard can be configured via environment variables:

```bash
export HOSTNAME="my-cnc"
export TIMEZONE="America/New_York"
export DEPLOYMENT_MODE="native"
export KIOSK_ENABLED="true"
sudo /opt/onefinity/first-boot/onefinity-setup-wizard.sh
```

### Configuration File

Or create a configuration file:

```bash
sudo cp /opt/onefinity/first-boot/config.json.template /opt/onefinity/first-boot/config.json
sudo nano /opt/onefinity/first-boot/config.json
```

Edit values as needed, then the wizard will read from this file.

## Setup Steps Explained

### 1. Expand Filesystem

Expands the root partition to use the full SD card capacity. This is essential because the image is typically smaller than the SD card.

**Manual command:**
```bash
sudo raspi-config nonint do_expand_rootfs
sudo reboot
```

### 2. Set Timezone and Locale

Configures system timezone and locale settings for correct time display and date formatting.

**Manual commands:**
```bash
sudo timedatectl set-timezone America/New_York
sudo localectl set-locale LANG=en_US.UTF-8
```

### 3. Configure Hostname

Sets a unique hostname for the device, making it accessible via mDNS (e.g., `onefinity-cnc.local`).

**Manual commands:**
```bash
sudo hostnamectl set-hostname onefinity-cnc
sudo nano /etc/hosts  # Update 127.0.1.1 line
```

### 4. Configure Network

Enables mDNS for `.local` hostname resolution and configures firewall rules.

**What it does:**
- Enables Avahi daemon (mDNS)
- Configures UFW firewall
- Opens required ports (22, 80, 443, 6070, 6080)
- Enables firewall

### 5. Choose Deployment Mode

Selects either Docker or native deployment and enables appropriate services.

**Docker mode:**
- Enables Docker daemon
- Enables onefinity-docker.service
- Disables native services

**Native mode:**
- Enables Redis, backend, frontend services
- Disables Docker service
- Uses less memory

### 6. Configure Users and Permissions

Adds the `cnc` user to required groups and sets file permissions.

**Groups added:**
- `dialout` - Serial port access
- `video` - Display access
- `audio` - Audio access (for alerts)
- `plugdev` - USB device access
- `docker` - Docker management

### 7. Disable Unnecessary Services

Disables services not needed for CNC operation to save resources.

**Services disabled:**
- Bluetooth (unless needed)
- CUPS (printing)
- ModemManager
- triggerhappy

### 8. Configure Kiosk Mode

Sets up automatic login and Chromium kiosk mode if enabled.

**What it configures:**
- LightDM auto-login
- X11 display settings
- Chromium autostart
- Screen saver disabled

### 9. Initialize Application

Creates application directories and copies configuration files.

**Directories created:**
- `/opt/onefinity/app` - Application files
- `/opt/onefinity/config` - Configuration
- `/opt/onefinity/logs` - Log files
- `/opt/onefinity/backups` - Backups

### 10. Mark Complete and Reboot

Creates completion flag to prevent re-running and reboots system.

**Completion flag:**
```bash
/opt/onefinity/.first-boot-complete
```

## Customizing the Wizard

### Add Custom Steps

Edit `onefinity-setup-wizard.sh` and add your function:

```bash
my_custom_step() {
    log "Running custom configuration..."
    # Your code here
    log "Custom step complete"
}
```

Then add to main():
```bash
main() {
    # ... existing steps ...
    my_custom_step
    mark_complete
}
```

### Skip Steps

Comment out steps in `main()` function:

```bash
main() {
    expand_filesystem
    # configure_locale "$TIMEZONE"  # Skipped
    configure_hostname "$HOSTNAME"
    # ... etc
}
```

### Change Defaults

Edit default values at top of script:

```bash
HOSTNAME="${HOSTNAME:-my-custom-name}"
TIMEZONE="${TIMEZONE:-America/Los_Angeles}"
DEPLOYMENT_MODE="${DEPLOYMENT_MODE:-native}"
```

## Testing

### Test Without Reboot

Comment out the reboot line:

```bash
# reboot  # Commented out for testing
```

Run manually:
```bash
sudo /opt/onefinity/first-boot/onefinity-setup-wizard.sh
```

### View Logs

Check wizard output:
```bash
sudo cat /opt/onefinity/logs/first-boot.log
```

Check systemd journal:
```bash
sudo journalctl -u onefinity-firstboot.service
```

### Reset First Boot

To run wizard again:
```bash
sudo rm /opt/onefinity/.first-boot-complete
sudo reboot
```

## Interactive vs Automated

### Current: Automated

The wizard runs automatically with default/configured values. Good for image distribution.

### Convert to Interactive

Add prompts for user input:

```bash
configure_hostname() {
    read -p "Enter hostname [onefinity-cnc]: " hostname
    hostname=${hostname:-onefinity-cnc}
    hostnamectl set-hostname "$hostname"
}
```

### Pre-seed Configuration

For large deployments, pre-configure via:

1. **Environment variables** in the service file
2. **Configuration file** read by the wizard
3. **Cloud-init** or similar provisioning tool

## Troubleshooting

### Wizard Doesn't Run

1. **Check service status:**
   ```bash
   sudo systemctl status onefinity-firstboot.service
   ```

2. **Check condition:**
   ```bash
   test -f /opt/onefinity/.first-boot-complete && echo "Already complete" || echo "Not complete"
   ```

3. **Check service enabled:**
   ```bash
   sudo systemctl is-enabled onefinity-firstboot.service
   ```

### Wizard Fails

1. **View logs:**
   ```bash
   sudo journalctl -u onefinity-firstboot.service -n 100
   ```

2. **Run manually for debugging:**
   ```bash
   sudo bash -x /opt/onefinity/first-boot/onefinity-setup-wizard.sh
   ```

3. **Check permissions:**
   ```bash
   ls -la /opt/onefinity/first-boot/
   ```

### Wizard Loops (Runs Again)

The completion flag may be missing:

1. **Check if flag exists:**
   ```bash
   ls -la /opt/onefinity/.first-boot-complete
   ```

2. **Create manually:**
   ```bash
   sudo touch /opt/onefinity/.first-boot-complete
   ```

### System Doesn't Reboot

Remove automatic reboot for troubleshooting:

```bash
sudo nano /opt/onefinity/first-boot/onefinity-setup-wizard.sh
# Comment out: reboot
```

## Security Considerations

The wizard runs as root and has full system access:

- Review script before deployment
- Don't include passwords in the script
- Use configuration files with proper permissions
- Log all actions for audit trail
- Validate all user input if interactive

## Best Practices

1. **Test on non-production system first**
2. **Backup configuration before running**
3. **Log all operations**
4. **Use idempotent operations** (can run multiple times safely)
5. **Provide clear error messages**
6. **Create rollback procedures**
7. **Document all changes**

## Integration with Image Builder

For automated image creation, integrate with build process:

```yaml
# In rpi-image-gen config
scripts:
  post_install:
    - /opt/onefinity/first-boot/install-wizard.sh
```

Or use systemd preset:

```bash
# /etc/systemd/system-preset/90-onefinity.preset
enable onefinity-firstboot.service
```

## References

- [Systemd Service Units](https://www.freedesktop.org/software/systemd/man/systemd.service.html)
- [Systemd Conditions](https://www.freedesktop.org/software/systemd/man/systemd.unit.html#Conditions%20and%20Asserts)
- [raspi-config](https://www.raspberrypi.com/documentation/computers/configuration.html)
- [Cloud-init](https://cloudinit.readthedocs.io/)
