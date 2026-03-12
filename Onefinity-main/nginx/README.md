# Nginx Configuration for Onefinity CNC Controller

This directory contains Nginx configuration files for the native deployment mode.

## Files

### `onefinity-native.conf`
Main Nginx site configuration for native deployment:
- Serves frontend static files from `/opt/onefinity/app/frontend/dist`
- Proxies API requests to backend on port 4000
- Proxies WebSocket connections for Socket.IO
- Enables gzip compression
- Configures caching for static assets
- Includes security headers
- Optional HTTPS configuration (commented out)

## Installation

### Copy Configuration

```bash
sudo cp nginx/onefinity-native.conf /etc/nginx/sites-available/onefinity
```

### Enable Site

```bash
sudo ln -s /etc/nginx/sites-available/onefinity /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default  # Remove default site
```

### Test Configuration

```bash
sudo nginx -t
```

### Reload Nginx

```bash
sudo systemctl reload nginx
```

Or restart:
```bash
sudo systemctl restart nginx
```

## Configuration Details

### Frontend Serving

Frontend static files are served from:
```
/opt/onefinity/app/frontend/dist
```

Ensure frontend is built:
```bash
cd /opt/onefinity/app/frontend
npm run build
```

### Backend Proxy

API requests to `/api/*` are proxied to:
```
http://localhost:4000
```

Backend must be running on port 4000.

### WebSocket Proxy

Socket.IO connections to `/socket.io/*` are proxied with:
- HTTP/1.1 protocol
- Upgrade header for WebSocket
- Long timeout (24 hours)
- No buffering

### Caching

Static assets (JS, CSS, images) are cached for 1 year:
```nginx
location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
    expires 1y;
    add_header Cache-Control "public, immutable";
}
```

### Security Headers

Includes security headers:
- `X-Frame-Options: SAMEORIGIN` - Prevent clickjacking
- `X-Content-Type-Options: nosniff` - Prevent MIME sniffing
- `X-XSS-Protection: 1; mode=block` - XSS protection
- `Referrer-Policy: no-referrer-when-downgrade` - Referrer control

## HTTPS Configuration

### Generate Self-Signed Certificate

```bash
sudo openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout /etc/ssl/private/onefinity.key \
  -out /etc/ssl/certs/onefinity.crt
```

Fill in the prompts (Common Name should be your hostname or IP).

### Enable HTTPS

Uncomment the HTTPS server block in `onefinity-native.conf` and copy the location blocks from the HTTP server.

### Test and Reload

```bash
sudo nginx -t
sudo systemctl reload nginx
```

### Access via HTTPS

```
https://onefinity-cnc.local
```

You'll get a browser warning for self-signed certificates - accept it.

### Let's Encrypt (Production)

For valid SSL certificates in production:

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

## Customization

### Change Frontend Path

Edit `root` directive:
```nginx
root /path/to/your/frontend/build;
```

### Change Backend Port

Edit `proxy_pass` in `/api/` and `/socket.io/` locations:
```nginx
proxy_pass http://localhost:YOUR_PORT;
```

### Add Custom Headers

Add in server block:
```nginx
add_header X-Custom-Header "value" always;
```

### Enable Access Logging

Access logs are enabled by default. To disable:
```nginx
access_log off;
```

Or change location:
```nginx
access_log /var/log/nginx/custom.log;
```

### Configure Rate Limiting

Add before server block:
```nginx
limit_req_zone $binary_remote_addr zone=api_limit:10m rate=10r/s;

server {
    location /api/ {
        limit_req zone=api_limit burst=20;
        # ... rest of config
    }
}
```

### Add IP Whitelist

Restrict access to specific IPs:
```nginx
location /api/ {
    allow 192.168.1.0/24;
    allow 10.0.0.0/8;
    deny all;
    
    proxy_pass http://localhost:4000;
}
```

### Enable Basic Authentication

```bash
sudo apt install apache2-utils
sudo htpasswd -c /etc/nginx/.htpasswd admin
```

Add to location:
```nginx
location /api/ {
    auth_basic "Restricted Access";
    auth_basic_user_file /etc/nginx/.htpasswd;
    
    proxy_pass http://localhost:4000;
}
```

## Troubleshooting

### 502 Bad Gateway

**Problem:** Backend not running or not accessible

**Solutions:**
```bash
# Check backend status
sudo systemctl status onefinity-backend.service

# Check backend is listening
sudo netstat -tulpn | grep 4000

# Check logs
sudo tail -f /var/log/nginx/onefinity.error.log
sudo journalctl -u onefinity-backend.service -f
```

### 404 Not Found

**Problem:** Frontend files not found

**Solutions:**
```bash
# Check frontend directory exists
ls -la /opt/onefinity/app/frontend/dist

# Check index.html exists
ls -la /opt/onefinity/app/frontend/dist/index.html

# Check permissions
sudo chown -R www-data:www-data /opt/onefinity/app/frontend/dist
```

### WebSocket Connection Failed

**Problem:** Socket.IO not connecting

**Solutions:**
```bash
# Check proxy headers
curl -I http://localhost/socket.io/

# Check backend WebSocket support
curl --include \
     --no-buffer \
     --header "Connection: Upgrade" \
     --header "Upgrade: websocket" \
     http://localhost:4000/socket.io/

# Check Nginx error log
sudo tail -f /var/log/nginx/onefinity.error.log
```

### Configuration Test Failed

**Problem:** `nginx -t` shows errors

**Solutions:**
```bash
# Check syntax
sudo nginx -t

# Verify file exists
ls -la /etc/nginx/sites-available/onefinity

# Verify symlink
ls -la /etc/nginx/sites-enabled/onefinity

# Check for conflicting configurations
sudo nginx -T | grep "listen 80"
```

### Permission Denied

**Problem:** Nginx can't access files

**Solutions:**
```bash
# Check file permissions
ls -la /opt/onefinity/app/frontend/dist

# Set correct permissions
sudo chown -R www-data:www-data /opt/onefinity/app/frontend/dist
sudo chmod -R 755 /opt/onefinity/app/frontend/dist

# Check SELinux (if enabled)
sudo setenforce 0  # Temporarily disable to test
```

## Performance Tuning

### Enable HTTP/2

Requires HTTPS:
```nginx
listen 443 ssl http2;
listen [::]:443 ssl http2;
```

### Increase Worker Connections

Edit `/etc/nginx/nginx.conf`:
```nginx
events {
    worker_connections 2048;
}
```

### Adjust Buffer Sizes

```nginx
proxy_buffer_size 4k;
proxy_buffers 8 4k;
proxy_busy_buffers_size 8k;
```

### Enable Caching

```nginx
proxy_cache_path /var/cache/nginx levels=1:2 keys_zone=api_cache:10m max_size=100m inactive=60m;

location /api/ {
    proxy_cache api_cache;
    proxy_cache_valid 200 5m;
    proxy_cache_methods GET HEAD;
    
    proxy_pass http://localhost:4000;
}
```

## Monitoring

### View Access Logs

```bash
sudo tail -f /var/log/nginx/onefinity.access.log
```

### View Error Logs

```bash
sudo tail -f /var/log/nginx/onefinity.error.log
```

### Check Nginx Status

```bash
sudo systemctl status nginx
```

### Test Configuration

```bash
sudo nginx -t
```

### Reload Configuration

```bash
sudo systemctl reload nginx
```

### View All Configuration

```bash
sudo nginx -T
```

## Log Rotation

Nginx logs are automatically rotated by logrotate.

Custom rotation config:
```bash
sudo nano /etc/logrotate.d/nginx
```

Example:
```
/var/log/nginx/*.log {
    daily
    missingok
    rotate 14
    compress
    delaycompress
    notifempty
    create 0640 www-data adm
    sharedscripts
    postrotate
        [ -f /var/run/nginx.pid ] && kill -USR1 `cat /var/run/nginx.pid`
    endscript
}
```

## Security Best Practices

1. **Use HTTPS in production** with valid certificates
2. **Keep Nginx updated**: `sudo apt update && sudo apt upgrade nginx`
3. **Limit request rates** to prevent abuse
4. **Use strong SSL ciphers** (TLSv1.2+)
5. **Disable server tokens**: `server_tokens off;` in nginx.conf
6. **Enable firewall**: Allow only ports 80 and 443
7. **Monitor logs** for suspicious activity
8. **Use fail2ban** to block repeated failed requests

## Comparison: Native vs Docker

### Native Nginx

✅ Direct file access (faster)
✅ Lower memory usage
✅ Easier to customize
✅ System-wide caching
❌ Manual updates needed
❌ Port conflicts possible

### Docker Nginx

✅ Isolated environment
✅ Easy updates (pull new image)
✅ Portable configuration
✅ No system conflicts
❌ Higher memory usage
❌ Additional networking layer

## References

- [Nginx Documentation](https://nginx.org/en/docs/)
- [Nginx Security](https://www.nginx.com/blog/nginx-security-best-practices/)
- [WebSocket Proxying](https://nginx.org/en/docs/http/websocket.html)
- [Let's Encrypt](https://letsencrypt.org/)
