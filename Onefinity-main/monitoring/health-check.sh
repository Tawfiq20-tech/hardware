#!/bin/bash
#
# Onefinity CNC Controller - System Health Check
# Monitors system health and performance
#

set -e

# Configuration
TEMP_THRESHOLD=80
CPU_THRESHOLD=90
MEM_THRESHOLD=90
DISK_THRESHOLD=90
LOG_FILE="/opt/onefinity/logs/health-check.log"

# Colors for output
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

# Logging function
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# Check CPU temperature
check_temperature() {
    if [ -f /sys/class/thermal/thermal_zone0/temp ]; then
        TEMP=$(($(cat /sys/class/thermal/thermal_zone0/temp) / 1000))
        
        if [ $TEMP -gt $TEMP_THRESHOLD ]; then
            echo -e "${RED}WARNING: CPU temperature is ${TEMP}°C (threshold: ${TEMP_THRESHOLD}°C)${NC}"
            log "WARNING: High CPU temperature: ${TEMP}°C"
            return 1
        else
            echo -e "${GREEN}✓ CPU temperature: ${TEMP}°C${NC}"
            return 0
        fi
    else
        echo "Temperature sensor not available"
        return 0
    fi
}

# Check CPU usage
check_cpu() {
    CPU_USAGE=$(top -bn1 | grep "Cpu(s)" | sed "s/.*, *\([0-9.]*\)%* id.*/\1/" | awk '{print 100 - $1}')
    CPU_USAGE_INT=${CPU_USAGE%.*}
    
    if [ $CPU_USAGE_INT -gt $CPU_THRESHOLD ]; then
        echo -e "${RED}WARNING: CPU usage is ${CPU_USAGE}% (threshold: ${CPU_THRESHOLD}%)${NC}"
        log "WARNING: High CPU usage: ${CPU_USAGE}%"
        return 1
    else
        echo -e "${GREEN}✓ CPU usage: ${CPU_USAGE}%${NC}"
        return 0
    fi
}

# Check memory usage
check_memory() {
    MEM_USAGE=$(free | grep Mem | awk '{printf("%.0f", $3/$2 * 100.0)}')
    
    if [ $MEM_USAGE -gt $MEM_THRESHOLD ]; then
        echo -e "${RED}WARNING: Memory usage is ${MEM_USAGE}% (threshold: ${MEM_THRESHOLD}%)${NC}"
        log "WARNING: High memory usage: ${MEM_USAGE}%"
        return 1
    else
        echo -e "${GREEN}✓ Memory usage: ${MEM_USAGE}%${NC}"
        return 0
    fi
}

# Check disk usage
check_disk() {
    DISK_USAGE=$(df -h / | tail -1 | awk '{print $5}' | sed 's/%//')
    
    if [ $DISK_USAGE -gt $DISK_THRESHOLD ]; then
        echo -e "${RED}WARNING: Disk usage is ${DISK_USAGE}% (threshold: ${DISK_THRESHOLD}%)${NC}"
        log "WARNING: High disk usage: ${DISK_USAGE}%"
        return 1
    else
        echo -e "${GREEN}✓ Disk usage: ${DISK_USAGE}%${NC}"
        return 0
    fi
}

# Check services
check_services() {
    local all_ok=0
    
    # Check deployment mode
    if [ -f "/opt/onefinity/config/deployment.conf" ]; then
        DEPLOYMENT_MODE=$(grep DEPLOYMENT_MODE /opt/onefinity/config/deployment.conf | cut -d'=' -f2)
        
        if [ "$DEPLOYMENT_MODE" = "docker" ]; then
            # Check Docker services
            if systemctl is-active --quiet onefinity-docker.service; then
                echo -e "${GREEN}✓ Docker deployment running${NC}"
                
                # Check containers
                if command -v docker &>/dev/null; then
                    CONTAINERS=$(docker ps --format "{{.Names}}: {{.Status}}")
                    echo "$CONTAINERS"
                fi
            else
                echo -e "${RED}✗ Docker deployment not running${NC}"
                log "ERROR: Docker deployment not running"
                all_ok=1
            fi
        else
            # Check native services
            for service in redis-onefinity onefinity-backend onefinity-frontend; do
                if systemctl is-active --quiet $service.service; then
                    echo -e "${GREEN}✓ $service running${NC}"
                else
                    echo -e "${RED}✗ $service not running${NC}"
                    log "ERROR: $service not running"
                    all_ok=1
                fi
            done
        fi
    fi
    
    return $all_ok
}

# Check network
check_network() {
    if ping -c 1 8.8.8.8 &>/dev/null; then
        echo -e "${GREEN}✓ Network connectivity${NC}"
        return 0
    else
        echo -e "${RED}✗ No network connectivity${NC}"
        log "ERROR: No network connectivity"
        return 1
    fi
}

# Check serial ports
check_serial() {
    if ls /dev/ttyUSB* /dev/ttyACM* &>/dev/null; then
        echo -e "${GREEN}✓ Serial ports available:${NC}"
        ls -la /dev/ttyUSB* /dev/ttyACM* 2>/dev/null | awk '{print "  "$NF}'
        return 0
    else
        echo -e "${YELLOW}⚠ No serial ports detected${NC}"
        return 0
    fi
}

# Main health check
main() {
    echo "======================================"
    echo "Onefinity CNC - System Health Check"
    echo "======================================"
    echo ""
    
    local exit_code=0
    
    echo "System Resources:"
    check_temperature || exit_code=1
    check_cpu || exit_code=1
    check_memory || exit_code=1
    check_disk || exit_code=1
    
    echo ""
    echo "Services:"
    check_services || exit_code=1
    
    echo ""
    echo "Network & Hardware:"
    check_network || exit_code=1
    check_serial || exit_code=1
    
    echo ""
    if [ $exit_code -eq 0 ]; then
        echo -e "${GREEN}All systems operational!${NC}"
        log "Health check passed"
    else
        echo -e "${RED}Some issues detected. Check logs for details.${NC}"
        log "Health check failed"
    fi
    
    return $exit_code
}

# Run health check
main "$@"
