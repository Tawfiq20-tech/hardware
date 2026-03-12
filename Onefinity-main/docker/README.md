# Docker Deployment Configuration

This directory contains Docker-specific configuration files for deploying Onefinity CNC Controller on Raspberry Pi.

## Files

### `docker-compose.rpi.yml`
Raspberry Pi optimized Docker Compose configuration with:
- **Health checks** for all services
- **Restart policies** set to `always` for production
- **Serial device mapping** for USB CNC controllers
- **Privileged mode** for hardware access
- **Resource limits** appropriate for Raspberry Pi

### `onefinity-docker.service` (in ../systemd/)
Systemd service unit for managing Docker Compose deployment:
- Auto-starts on boot
- Pulls latest images before starting (optional)
- Proper service dependencies
- Resource limits for Raspberry Pi

### `env.production.template` (in ../config/)
Production environment template with all configuration options

## Usage

### Initial Setup

1. **Copy application files:**
   ```bash
   sudo mkdir -p /opt/onefinity/app
   sudo cp -r /path/to/Onefinity-main/* /opt/onefinity/app/
   sudo chown -R cnc:cnc /opt/onefinity/app
   ```

2. **Copy environment file:**
   ```bash
   sudo mkdir -p /opt/onefinity/config
   sudo cp config/env.production.template /opt/onefinity/config/.env
   sudo nano /opt/onefinity/config/.env  # Edit as needed
   ```

3. **Install systemd service:**
   ```bash
   sudo cp systemd/onefinity-docker.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable onefinity-docker.service
   ```

4. **Start services:**
   ```bash
   sudo systemctl start onefinity-docker.service
   ```

### Management Commands

**Check status:**
```bash
sudo systemctl status onefinity-docker.service
```

**View logs:**
```bash
# Systemd logs
sudo journalctl -u onefinity-docker.service -f

# Docker logs
docker-compose -f /opt/onefinity/app/docker-compose.rpi.yml logs -f
```

**Restart services:**
```bash
sudo systemctl restart onefinity-docker.service
```

**Stop services:**
```bash
sudo systemctl stop onefinity-docker.service
```

**Update containers:**
```bash
cd /opt/onefinity/app
docker-compose -f docker-compose.rpi.yml pull
sudo systemctl restart onefinity-docker.service
```

### Serial Port Configuration

The Docker Compose file maps common serial devices:
- `/dev/ttyUSB0`, `/dev/ttyUSB1` - USB-to-serial adapters
- `/dev/ttyACM0`, `/dev/ttyACM1` - Arduino-compatible boards

**To add more devices:**
Edit `docker-compose.rpi.yml`:
```yaml
devices:
  - /dev/ttyUSB2:/dev/ttyUSB2
  - /dev/serial/by-id/your-device:/dev/your-device
```

**To verify available devices:**
```bash
ls -la /dev/tty{USB,ACM}*
```

### Health Checks

All services have health checks configured:
- **Redis:** `redis-cli ping`
- **Backend:** HTTP check on `/api/health` endpoint
- **Frontend:** HTTP check on root path

**View health status:**
```bash
docker ps
# Look at the "STATUS" column for "(healthy)" indicator
```

### Resource Limits

Resource limits are set in the systemd service:
- **Memory:** 3GB total
- **CPU:** 300% (3 cores equivalent)

**To adjust limits:**
Edit `/etc/systemd/system/onefinity-docker.service`:
```ini
MemoryLimit=4G
CPUQuota=400%
```

Then reload:
```bash
sudo systemctl daemon-reload
sudo systemctl restart onefinity-docker.service
```

## Networking

Services are accessible at:
- **Frontend:** http://localhost:6080
- **Backend API:** http://localhost:6070
- **Redis:** localhost:6060
- **Dozzle (optional):** http://localhost:6040

For kiosk mode, the browser loads: `http://localhost:6080`

For remote access, use Raspberry Pi's IP address or hostname:
- `http://onefinity-cnc.local:6080` (via mDNS)
- `http://192.168.1.xxx:6080` (via IP address)

## Troubleshooting

### Services won't start

1. **Check Docker is running:**
   ```bash
   sudo systemctl status docker
   ```

2. **Check for port conflicts:**
   ```bash
   sudo netstat -tulpn | grep -E ':(6070|6080|6060)'
   ```

3. **Check logs:**
   ```bash
   sudo journalctl -u onefinity-docker.service -n 50
   ```

### Serial port access denied

1. **Verify user is in dialout group:**
   ```bash
   groups cnc
   ```

2. **Check device permissions:**
   ```bash
   ls -la /dev/ttyUSB0
   ```

3. **Add udev rules** (see ../hardware/ directory)

### Containers keep restarting

1. **Check container logs:**
   ```bash
   docker logs onefinity-backend
   docker logs onefinity-frontend
   ```

2. **Check health check status:**
   ```bash
   docker inspect onefinity-backend | grep -A 10 Health
   ```

3. **Verify Redis is healthy:**
   ```bash
   docker exec onefinity-redis redis-cli ping
   ```

### Out of memory errors

Raspberry Pi may run out of memory with all services running:

1. **Increase swap:**
   ```bash
   sudo dphys-swapfile swapoff
   sudo nano /etc/dphys-swapfile  # Set CONF_SWAPSIZE=2048
   sudo dphys-swapfile setup
   sudo dphys-swapfile swapon
   ```

2. **Reduce resource usage:**
   - Disable Dozzle (optional service)
   - Use native deployment instead of Docker

## Advantages of Docker Deployment

✅ Isolated environments (no dependency conflicts)
✅ Easy updates (pull new images)
✅ Consistent across systems
✅ Built-in health monitoring
✅ Easy rollback (switch image tags)
✅ Optional log viewer (Dozzle)

## Disadvantages

❌ Higher memory usage (~500MB overhead)
❌ Slower startup time
❌ Additional complexity for troubleshooting
❌ Requires Docker knowledge

For resource-constrained setups or maximum performance, consider **native deployment** instead (see ../systemd/ for native service units).

## Security Notes

- Services run in isolated containers
- Host network access not used (except for serial devices)
- Firewall (ufw) should be configured on host
- Keep Docker and images updated
- Change default passwords in `.env` file

## Monitoring

### Resource usage:
```bash
docker stats
```

### Service status:
```bash
docker-compose -f /opt/onefinity/app/docker-compose.rpi.yml ps
```

### System logs:
```bash
# Access Dozzle web interface (if enabled)
# http://onefinity-cnc.local:6040
```

## Backup and Restore

### Backup volumes:
```bash
docker run --rm -v onefinity_redis-data:/data -v $(pwd):/backup \
  alpine tar czf /backup/redis-backup.tar.gz -C /data .

docker run --rm -v onefinity_backend-logs:/data -v $(pwd):/backup \
  alpine tar czf /backup/logs-backup.tar.gz -C /data .
```

### Restore volumes:
```bash
docker run --rm -v onefinity_redis-data:/data -v $(pwd):/backup \
  alpine tar xzf /backup/redis-backup.tar.gz -C /data

docker run --rm -v onefinity_backend-logs:/data -v $(pwd):/backup \
  alpine tar xzf /backup/logs-backup.tar.gz -C /data
```

## References

- [Docker Compose Documentation](https://docs.docker.com/compose/)
- [Docker on Raspberry Pi](https://docs.docker.com/engine/install/raspberry-pi-os/)
- [Systemd Service Units](https://www.freedesktop.org/software/systemd/man/systemd.service.html)
