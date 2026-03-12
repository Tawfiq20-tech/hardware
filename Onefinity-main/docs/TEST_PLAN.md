# Onefinity CNC Controller - Test Plan

## Pre-Image Testing (Development)

Test all components before building the final image.

### 1. Base System Tests

#### 1.1 Package Installation
- [ ] All packages install without errors
- [ ] Node.js version is v18 or higher
- [ ] Redis server starts successfully
- [ ] Docker and Docker Compose work
- [ ] Nginx starts and responds

#### 1.2 User and Permissions
- [ ] User `cnc` exists
- [ ] User `cnc` in groups: sudo, dialout, video, audio, plugdev, docker
- [ ] Directory `/opt/onefinity` exists with correct permissions
- [ ] Serial devices accessible by `cnc` user

#### 1.3 Network Configuration
- [ ] Hostname set to `onefinity-cnc`
- [ ] mDNS responds at `onefinity-cnc.local`
- [ ] Firewall (ufw) enabled
- [ ] Ports 22, 80, 443, 6070, 6080 open
- [ ] SSH access works

### 2. Docker Deployment Tests

#### 2.1 Docker Installation
- [ ] Docker service runs: `systemctl status docker`
- [ ] Docker Compose file valid: `docker-compose config`
- [ ] User can run docker commands: `docker ps`

#### 2.2 Container Startup
- [ ] Redis container starts: `docker ps | grep redis`
- [ ] Backend container starts: `docker ps | grep backend`
- [ ] Frontend container starts: `docker ps | grep frontend`
- [ ] All containers healthy: `docker ps` shows "(healthy)"

#### 2.3 Service Communication
- [ ] Redis responds: `docker exec onefinity-redis redis-cli ping`
- [ ] Backend API responds: `curl http://localhost:6070/api/health`
- [ ] Frontend serves: `curl -I http://localhost:6080`
- [ ] WebSocket connects: Test Socket.IO in browser console

#### 2.4 Serial Port Access
- [ ] Serial devices mapped to container: `docker exec onefinity-backend ls /dev/ttyUSB*`
- [ ] Backend can open serial port
- [ ] GRBL commands work through web interface

### 3. Native Deployment Tests

#### 3.1 Service Installation
- [ ] Redis service runs: `systemctl status redis-onefinity`
- [ ] Backend service runs: `systemctl status onefinity-backend`
- [ ] Frontend (Nginx) runs: `systemctl status nginx`

#### 3.2 Service Communication
- [ ] Redis ping: `redis-cli ping`
- [ ] Backend API: `curl http://localhost:4000/api/health`
- [ ] Frontend serves: `curl -I http://localhost`
- [ ] Nginx proxies correctly to backend

#### 3.3 Dependencies
- [ ] Backend npm packages installed
- [ ] Frontend built in `/opt/onefinity/app/frontend/dist`
- [ ] Nginx site enabled: `ls /etc/nginx/sites-enabled/onefinity`

### 4. Hardware Integration Tests

#### 4.1 Serial Port Configuration
- [ ] udev rules installed: `ls /etc/udev/rules.d/99-serial-permissions.rules`
- [ ] Rules loaded: `udevadm control --reload-rules`
- [ ] Serial devices detected: `ls /dev/ttyUSB* /dev/ttyACM*`
- [ ] Permissions correct: `ls -la /dev/ttyUSB0` shows dialout group

#### 4.2 CNC Controller Connection
- [ ] Controller detected in web interface
- [ ] Can select serial port
- [ ] Connection establishes successfully
- [ ] GRBL status reports
- [ ] Jog commands work
- [ ] Zero commands work
- [ ] G-code can be sent

#### 4.3 Touchscreen (If Applicable)
- [ ] Touchscreen detected: `xinput list`
- [ ] Touch events work: `sudo evtest`
- [ ] Calibration script runs: `./touchscreen-calibrate.sh`
- [ ] Calibration applied: `ls /etc/X11/xorg.conf.d/99-calibration.conf`
- [ ] Touch input accurate

### 5. Kiosk Mode Tests

#### 5.1 Configuration
- [ ] LightDM auto-login configured
- [ ] Xorg display settings applied
- [ ] Autostart desktop file exists
- [ ] Kiosk script executable

#### 5.2 Startup
- [ ] System boots to desktop
- [ ] Auto-login as `cnc` user
- [ ] Chromium launches automatically (after ~15 seconds)
- [ ] Full-screen kiosk mode active
- [ ] Correct URL loaded

#### 5.3 Display
- [ ] Screen saver disabled
- [ ] Display doesn't blank
- [ ] Mouse cursor hides after inactivity
- [ ] Touch scrolling works (if touchscreen)

#### 5.4 Chromium Behavior
- [ ] No error dialogs
- [ ] No session restore prompts
- [ ] No "Chromium didn't shut down correctly" messages
- [ ] Web interface loads and functions
- [ ] Can exit with Alt+F4 (restarts automatically)

### 6. First-Boot Wizard Tests

#### 6.1 Wizard Execution
- [ ] Service enabled: `systemctl is-enabled onefinity-firstboot`
- [ ] Runs on first boot only (condition: flag doesn't exist)
- [ ] Completion flag created: `/opt/onefinity/.first-boot-complete`
- [ ] Doesn't run on subsequent boots

#### 6.2 Configuration Steps
- [ ] Filesystem expands successfully
- [ ] Timezone set
- [ ] Hostname configured
- [ ] mDNS enabled
- [ ] Firewall configured
- [ ] Deployment mode chosen
- [ ] Users and groups configured
- [ ] Unnecessary services disabled
- [ ] Kiosk mode enabled (if configured)
- [ ] System reboots automatically

#### 6.3 Logs
- [ ] Wizard logs to `/opt/onefinity/logs/first-boot.log`
- [ ] No errors in log
- [ ] All steps completed successfully

### 7. Installation Script Tests

#### 7.1 setup-base.sh
- [ ] Runs without errors as root
- [ ] Creates cnc user
- [ ] Installs all required packages
- [ ] Configures firewall
- [ ] Sets up directories
- [ ] Can run multiple times (idempotent)

#### 7.2 install-docker.sh
- [ ] Installs Docker successfully
- [ ] Adds user to docker group
- [ ] Copies configuration files
- [ ] Enables systemd service
- [ ] Pulls Docker images (if online)

#### 7.3 install-native.sh
- [ ] Installs Node.js, Redis, Nginx
- [ ] Installs backend dependencies
- [ ] Builds frontend
- [ ] Configures Nginx
- [ ] Enables systemd services

#### 7.4 switch-deployment.sh
- [ ] Switches from Docker to native
- [ ] Switches from native to Docker
- [ ] Stops old services
- [ ] Starts new services
- [ ] Updates configuration files
- [ ] Shows current mode when no argument

### 8. System Optimization Tests

#### 8.1 Performance
- [ ] Services disabled: `systemctl list-unit-files | grep disabled`
- [ ] Boot config applied: `cat /boot/config.txt | grep gpu_mem`
- [ ] Swap configured: `free -h` shows swap
- [ ] CPU not throttling: Check temperature

#### 8.2 Resource Usage
- [ ] Idle CPU < 20%
- [ ] Idle Memory < 60%
- [ ] Disk usage reasonable
- [ ] No memory leaks (monitor over time)

#### 8.3 Boot Time
- [ ] Cold boot to login < 60 seconds
- [ ] Login to kiosk < 20 seconds
- [ ] Total time to operational < 90 seconds

### 9. Monitoring Tests

#### 9.1 Health Check Script
- [ ] Runs without errors
- [ ] Checks CPU temperature
- [ ] Checks CPU usage
- [ ] Checks memory usage
- [ ] Checks disk usage
- [ ] Checks service status
- [ ] Checks network connectivity
- [ ] Checks serial ports
- [ ] Logs results
- [ ] Returns proper exit code

#### 9.2 System Logs
- [ ] Backend logs to `/opt/onefinity/logs/`
- [ ] Nginx logs to `/var/log/nginx/`
- [ ] Systemd journals accessible
- [ ] Log rotation configured

### 10. Network Tests

#### 10.1 mDNS
- [ ] Resolves from Linux: `ping onefinity-cnc.local`
- [ ] Resolves from Windows: `ping onefinity-cnc.local`
- [ ] Resolves from macOS: `ping onefinity-cnc.local`
- [ ] Works on different subnets (if applicable)

#### 10.2 Remote Access
- [ ] Can SSH from remote device
- [ ] Can access web interface from remote device
- [ ] WebSocket connections work remotely
- [ ] File upload works over network

#### 10.3 Firewall
- [ ] Allowed ports accessible
- [ ] Blocked ports inaccessible
- [ ] Rules persist after reboot

## Post-Image Testing (QA)

Test the final image on actual hardware.

### 11. Image Building Tests

#### 11.1 Build Process
- [ ] Build script runs without errors
- [ ] Base image downloads successfully
- [ ] Image mounts and customizes
- [ ] Image shrinks (if PiShrink used)
- [ ] Image compresses successfully
- [ ] Checksum generates correctly

#### 11.2 Image Quality
- [ ] Image size reasonable (< 8GB uncompressed)
- [ ] Compressed size reasonable (< 3GB)
- [ ] No corruption: Checksum matches
- [ ] Can extract successfully

### 12. Fresh Installation Tests

#### 12.1 Flashing
- [ ] Flash with Raspberry Pi Imager
- [ ] Flash with Etcher
- [ ] Flash with dd command
- [ ] SD card verified after flash

#### 12.2 First Boot
- [ ] Raspberry Pi boots successfully
- [ ] LED activity during boot
- [ ] Display shows boot messages
- [ ] First-boot wizard runs
- [ ] System reboots automatically
- [ ] Boot time acceptable

#### 12.3 Second Boot
- [ ] System boots to kiosk mode
- [ ] Web interface loads automatically
- [ ] All services running
- [ ] No errors in logs

### 13. Multi-Device Testing

#### 13.1 Raspberry Pi 5
- [ ] Boots successfully
- [ ] All features work
- [ ] Performance good
- [ ] Stable operation

#### 13.2 Raspberry Pi 4
- [ ] Boots successfully
- [ ] All features work
- [ ] Performance acceptable
- [ ] Stable operation

#### 13.3 Different SD Cards
- [ ] Test with 16GB card
- [ ] Test with 32GB card
- [ ] Test with different brands
- [ ] Verify no compatibility issues

### 14. CNC Controller Compatibility

#### 14.1 GRBL Controllers
- [ ] Arduino Uno + GRBL
- [ ] Arduino Mega + GRBL
- [ ] CH340-based boards
- [ ] FTDI-based boards

#### 14.2 grblHAL Controllers
- [ ] STM32-based boards
- [ ] Teensy boards
- [ ] Other grblHAL variants

#### 14.3 Communication
- [ ] Baud rate detection
- [ ] Status reporting
- [ ] Jog commands
- [ ] G-code execution
- [ ] Hold/resume
- [ ] Soft reset
- [ ] Hard reset

### 15. Long-Term Stability Tests

#### 15.1 Endurance
- [ ] Run for 24 hours continuously
- [ ] No crashes or hangs
- [ ] Memory usage stable
- [ ] No service restarts
- [ ] Logs show no errors

#### 15.2 Power Cycling
- [ ] Clean shutdown works
- [ ] Reboot works correctly
- [ ] Cold boot after power loss
- [ ] Configuration persists
- [ ] No filesystem corruption

#### 15.3 Load Testing
- [ ] Send large G-code file
- [ ] Multiple WebSocket connections
- [ ] Rapid jog commands
- [ ] System remains responsive

### 16. Update and Maintenance Tests

#### 16.1 System Updates
- [ ] `apt update && apt upgrade` works
- [ ] Services restart correctly after updates
- [ ] No broken dependencies

#### 16.2 Application Updates
- [ ] Can pull new code from git
- [ ] Can rebuild and deploy
- [ ] Configuration preserves
- [ ] Data preserves

#### 16.3 Backup and Restore
- [ ] Configuration backup works
- [ ] G-code files preserve
- [ ] Restore procedure works
- [ ] No data loss

## Acceptance Criteria

Image is ready for release when:

- ✅ All critical tests pass (marked with ⭐)
- ✅ No P0 (blocking) bugs
- ✅ < 5 P1 (high priority) bugs
- ✅ Documentation complete
- ✅ Tested on at least 2 different Raspberry Pi 5 units
- ✅ Tested with at least 3 different CNC controllers
- ✅ 24-hour stability test passes
- ✅ Security audit complete
- ✅ Performance benchmarks meet targets

## Test Environment

### Hardware
- Raspberry Pi 5 8GB (primary)
- Raspberry Pi 4 8GB (compatibility)
- 32GB SD cards (multiple brands)
- Official 7" touch display
- USB CNC controllers (various types)
- Network switches and cables

### Test Tools
- Multimeter (power testing)
- USB analyzer (debugging)
- Network analyzer (traffic monitoring)
- Serial terminal (GRBL testing)

## Bug Reporting Template

```markdown
**Test Case:** [Test number and name]
**Severity:** P0 / P1 / P2 / P3
**Environment:** Pi 5 / Pi 4, Docker / Native, etc.

**Steps to Reproduce:**
1.
2.
3.

**Expected Result:**

**Actual Result:**

**Logs:**
```

**Workaround (if any):**

```

## Test Schedule

- **Week 1:** Component testing (tests 1-10)
- **Week 2:** Image building and integration (tests 11-12)
- **Week 3:** Hardware compatibility (tests 13-14)
- **Week 4:** Stability and final validation (tests 15-16)
- **Week 5:** Documentation review and release prep

## Sign-Off

- [ ] Development team lead
- [ ] QA team lead
- [ ] Documentation review
- [ ] Security review
- [ ] Release manager

---

**Test Status:** ⬜ Not Started | 🟡 In Progress | ✅ Passed | ❌ Failed
**Image Version:** v1.0.0
**Test Date:** [Date]
**Tester:** [Name]
