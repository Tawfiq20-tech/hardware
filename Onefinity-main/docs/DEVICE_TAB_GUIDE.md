# Device Tab - USB Connection Guide

## Overview

The USB serial connection feature has been **moved to the Device tab** for better organization and user experience. Now you can manage your CNC controller connection from a dedicated interface.

## How to Access

1. Click on the **"Device"** tab in the header navigation bar
2. The Device panel will open, replacing the 3D workspace view
3. All connection controls are now in one place

## Features

### 📋 Device Dropdown List

**Select from previously authorized devices:**

1. Click the dropdown that says "Select a device..."
2. A list of all previously connected USB devices appears
3. Each device shows:
   - Device name (e.g., "CH340 Serial (grblHAL/GRBL)")
   - USB Vendor ID (VID) and Product ID (PID)
   - Visual indicator (✓) for currently selected device

**Example entries:**
- `CH340 Serial (grblHAL/GRBL)` - VID:0x1A86, PID:0x7523
- `FTDI Serial Device` - VID:0x0403, PID:0x6001
- `Arduino (GRBL)` - VID:0x2341, PID:0x0043

### ➕ Add New Device

If your device isn't in the list:

1. Click **"Add New Device"** at the bottom of the dropdown
2. Browser will show the port selection dialog
3. Choose your CNC controller from the system list
4. Device will be added to the dropdown automatically

### 🔌 Connection Process

**Step-by-step:**

1. **Open Device Tab** - Click "Device" in the header
2. **Select Device** - Choose your controller from the dropdown
3. **Click Connect** - Press the large "Connect" button
4. **Wait** - Status changes from "Not Connected" → "Connecting..." → "Connected"
5. **Done!** - Device info appears and you can return to other tabs

### 📊 Connection Status Indicator

Visual feedback shows current state:

| Indicator | Color | Meaning |
|-----------|-------|---------|
| ⚪ Gray dot | Gray | Not Connected |
| 🟡 Pulsing yellow | Yellow | Connecting... |
| 🟢 Green dot (glowing) | Green | Connected |
| 🔴 Red dot | Red | Connection Error |

### ℹ️ Device Information Card

Once connected, you'll see:

- **Device Name**: Full name of your controller
- **Vendor ID**: USB Vendor identifier
- **Product ID**: USB Product identifier  
- **Baud Rate**: Communication speed (115200 for GRBL)

### 🔄 Refresh Device List

Click the refresh button (🔄) next to "Device Connection" to:
- Reload the list of available ports
- Detect newly plugged devices
- Clear any cached information

### 🔌 Disconnect

When finished:

1. Go to the Device tab
2. Click the red **"Disconnect"** button
3. Status returns to "Not Connected"
4. Device remains in dropdown for quick reconnection

## Device Tab Layout

```
┌─────────────────────────────────────────┐
│         Device Connection      🔄        │
├─────────────────────────────────────────┤
│                                          │
│  Select Device                           │
│  ┌────────────────────────────────────┐ │
│  │ 📡 CH340 Serial (grblHAL) ▼       │ │
│  └────────────────────────────────────┘ │
│                                          │
│  ┌────────────────────────────────────┐ │
│  │        🟢 Connect                  │ │
│  └────────────────────────────────────┘ │
│                                          │
│  ⚫ Not Connected                        │
│                                          │
│  ┌─ Device Information ────────────────┐│
│  │ Name: CH340 Serial (grblHAL)       ││
│  │ Vendor ID: 0x1A86                   ││
│  │ Product ID: 0x7523                  ││
│  │ Baud Rate: 115200                   ││
│  └─────────────────────────────────────┘│
│                                          │
│  ┌─ Connection Help ───────────────────┐│
│  │ • Make sure controller is connected ││
│  │ • Close other serial applications   ││
│  │ • Supported: GRBL, grblHAL          ││
│  │ • Requires: Chrome, Edge, Opera     ││
│  └─────────────────────────────────────┘│
└─────────────────────────────────────────┘
```

## Dropdown Menu Details

When you click the device selector, the dropdown shows:

```
┌────────────────────────────────────────┐
│ 📡 CH340 Serial (grblHAL/GRBL)      ✓ │ ← Selected
│    VID:0x1A86 | PID:0x7523             │
├────────────────────────────────────────┤
│ 📡 FTDI Serial Device                  │
│    VID:0x0403 | PID:0x6001             │
├────────────────────────────────────────┤
│ 📡 Arduino (GRBL)                      │
│    VID:0x2341 | PID:0x0043             │
├────────────────────────────────────────┤
│       📡 Add New Device                │ ← Authorize new
└────────────────────────────────────────┘
```

## Automatic Device Recognition

The system automatically identifies common CNC controllers:

| Vendor ID | Device Name Shown |
|-----------|-------------------|
| 0x1A86 | CH340 Serial (grblHAL/GRBL) |
| 0x0403 | FTDI Serial Device |
| 0x10C4 | CP210x Serial (GRBL) |
| 0x2341 | Arduino (GRBL) |
| Others | USB Serial (VID:xxxx, PID:yyyy) |

## Workflow Examples

### First Time Setup

1. Click **"Device"** tab
2. Dropdown shows "No devices found"
3. Click **"Add New Device"**
4. Browser shows port selection → Choose COM3
5. COM3 appears in dropdown as "CH340 Serial (grblHAL/GRBL)"
6. Click **"Connect"**
7. Success! Return to Prepare tab to work

### Daily Use (Previously Connected)

1. Click **"Device"** tab
2. Dropdown already shows your device
3. Click your device name
4. Click **"Connect"**
5. Done! Start working

### Switching Between Multiple Controllers

1. Click **"Device"** tab
2. If connected, click **"Disconnect"**
3. Open dropdown
4. Select different controller
5. Click **"Connect"**
6. New controller is active

## Advantages of Device Tab

✅ **Organized** - All connection controls in one place
✅ **Clear** - Dedicated space for device management
✅ **Visual** - See all available devices at once
✅ **Persistent** - Device selection remembered
✅ **Informative** - Device details and help always visible
✅ **No clutter** - Keeps main workspace clean

## Troubleshooting

### Dropdown is Empty

**Solution:** Click "Add New Device" to authorize your first device

### Device Not Appearing

**Solutions:**
1. Click the refresh button (🔄)
2. Unplug and replug USB cable
3. Check Device Manager (Windows) for COM port
4. Install USB drivers (CH340, FTDI, etc.)

### Can't Click Connect

**Reason:** No device selected
**Solution:** Select a device from dropdown first

### Connection Fails

**Check:**
- Other apps closed (UGS, bCNC, Arduino IDE)
- USB cable firmly connected
- Controller powered on
- Correct browser (Chrome/Edge/Opera)

## Integration with Other Tabs

Once connected in Device tab:

- **Prepare Tab** - Jog controls work with real hardware
- **Preview Tab** - Upload and preview G-code
- **Console** (in Prepare) - See all serial communication
- **Machine Position** - Updates from real controller

## Quick Tips

💡 **Tip 1:** You only need to "Add New Device" once per controller
💡 **Tip 2:** Device list persists between browser sessions
💡 **Tip 3:** Connection status visible in header (all tabs)
💡 **Tip 4:** Can connect/disconnect without reloading page
💡 **Tip 5:** Dropdown closes automatically after selection

## Status in Header

Even when you leave the Device tab, the header shows connection status:

```
┌────────────────────────────────────────┐
│ Prepare Preview Device Project        │
│                                        │
│     ⚫ OFFLINE    F: 0    S: 0         │
│                                        │
└────────────────────────────────────────┘
           ↓ After connection ↓
┌────────────────────────────────────────┐
│ Prepare Preview Device Project        │
│                                        │
│   🟢 IDLE   F: 3240  S: 18500  E-Stop │
│                                        │
└────────────────────────────────────────┘
```

---

**The Device tab is your control center for USB connectivity! 🚀**
