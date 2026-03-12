# Native Deployment - Systemd Services

This directory contains systemd service units for running Onefinity CNC Controller natively on Raspberry Pi (without Docker).

## Service Units

### `onefinity-backend.service`
Backend Node.js service with:
- Runs as `cnc` user
- Redis dependency
- Serial port access (dialout group)
- Memory limit: 1GB
- CPU limit: 150%
- Automatic restart on failure
- Security hardening

### `onefinity-frontend.service`
Frontend Nginx site enabler:
- Enables/disables Nginx site configuration
- Depends on backend and nginx services
- Manages symlink in sites-enabled
- Reloads Nginx on changes

### `redis-onefinity.service`
Redis server for job queue:
- Runs as `redis` user
- Memory limit: 512MB
- CPU limit: 50%
- Persistent storage in `/var/lib/redis`
- Security hardening

### `onefinity-native.target`
Target unit that groups all native services:
- Start/stop all services together
- Proper dependency management
- Simplified service management

## Installation

### Prerequisites

1. **Install required packages:**
   ```bash
   sudo apt update
   sudo apt install -y nodejs npm nginx redis-server
   ```

2. **Create application directory:**
   ```bash
   sudo mkdir -p /opt/onefinity/{app,config,logs,backups}
   sudo chown -R cnc:cnc /opt/onefinity
   ```

3. **Copy application files:**
   ```bash
   sudo cp -r /path/to/Onefinity-main/backend /opt/onefinity/app/
   sudo cp -r /path/to/Onefinity-main/frontend/dist /opt/onefinity/app/frontend
   ```

4. **Install backend dependencies:**
   ```bash
   cd /opt/onefinity/app/backend
   npm ci --production
   ```

5. **Create environment file:**
   ```bash
   sudo cp config/env.production.template /opt/onefinity/config/.env
   sudo nano /opt/onefinity/config/.env
   # Set REDIS_URL=redis://localhost:6379
   ```

### Service Installation

1. **Copy service files:**
   ```bash
   sudo cp systemd/*.service systemd/*.target /etc/systemd/system/
   sudo systemctl daemon-reload
   ```

2. **Enable services:**
   ```bash
   # Enable individual services
   sudo systemctl enable redis-onefinity.service
   sudo systemctl enable onefinity-backend.service
   sudo systemctl enable onefinity-frontend.service
   
   # Or enable the target (enables all)
   sudo systemctl enable onefinity-native.target
   ```

3. **Start services:**
   ```bash
   # Start all at once
   sudo systemctl start onefinity-native.target
   
   # Or start individually
   sudo systemctl start redis-onefinity.service
   sudo systemctl start onefinity-backend.service
   sudo systemctl start onefinity-frontend.service
   ```

## Management Commands

### Check Status

```bash
# All services
sudo systemctl status onefinity-native.target

# Individual services
sudo systemctl status onefinity-backend.service
sudo systemctl status onefinity-frontend.service
sudo systemctl status redis-onefinity.service
```

### View Logs

```bash
# Backend logs
sudo journalctl -u onefinity-backend.service -f

# Frontend (Nginx)
sudo journalctl -u onefinity-frontend.service -f
sudo tail -f /var/log/nginx/onefinity.access.log
sudo tail -f /var/log/nginx/onefinity.error.log

# Redis
sudo journalctl -u redis-onefinity.service -f

# All services
sudo journalctl -u onefinity-native.target -f
```

### Restart Services

```bash
# Restart all
sudo systemctl restart onefinity-native.target

# Restart individual
sudo systemctl restart onefinity-backend.service
sudo systemctl restart onefinity-frontend.service
```

### Stop Services

```bash
# Stop all
sudo systemctl stop onefinity-native.target

# Stop individual
sudo systemctl stop onefinity-backend.service
sudo systemctl stop onefinity-frontend.service
```

### Disable Auto-Start

```bash
# Disable all
sudo systemctl disable onefinity-native.target

# Disable individual
sudo systemctl disable onefinity-backend.service
```

## Nginx Configuration

The frontend service manages an Nginx site configuration. You need to:

1. **Copy Nginx config:**
   ```bash
   sudo cp nginx/onefinity-native.conf /etc/nginx/sites-available/onefinity
   ```

2. **Test Nginx configuration:**
   ```bash
   sudo nginx -t
   ```

3. **The service will automatically:**
   - Create symlink in `sites-enabled/`
   - Reload Nginx when started
   - Remove symlink when stopped

## Serial Port Access

The backend service runs with the `dialout` group for serial port access.

**Verify user has access:**
```bash
groups cnc
# Should include: dialout
```

**Add user to dialout group (if needed):**
```bash
sudo usermod -a -G dialout cnc
```

**Check serial devices:**
```bash
ls -la /dev/ttyUSB* /dev/ttyACM*
```

## Resource Limits

Services have resource limits configured for Raspberry Pi:

| Service | Memory Limit | CPU Limit |
|---------|--------------|-----------|
| Backend | 1GB | 150% (1.5 cores) |
| Redis | 512MB | 50% (0.5 cores) |
| Frontend | N/A (Nginx) | N/A |

**To adjust limits:**
Edit the service file and modify:
```ini
MemoryLimit=2G
CPUQuota=200%
```

Then reload:
```bash
sudo systemctl daemon-reload
sudo systemctl restart service-name
```

## Security Hardening

Services are configured with security features:
- Non-root users (cnc, redis)
- No new privileges
- Private /tmp
- Protected system directories
- Read-only home directories
- Limited write access

## Troubleshooting

### Backend won't start

1. **Check Node.js version:**
   ```bash
   node --version  # Should be v18+
   ```

2. **Check dependencies:**
   ```bash
   cd /opt/onefinity/app/backend
   npm install
   ```

3. **Check Redis connection:**
   ```bash
   redis-cli ping
   # Should return: PONG
   ```

4. **Check logs:**
   ```bash
   sudo journalctl -u onefinity-backend.service -n 50
   ```

### Serial port access denied

1. **Check user groups:**
   ```bash
   id cnc
   ```

2. **Check device permissions:**
   ```bash
   ls -la /dev/ttyUSB0
   ```

3. **Verify service runs as cnc user:**
   ```bash
   ps aux | grep node
   ```

### Nginx configuration errors

1. **Test configuration:**
   ```bash
   sudo nginx -t
   ```

2. **Check site enabled:**
   ```bash
   ls -la /etc/nginx/sites-enabled/onefinity
   ```

3. **Check Nginx logs:**
   ```bash
   sudo tail -f /var/log/nginx/error.log
   ```

### Service fails to start

1. **Check service status:**
   ```bash
   sudo systemctl status service-name.service
   ```

2. **Check dependencies:**
   ```bash
   systemctl list-dependencies service-name.service
   ```

3. **Check for port conflicts:**
   ```bash
   sudo netstat -tulpn | grep -E ':(4000|6379|80)'
   ```

## Performance Monitoring

### Check service resource usage:
```bash
systemctl status onefinity-backend.service
# Shows memory and CPU usage
```

### Detailed monitoring:
```bash
# Install monitoring tools
sudo apt install sysstat

# Monitor CPU/memory
htop

# Monitor I/O
iotop

# Monitor network
iftop
```

## Advantages of Native Deployment

✅ Lower memory usage (~500MB less than Docker)
✅ Faster startup time
✅ Direct hardware access (no container overhead)
✅ Simpler troubleshooting
✅ Better for resource-constrained devices

## Disadvantages

❌ Manual dependency management
❌ System-wide package conflicts possible
❌ More difficult updates
❌ Requires system administration knowledge

## Backup and Restore

### Configuration backup:
```bash
sudo tar czf onefinity-config-backup.tar.gz \
  /opt/onefinity/config \
  /etc/systemd/system/onefinity-*.service \
  /etc/nginx/sites-available/onefinity
```

### Redis data backup:
```bash
sudo redis-cli SAVE
sudo cp /var/lib/redis/dump.rdb ~/redis-backup.rdb
```

### Application logs backup:
```bash
sudo tar czf onefinity-logs-backup.tar.gz /opt/onefinity/logs
```

## Updating the Application

1. **Stop services:**
   ```bash
   sudo systemctl stop onefinity-native.target
   ```

2. **Backup current version:**
   ```bash
   sudo cp -r /opt/onefinity/app /opt/onefinity/app.backup
   ```

3. **Update files:**
   ```bash
   sudo cp -r /path/to/new/backend /opt/onefinity/app/
   sudo cp -r /path/to/new/frontend/dist /opt/onefinity/app/frontend
   ```

4. **Update dependencies:**
   ```bash
   cd /opt/onefinity/app/backend
   npm ci --production
   ```

5. **Start services:**
   ```bash
   sudo systemctl start onefinity-native.target
   ```

## Switching from Docker to Native

Use the deployment switcher script (see ../install-scripts/switch-deployment.sh):

```bash
sudo /opt/onefinity/scripts/switch-deployment.sh native
```

This will:
- Stop Docker services
- Disable Docker auto-start
- Enable native services
- Update environment configuration
- Start native services

## References

- [Systemd Service Documentation](https://www.freedesktop.org/software/systemd/man/systemd.service.html)
- [Nginx Configuration](https://nginx.org/en/docs/)
- [Redis Configuration](https://redis.io/docs/management/config/)
- [Node.js on Raspberry Pi](https://nodejs.org/en/download/package-manager/)
