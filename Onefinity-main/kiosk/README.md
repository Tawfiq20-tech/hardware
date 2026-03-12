# Kiosk Mode Configuration

This directory contains scripts and configuration files for running Onefinity CNC Controller in full-screen kiosk mode on a touchscreen display.

## Files

### `kiosk-start.sh`
Main kiosk launcher script that:
- Waits for X server to be ready
- Waits for network connectivity
- Waits for web service to respond
- Disables screen saver and power management
- Hides mouse cursor after inactivity
- Launches Chromium in full-screen kiosk mode
- Monitors Chromium process

### `onefinity.desktop`
XDG autostart entry for automatic kiosk launch:
- Starts 5 seconds after user login
- Runs kiosk-start.sh script
- Compatible with GNOME/LXDE/XFCE desktops

### `lightdm.conf`
LightDM display manager configuration:
- Auto-login as `cnc` user
- Hides user list for security
- Disables guest account
- Runs display setup script

### `xorg.conf`
X11 display server configuration:
- Disables DPMS (power saving)
- Prevents screen blanking
- Configures touchscreen input
- Hardware acceleration settings
- Display resolution modes

### `display-setup.sh`
Pre-display setup script:
- Sets display resolution
- Configures brightness
- Disables screen blanking

### `onefinity-kiosk.service` (in ../systemd/)
Systemd service for kiosk mode:
- Auto-starts after graphical target
- Runs as `cnc` user
- Automatic restart on failure
- Can be managed independently

## Installation

### Method 1: Autostart (Recommended for Desktop)

1. **Copy kiosk scripts:**
   ```bash
   sudo mkdir -p /opt/onefinity/kiosk
   sudo cp kiosk/* /opt/onefinity/kiosk/
   sudo chmod +x /opt/onefinity/kiosk/*.sh
   ```

2. **Enable autostart for cnc user:**
   ```bash
   mkdir -p /home/cnc/.config/autostart
   cp kiosk/onefinity.desktop /home/cnc/.config/autostart/
   ```

3. **Configure LightDM for auto-login:**
   ```bash
   sudo cp kiosk/lightdm.conf /etc/lightdm/lightdm.conf.d/90-onefinity-kiosk.conf
   sudo systemctl restart lightdm
   ```

4. **Copy X11 configuration:**
   ```bash
   sudo mkdir -p /etc/X11/xorg.conf.d
   sudo cp kiosk/xorg.conf /etc/X11/xorg.conf.d/10-onefinity-display.conf
   ```

5. **Make display setup script executable:**
   ```bash
   sudo chmod +x /opt/onefinity/kiosk/display-setup.sh
   ```

### Method 2: Systemd Service (Alternative)

Use the systemd service for more control:

1. **Follow steps 1, 4, and 5 from Method 1**

2. **Install systemd service:**
   ```bash
   sudo cp systemd/onefinity-kiosk.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable onefinity-kiosk.service
   ```

3. **Start service:**
   ```bash
   sudo systemctl start onefinity-kiosk.service
   ```

## Configuration

### Change Kiosk URL

Edit `/opt/onefinity/kiosk/kiosk-start.sh`:
```bash
KIOSK_URL="http://your-custom-url:port"
```

Or set environment variable:
```bash
export KIOSK_URL="http://192.168.1.100:6080"
```

### Adjust Mouse Cursor Hide Timeout

Edit `kiosk-start.sh`:
```bash
unclutter -idle 10 -root &  # Hide after 10 seconds
```

Or disable hiding:
```bash
# Comment out the unclutter line
```

### Change Display Resolution

Edit `kiosk/xorg.conf`:
```
Modes "1280x720" "1920x1080"
```

Or edit `display-setup.sh`:
```bash
xrandr --output HDMI-1 --mode 1280x720
```

### Disable Auto-Login

Edit `/etc/lightdm/lightdm.conf.d/90-onefinity-kiosk.conf`:
```ini
# Comment out these lines:
# autologin-user=cnc
# autologin-user-timeout=0
```

## Chromium Kiosk Flags

The launcher uses these Chromium flags for optimal kiosk operation:

```bash
--kiosk                          # Full-screen mode
--start-fullscreen               # Start in fullscreen
--noerrdialogs                   # No error dialogs
--disable-infobars               # No info bars
--no-first-run                   # Skip first-run wizard
--disable-session-crashed-bubble # No crash notifications
--disable-crash-reporter         # No crash reporting
--touch-events=enabled           # Touch support
--enable-features=OverlayScrollbar # Touch-friendly scrollbars
--disk-cache-size=1              # Minimal cache
--disable-sync                   # No Google sync
--disable-extensions             # No extensions
```

### Add Custom Chromium Flags

Edit `kiosk-start.sh` and add to `CHROMIUM_FLAGS` array:
```bash
CHROMIUM_FLAGS=(
    # ... existing flags ...
    --your-custom-flag
    --another-flag=value
)
```

## Touchscreen Calibration

### Calibrate Touch Input

1. **Install calibration tool:**
   ```bash
   sudo apt install xinput-calibrator
   ```

2. **Run calibrator:**
   ```bash
   DISPLAY=:0 xinput_calibrator
   ```

3. **Follow on-screen instructions** (touch the crosshairs)

4. **Save calibration:**
   The tool will output configuration. Save it to:
   ```bash
   sudo nano /etc/X11/xorg.conf.d/99-calibration.conf
   ```

5. **Restart X server:**
   ```bash
   sudo systemctl restart lightdm
   ```

### Manual Calibration

If automatic calibration doesn't work:

1. **List input devices:**
   ```bash
   DISPLAY=:0 xinput list
   ```

2. **Get device ID** (e.g., "ELAN Touchscreen")

3. **Apply transformation matrix:**
   ```bash
   DISPLAY=:0 xinput set-prop <device-id> "Coordinate Transformation Matrix" \
     1 0 0 0 1 0 0 0 1
   ```

## Testing Kiosk Mode

### Test Without Auto-Login

1. **Run script manually:**
   ```bash
   /opt/onefinity/kiosk/kiosk-start.sh
   ```

2. **Check for errors in log:**
   ```bash
   tail -f /opt/onefinity/logs/kiosk.log
   ```

### Test Auto-Login

1. **Logout or reboot:**
   ```bash
   sudo reboot
   ```

2. **System should:**
   - Auto-login as cnc user
   - Start X server
   - Launch Chromium in kiosk mode
   - Load Onefinity interface

## Management

### Start Kiosk Mode Manually

```bash
DISPLAY=:0 /opt/onefinity/kiosk/kiosk-start.sh &
```

### Stop Kiosk Mode

```bash
# Kill Chromium process
pkill -f chromium-browser

# Or via systemd
sudo systemctl stop onefinity-kiosk.service
```

### Restart Kiosk Mode

```bash
# Via systemd
sudo systemctl restart onefinity-kiosk.service

# Or manually
pkill -f chromium-browser
sleep 2
DISPLAY=:0 /opt/onefinity/kiosk/kiosk-start.sh &
```

### Exit Kiosk Mode Temporarily

From kiosk mode:
1. Press `Alt+F4` to close Chromium
2. System will restart kiosk after 10 seconds (if using autostart)
3. Or press `Ctrl+Alt+F1` to switch to TTY console

### Disable Kiosk Mode

**For autostart method:**
```bash
rm /home/cnc/.config/autostart/onefinity.desktop
```

**For systemd method:**
```bash
sudo systemctl disable onefinity-kiosk.service
sudo systemctl stop onefinity-kiosk.service
```

## Troubleshooting

### Kiosk doesn't start

1. **Check X server is running:**
   ```bash
   ps aux | grep Xorg
   ```

2. **Check display variable:**
   ```bash
   echo $DISPLAY  # Should be :0
   ```

3. **Check logs:**
   ```bash
   tail -f /opt/onefinity/logs/kiosk.log
   journalctl -u onefinity-kiosk.service -f
   ```

4. **Test Chromium manually:**
   ```bash
   DISPLAY=:0 chromium-browser --kiosk http://localhost:6080
   ```

### Black screen after login

1. **Check LightDM configuration:**
   ```bash
   sudo cat /etc/lightdm/lightdm.conf.d/90-onefinity-kiosk.conf
   ```

2. **Check X server logs:**
   ```bash
   cat /var/log/Xorg.0.log
   ```

3. **Verify auto-login user exists:**
   ```bash
   id cnc
   ```

### Touch screen not working

1. **List input devices:**
   ```bash
   DISPLAY=:0 xinput list
   ```

2. **Test with evtest:**
   ```bash
   sudo evtest /dev/input/event0  # Adjust event number
   ```

3. **Check libinput logs:**
   ```bash
   sudo libinput debug-events
   ```

4. **Verify driver loaded:**
   ```bash
   grep -i touch /var/log/Xorg.0.log
   ```

### Chromium shows errors

1. **Clear Chromium cache:**
   ```bash
   rm -rf /home/cnc/.config/chromium-kiosk
   ```

2. **Check disk space:**
   ```bash
   df -h
   ```

3. **Check web service:**
   ```bash
   curl -I http://localhost:6080
   ```

### Screen blanks after idle

1. **Verify DPMS disabled:**
   ```bash
   DISPLAY=:0 xset q | grep DPMS
   # Should show: DPMS is Disabled
   ```

2. **Manually disable:**
   ```bash
   DISPLAY=:0 xset -dpms
   DISPLAY=:0 xset s off
   DISPLAY=:0 xset s noblank
   ```

## Remote Access While Kiosk is Running

You can still access the system remotely:

### Via SSH:
```bash
ssh cnc@onefinity-cnc.local
```

### Via VNC (if installed):
```bash
vncviewer onefinity-cnc.local:5900
```

### Via TTY console:
Press `Ctrl+Alt+F2` to switch to text console, then `Ctrl+Alt+F7` to return to X.

## Performance Optimization

### Reduce Chromium Memory Usage

Edit `kiosk-start.sh` and add:
```bash
--memory-pressure-off
--max-old-space-size=512
```

### Disable Unnecessary Chromium Features

```bash
--disable-background-networking
--disable-background-timer-throttling
--disable-backgrounding-occluded-windows
```

## Security Considerations

- Kiosk mode restricts user from accessing system UI
- User can still press `Alt+F4` to close browser
- Consider disabling keyboard shortcuts in Chromium
- Use firewall to restrict network access
- Keep Chromium updated for security patches

## Advantages of Kiosk Mode

✅ Dedicated CNC interface (no distractions)
✅ Touch-optimized full-screen UI
✅ Auto-start on boot (ready to use)
✅ Prevents accidental system access
✅ Professional appearance

## References

- [Chromium Command Line Switches](https://peter.sh/experiments/chromium-command-line-switches/)
- [LightDM Configuration](https://wiki.archlinux.org/title/LightDM)
- [Xorg Configuration](https://www.x.org/releases/current/doc/man/man5/xorg.conf.5.xhtml)
- [Raspberry Pi Touch Display](https://www.raspberrypi.com/documentation/accessories/display.html)
