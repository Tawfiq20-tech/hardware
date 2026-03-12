#!/bin/bash
#
# Display Setup Script for LightDM
# Runs before the display manager starts
#

# Set display resolution (adjust as needed)
# xrandr --output HDMI-1 --mode 1920x1080 --rotate normal

# Set display brightness (0-255)
# echo 255 > /sys/class/backlight/*/brightness

# Disable screen blanking
xset s off
xset -dpms
xset s noblank

# Log
logger "Onefinity CNC: Display setup completed"
