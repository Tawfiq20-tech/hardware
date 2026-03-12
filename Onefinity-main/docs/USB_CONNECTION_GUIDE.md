# USB Serial Connection for CNC Controller

## Overview

This application now supports **real USB serial connectivity** to your CNC controller (GRBL, grblHAL, etc.) using the Web Serial API.

## Browser Requirements

✅ **Supported Browsers:**
- Google Chrome (v89+)
- Microsoft Edge (v89+)
- Opera (v76+)

❌ **Not Supported:**
- Firefox (Web Serial API not implemented)
- Safari (Web Serial API not implemented)

⚠️ **Important:** You must use either `https://` or `localhost` for the Web Serial API to work.

## How to Connect

### Method 1: First Time Connection

1. Click the **"Connect"** button in the header
2. A browser dialog will appear asking you to select a serial port
3. Choose your CNC controller from the list (e.g., "COM3 - grblHAL")
4. Click **"Connect"** in the browser dialog
5. The application will connect and start communicating with your controller

### Method 2: Reconnecting to Previously Authorized Port

If you've connected before, the app will show a modal with previously authorized ports:

1. Click the **"Connect"** button
2. Select your device from the list of previously authorized ports
3. Or click **"Add New Port"** to authorize a new device

## Features

### Real-Time Communication

- ✅ Bi-directional communication with GRBL/grblHAL controllers
- ✅ Automatic status polling (every 250ms)
- ✅ Real-time position updates
- ✅ Machine state monitoring (Idle, Running, Hold, Alarm)
- ✅ Feed rate and spindle speed display

### Jogging Controls

When connected, the jog controls send actual commands to your controller:

- **Step Mode**: Jog by 0.1, 1, 10, or 100mm increments
- **Commands Sent**: `$J=G91 G21 X10 F1000` (for example)
- Position updates in real-time from controller feedback

### Zero Setting

Set work coordinate zero for any axis:

- **Single Axis**: Click "Zero" button next to X, Y, or Z
- **All Axes**: Click "Zero All" button
- **Commands Sent**: `G10 L20 P0 X0` (sets current position as zero)

### Console Monitoring

All communication with the controller is logged in the Console tab:

- System messages (initialization, responses)
- Command echoes (what you sent)
- Status updates (position, state, feed rate, spindle speed)
- Error messages

## Connection Status Indicator

The connection button shows different states:

| Status | Appearance | Meaning |
|--------|------------|---------|
| **Offline** | Gray | Not connected |
| **Connecting...** | Yellow (pulsing) | Attempting to connect |
| **Connected** | Green | Successfully connected |

## Troubleshooting

### "Web Serial API is not supported"

**Solution:** Use Chrome, Edge, or Opera browser. Firefox and Safari don't support Web Serial API yet.

### "No devices found in the port selection dialog"

**Possible Causes:**
1. USB cable not connected
2. Controller not powered on
3. Missing USB drivers (CH340, FTDI, CP2102, etc.)

**Solutions:**
- Check USB cable connection
- Install appropriate USB-to-Serial drivers for your controller
- Try a different USB port
- Check Device Manager (Windows) or `ls /dev/tty*` (Mac/Linux)

### "Failed to open port" / "Port is busy"

**Cause:** Another application is using the serial port

**Solution:** Close other applications that might be using the port:
- Universal G-Code Sender (UGS)
- bCNC
- CNCjs
- Arduino IDE Serial Monitor
- Any other serial terminal software

### "Permission denied"

**Cause:** OS-level permissions issue

**Solutions:**
- **Linux:** Add your user to the `dialout` group:
  ```bash
  sudo usermod -a -G dialout $USER
  ```
  Then log out and log back in.

- **Mac:** No special permissions needed, but try reconnecting the USB cable

### Controller not responding after connection

**Solutions:**
1. Click the **"Connect"** button again to send a soft reset
2. Check baud rate (should be 115200 for GRBL)
3. Power cycle your controller
4. Check the Console tab for error messages

## Supported Controllers

This application is designed for GRBL-based controllers:

- ✅ GRBL v1.1
- ✅ grblHAL
- ✅ GRBL-Mega
- ⚠️ Other controllers may work if they use GRBL-compatible command syntax

## Technical Details

### Baud Rate
Default: **115200** (standard for GRBL)

### Communication Protocol
- Commands are sent as ASCII text with newline (`\n`) terminator
- Responses are parsed and displayed in real-time
- Status requests (`?`) sent every 250ms when connected

### Status Message Format
GRBL sends status in this format:
```
<Idle|MPos:0.000,0.000,0.000|FS:0,0>
```

The app automatically parses this to update:
- Machine state (Idle, Run, Hold, Alarm)
- Machine position (MPos) or Work position (WPos)
- Feed rate (F) and Spindle speed (S)

## Development Notes

### Files Added/Modified

1. **`src/utils/serialConnection.ts`** - Serial connection manager
2. **`src/components/PortSelectionModal.tsx`** - Port selection UI
3. **`src/types/webserial.d.ts`** - TypeScript definitions for Web Serial API
4. **`src/stores/cncStore.ts`** - Updated with real serial connection logic
5. **`src/components/Header.tsx`** - Connect/disconnect button with modal
6. **`src/components/Sidebar.tsx`** - Real jogging and zeroing commands

### API Methods

```typescript
// Connect to controller
await connect();

// Send G-code command
await sendCommand('G0 X10 Y20');

// Disconnect
await disconnect();
```

## Safety

⚠️ **Important Safety Notes:**

1. Always verify machine position before starting a job
2. Use the E-Stop button (when connected) in emergencies
3. Never leave the machine unattended while running
4. Test all movements with low feed rates first
5. Ensure workspace is clear of obstacles

## Getting Help

If you encounter issues:

1. Check the **Console tab** for error messages
2. Verify your controller is working with another app (UGS, bCNC)
3. Check USB cable and drivers
4. Ensure you're using a supported browser
5. Check that no other app is using the serial port

## Demo Mode

If you don't have a physical controller, the app still works in demo mode:
- All UI features are functional
- Position updates are simulated
- No actual hardware commands are sent

## Future Enhancements

Planned features:
- [ ] Custom baud rate selection
- [ ] Support for other controller types (Smoothieboard, TinyG)
- [ ] G-code file streaming to controller
- [ ] Real-time toolpath visualization during job
- [ ] Alarm state handling and recovery
- [ ] Settings backup/restore to controller EEPROM

---

**Happy CNCing! 🛠️**
