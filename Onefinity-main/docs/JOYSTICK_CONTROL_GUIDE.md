# 🎮 Joystick/Gamepad Control - User Guide

## Overview

Control your CNC machine using a **gamepad or joystick** for smooth, analog movement! This feature adds intuitive, real-time control using any standard game controller.

---

## ✅ Features

✅ **Analog Control** - Smooth, variable-speed movement
✅ **Multi-axis Support** - Control X, Y, and Z simultaneously  
✅ **Speed Varies with Deflection** - Gentle push = slow, full push = fast
✅ **Real-time Feedback** - See axis deflection bars
✅ **Safe Operation** - Must be connected to CNC first
✅ **Standard Controllers** - Works with Xbox, PlayStation, generic gamepads

---

## 🎮 Supported Controllers

| Controller | Compatibility |
|------------|---------------|
| Xbox One/Series | ✅ Excellent |
| Xbox 360 | ✅ Excellent |
| PlayStation 4/5 | ✅ Excellent |
| Generic USB Gamepad | ✅ Good |
| Flight Stick | ✅ Good |
| Racing Wheel | ⚠️ Partial (steering only) |

---

## 🚀 How to Use

### Step 1: Connect Your Gamepad

1. **Plug in** your USB gamepad/joystick
2. **Press any button** on the controller
3. Go to **Device tab** in the app
4. Scroll to **🎮 Joystick Control** section
5. Click **"Connect Joystick"** button

### Step 2: Connect to CNC

1. Select your CNC controller (COM3)
2. Click **"Connect"**
3. Wait for "🟢 Connected" status

### Step 3: Activate Joystick Control

1. In Joystick Control section
2. Click **"Start Control"** button (green play icon)
3. Status changes to **"🟢 Active"**

### Step 4: Control Your Machine

**Left Stick:**
- Left/Right → X-axis movement
- Up/Down → Y-axis movement

**Right Stick:**
- Up/Down → Z-axis movement

**Speed:**
- Slight deflection → Slow movement (500 mm/min)
- Full deflection → Fast movement (2000 mm/min)

---

## 📊 Visual Feedback

### Axis Deflection Bars

The interface shows real-time analog stick position:

```
Left X:  ████████░░░░░░░░  (65% right)
Left Y:  ░░░░░░░░░░░░░░░  (centered)
Right Y: ████░░░░░░░░░░░  (30% down)
```

**Colors:**
- 🟢 Green bars = Positive direction (+X, +Y, +Z)
- 🔴 Red bars = Negative direction (-X, -Y, -Z)

---

## ⚙️ Technical Details

### Control Mapping

| Stick Input | CNC Axis | Direction |
|-------------|----------|-----------|
| Left Stick → Right | X+ | Positive X |
| Left Stick ← Left | X- | Negative X |
| Left Stick ↑ Up | Y+ | Positive Y |
| Left Stick ↓ Down | Y- | Negative Y |
| Right Stick ↑ Up | Z+ | Positive Z (up) |
| Right Stick ↓ Down | Z- | Negative Z (down) |

### Speed Calculation

**Feed Rate Formula:**
```
feedRate = minSpeed + (maxSpeed - minSpeed) × deflection × multiplier
```

**Default Settings:**
- Min Speed: 500 mm/min
- Max Speed: 2000 mm/min
- Update Rate: 100ms (10 Hz)
- Deadzone: 15% (ignores small movements)

### G-code Commands Sent

**Example with joystick at 50% deflection:**
```gcode
$J=G91 G21 X0.250 Y-0.125 F1250
```

**Breakdown:**
- `$J=` - GRBL jog mode
- `G91` - Incremental positioning
- `G21` - Millimeters
- `X0.250` - Move 0.25mm in X
- `Y-0.125` - Move 0.125mm in Y
- `F1250` - Feed rate 1250 mm/min

---

## 🔧 Configuration

### Movement Distance Per Command

**Default:** 0.5mm maximum per command
- 100% deflection = 0.5mm movement
- 50% deflection = 0.25mm movement
- 25% deflection = 0.125mm movement

### Deadzone Setting

**Default:** 15%
- Prevents drift from worn sticks
- Ignores unintentional small movements
- Adjustable in code (0-100%)

### Poll Rate

**Default:** 50ms (20 Hz sampling)
- Command throttle: 100ms (10 commands/sec)
- Balance between responsiveness and controller load

---

## 🛡️ Safety Features

### 1. Connection Required
- ✅ Must connect to CNC first
- ✅ "Start Control" button disabled until connected
- ✅ No accidental movements

### 2. Manual Activation
- ⚪ Joystick connects in "Standby" mode
- 🟢 Must explicitly press "Start Control"
- 🔴 Press "Stop Control" to pause

### 3. Command Throttling
- Limits commands to 10 per second
- Prevents buffer overflow
- Smooth, controlled movement

### 4. GRBL Jog Mode
- Uses safe `$J=` commands
- Immediate cancellation with feed hold
- Respects soft limits

### 5. Deadzone Protection
- 15% deadzone prevents drift
- No movement from centered stick
- Safe idle state

---

## 🎯 Best Practices

### DO ✅

✅ **Test at low speed first** - Start with gentle movements
✅ **Check soft limits** - Ensure limits are configured in GRBL
✅ **Use for setup** - Great for workpiece positioning
✅ **Keep E-Stop accessible** - Physical emergency stop button
✅ **Disconnect when done** - Click "Disconnect Joystick"

### DON'T ❌

❌ **Don't use during jobs** - Joystick is for manual control only
❌ **Don't force past limits** - Respect machine travel limits
❌ **Don't leave unattended** - Always supervise movement
❌ **Don't use worn controllers** - Drift can cause issues
❌ **Don't go full speed initially** - Test gentle movements first

---

## 🐛 Troubleshooting

### Joystick Not Detected

**Problem:** "No gamepad/joystick detected" error

**Solutions:**
1. **Unplug and replug** USB connection
2. **Press any button** on the controller
3. **Check Device Manager** (Windows) - look for "Game Controllers"
4. **Try different USB port**
5. **Install drivers** if needed (some generic controllers)

### Controller Drifting

**Problem:** Machine moves when stick is centered

**Solutions:**
1. **Check controller** - test in game/control panel
2. **Increase deadzone** - edit `joystickManager.ts` line 26
3. **Recalibrate controller** - use Windows/system tools
4. **Replace controller** - worn potentiometers

### No Movement

**Problem:** Joystick active but machine doesn't move

**Check:**
1. ✅ CNC is **connected** (🟢 green status)
2. ✅ Joystick is **active** (green "Stop Control" button)
3. ✅ Stick deflection bars moving in UI
4. ✅ Machine not in **ALARM** state
5. ✅ Console shows jog commands: `$J=G91...`

### Jerky Movement

**Problem:** Movement is not smooth

**Solutions:**
1. **Reduce feed rate** - edit max speed in code
2. **Check USB connection** - bad cable can cause lag
3. **Close other apps** - free up USB bandwidth
4. **Update controller firmware** - if available

### Wrong Direction

**Problem:** Stick goes left but machine goes right

**Solutions:**
- Axis inverted in GRBL settings
- Check `$3` parameter (direction inversion mask)
- Can modify mapping in `joystickManager.ts`

---

## 🎮 Controller Button Mapping

### Current Implementation
Only analog sticks are used. Buttons are read but not mapped.

### Future Enhancements
Buttons could be mapped to:
- **A Button** - Quick Z-raise
- **B Button** - Return to home
- **X Button** - Zero current position
- **Y Button** - Toggle speed mode
- **LB/RB** - Adjust jog distance
- **Start** - Pause/Resume
- **Back** - Emergency stop

---

## 📝 Code Files

### Joystick Manager
**File:** `src/utils/joystickManager.ts`
- Core gamepad reading logic
- Deadzone application
- State polling
- CNC command mapper

### Device Panel Integration
**File:** `src/components/DevicePanel.tsx`
- UI for joystick connection
- Axis visualization
- Control buttons
- Real-time feedback

### Styles
**File:** `src/components/DevicePanel.css`
- Joystick section styling
- Axis bar animations
- Button states

---

## 🔬 Advanced Configuration

### Change Speed Range

Edit `DevicePanel.tsx` line 25:

```typescript
// Current: 500-2000 mm/min
const [joystickMapper] = useState(() => new JoystickCNCMapper(500, 2000));

// Slower: 100-1000 mm/min
const [joystickMapper] = useState(() => new JoystickCNCMapper(100, 1000));

// Faster: 1000-3000 mm/min
const [joystickMapper] = useState(() => new JoystickCNCMapper(1000, 3000));
```

### Change Deadzone

Edit `joystickManager.ts` line 26:

```typescript
// Current: 15%
private deadzone: number = 0.15;

// More sensitive: 10%
private deadzone: number = 0.10;

// Less sensitive: 20%
private deadzone: number = 0.20;
```

### Change Movement Distance

Edit `DevicePanel.tsx` lines 207-209:

```typescript
// Current: 0.5mm max
const scaleFactor = feedRate / 2000;
const distance = 0.5 * scaleFactor;

// Larger movements: 1mm max
const distance = 1.0 * scaleFactor;

// Smaller movements: 0.25mm max
const distance = 0.25 * scaleFactor;
```

---

## 💡 Use Cases

### 1. **Workpiece Positioning**
Use joystick for fine positioning before starting a job

### 2. **Tool Zeroing**
Gently approach workpiece for tool height setting

### 3. **Machine Setup**
Quick navigation to different work areas

### 4. **Testing/Inspection**
Move around finished piece for quality check

### 5. **Manual Operations**
Hand-guided operations like edge finding

---

## 🌟 Tips & Tricks

💡 **Combine with keyboard** - Use joystick for XY, keyboard for Z
💡 **Practice in air** - Test movements above workpiece first
💡 **Use both sticks** - Left for XY, right for Z simultaneously
💡 **Feather the stick** - Gentle touches for precise control
💡 **Stop before switching** - Return stick to center before direction change

---

## 📊 Status Indicators

| Status | Meaning |
|--------|---------|
| 📍 Button visible | Joystick detected |
| ⚪ Standby | Connected but not active |
| 🟢 Active | Controlling machine |
| 🔴 Not Connected | Joystick not connected |

---

## 🎬 Quick Start Summary

```
1. Plug in gamepad → Press any button
2. Device Tab → Connect Joystick
3. Connect to CNC controller
4. Click "Start Control"
5. Move sticks gently
6. Watch machine respond!
```

---

## ⚠️ Important Notes

⚠️ **Browser Requirement:** Gamepad API supported in Chrome, Edge, Firefox, Opera
⚠️ **CNC Connection Required:** Must be connected to CNC before activating
⚠️ **Supervision Required:** Never leave joystick-controlled machine unattended
⚠️ **Not for Production:** Joystick best for setup, not automated jobs

---

**Enjoy smooth, intuitive CNC control with your gamepad! 🎮🔧**
