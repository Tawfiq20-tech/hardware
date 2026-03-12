# Machine Position Update Fix - Summary

## What I Fixed

### 1. ✅ Enhanced Position Update Tracking

Added comprehensive debugging and visual feedback for position updates:

#### Store Level Debugging
- Added console logs in `setPosition()` to track work position updates
- Added console logs in `setMachinePosition()` to track machine position updates  
- Ensured new object references are created (`{ ...position }`) to trigger React re-renders

#### Connection Level Debugging
- Added console logs in `backendConnection.ts` when position updates are received
- Logs show both work position and machine position values
- Updates every 250ms when GRBL is connected

#### Visual Feedback
- Added a **green indicator dot** in the DRO header
- Dot pulses when position updates are being received
- Goes gray when no updates for 1 second

### 2. ✅ Fixed Diagonal Jog Commands

- Created `handleDiagonalJog()` function for proper combined X+Y movements
- Updated all 4 diagonal jog buttons (NE, SE, SW, NW)
- Commands now send as single diagonal movement instead of two separate commands

---

## How to Test

### Step 1: Refresh Browser
```
Ctrl + Shift + R (hard refresh)
```

### Step 2: Open Browser Console
```
Press F12 → Go to Console tab
```

### Step 3: Connect to CNC
1. Go to Device panel (right side)
2. Select your COM port
3. Click Connect
4. Wait for "Controller initialized" message

### Step 4: Check Position Tab
1. In Device panel, click "Position (DRO)" tab
2. Look for the **green pulsing dot** next to "Digital Readout (DRO)"
   - ✅ **Green & pulsing** = Position updates are being received
   - ❌ **Gray** = No position updates

### Step 5: Watch Console Logs

You should see these logs every 250ms:
```
[Position Update] Work: {x: 0, y: 0, z: 0}
[Store] Setting work position: {x: 0, y: 0, z: 0}
[Position Update] Machine: {x: 0, y: 0, z: 0}
[Store] Setting machine position: {x: 0, y: 0, z: 0}
```

### Step 6: Test Jogging

1. Go to "Controls" tab in left sidebar
2. Click any jog button (try X+)
3. Watch:
   - Console logs should show changing position values
   - DRO should update in real-time
   - Green indicator should keep pulsing

---

## What Each Log Means

### `[Position Update] Work: {...}`
- ✅ Frontend received work position update from backend
- This happens in `backendConnection.ts` when Socket.IO event arrives
- Should appear every 250ms when connected

### `[Store] Setting work position: {...}`
- ✅ Zustand store is updating the work position
- This happens right after position update is received
- Triggers React re-render of components using `position`

### `[Position Update] Machine: {...}`
- ✅ Frontend received machine position update from backend
- This is the raw machine coordinates (before work offsets)
- Should appear every 250ms when connected

### `[Store] Setting machine position: {...}`
- ✅ Zustand store is updating the machine position  
- Triggers React re-render of components using `machinePosition`

---

## Troubleshooting

### Issue: No Console Logs at All

**Symptoms**: No `[Position Update]` or `[Store]` logs appear.

**Diagnosis**:
1. Check if backend is running (`npm start` in backend folder)
2. Check if "Connected" shows in Device panel
3. Check if green dot appears (even if not pulsing)

**Solutions**:
- Restart backend server
- Disconnect and reconnect to CNC
- Hard refresh browser (`Ctrl + Shift + R`)
- Check backend terminal for errors

### Issue: Logs Show But Position Is Zero

**Symptoms**: Console shows:
```
[Position Update] Work: {x: 0, y: 0, z: 0}
```

**Diagnosis**: Machine hasn't moved OR work coordinate offset equals machine position.

**Solutions**:
1. **Try jogging** - Click any jog button to move the machine
2. **Check backend logs** - Look for GRBL status reports like:
   ```
   <Idle|MPos:0.000,0.000,0.000|WPos:0.000,0.000,0.000|...>
   ```
3. **Send manual status query** - In Console tab, type `?` and press Enter
4. **Home the machine** - This sets a known position reference

### Issue: Work Position Updates But Machine Position Doesn't

**Symptoms**: 
- Work Position shows changing values
- Machine Position stays at 0.000

**Diagnosis**: GRBL is only sending `WPos` (work position), not `MPos` (machine position).

**Technical Details**:
- GRBL reports either `MPos` or `WPos` (not both) to save bandwidth
- Also sends `WCO` (Work Coordinate Offset) periodically
- Backend should calculate: `MPos = WPos + WCO`

**Solutions**:
1. Wait 10-30 seconds - GRBL sends `WCO` every 30 status reports
2. Check backend `GrblRunner.js` is calculating `MPos` from `WPos + WCO`
3. Check if backend logs show `WCO` values

### Issue: Logs Show Position But DRO Doesn't Update

**Symptoms**:
- Console logs show position changes
- DRO still displays 0.000

**Diagnosis**: React component not re-rendering OR wrong tab selected.

**Solutions**:
1. **Check you're on "Position (DRO)" tab** in Device panel
2. **Try clicking between tabs** to force re-render
3. **Inspect element** on the position values:
   ```
   Right-click position value → Inspect
   ```
   Check if the HTML shows correct values but CSS is hiding them
4. **Check Zustand DevTools** (if installed):
   ```
   Redux DevTools → Zustand → Check position and machinePosition values
   ```

### Issue: Green Indicator Doesn't Pulse

**Symptoms**: Indicator is gray, not pulsing.

**Diagnosis**: No position updates received in last 1 second.

**Solutions**:
1. Check backend is sending status queries (should see `TX ?` in logs every 250ms)
2. Check GRBL is responding (should see `RX <Idle|...>` in logs)
3. Check Socket.IO connection (green indicator in Device panel header)
4. Try disconnecting/reconnecting

---

## Files Modified

### 1. `frontend/src/stores/cncStore.ts`
- Added debug logging to `setPosition()`
- Added debug logging to `setMachinePosition()`
- Ensured new object references with `{ ...position }` spread

### 2. `frontend/src/utils/backendConnection.ts`
- Added console log when work position update received
- Added console log when machine position update received

### 3. `frontend/src/components/DevicePanel.tsx`
- Added `lastPositionUpdate` state to track last update time
- Added `useEffect` to update when position changes
- Added visual status indicator in DRO header
- Added `wcs-selector-wrapper` div for better layout

### 4. `frontend/src/components/DevicePanel.css`
- Added `.dro-status` styles
- Added `.status-indicator` styles
- Added `.status-indicator.active` with pulse animation
- Added `@keyframes pulse-indicator`
- Added `.wcs-selector-wrapper` styles

### 5. `frontend/src/components/Sidebar.tsx`
- Added `handleDiagonalJog()` function
- Updated diagonal jog button handlers

---

## Expected Behavior

### When Connected & Idle:
- ✅ Green indicator pulsing in DRO header
- ✅ Console logs every 250ms showing position
- ✅ Position values may be 0.000 (if not moved yet)

### When Jogging:
- ✅ Green indicator continues pulsing
- ✅ Console logs show changing position values
- ✅ DRO updates in real-time
- ✅ Both Work and Machine positions update

### When Disconnected:
- ❌ Gray indicator (not pulsing)
- ❌ No console logs
- ❌ Position values frozen at last known position

---

## Next Steps

1. **Test the changes**:
   - Refresh browser
   - Connect to CNC
   - Check console logs
   - Try jogging

2. **If working**:
   - ✅ Position updates working correctly
   - ❌ Remove console.log statements (clean up debug code)
   - ✅ Keep visual indicator (useful feedback)

3. **If not working**:
   - Share console logs (screenshot or copy/paste)
   - Share backend terminal output
   - Check which logs appear and which don't
   - Follow troubleshooting guide above

---

## Technical Flow

```
┌─────────────────────────────────────────────────────────────┐
│  1. GRBL sends status report every 250ms                    │
│     <Idle|MPos:10,5,0|WPos:0,0,0|...>                       │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  2. Backend (GrblRunner) parses status report               │
│     - Extracts MPos, WPos, WCO                              │
│     - Calculates missing values                             │
│     - Emits 'status' event                                  │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  3. Backend (CNCEngine) forwards via Socket.IO              │
│     io.emit('controller:state', type, { status })           │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  4. Frontend (backendConnection.ts) receives event          │
│     LOG: [Position Update] Work: {...}                      │
│     LOG: [Position Update] Machine: {...}                   │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  5. Zustand Store updates                                   │
│     LOG: [Store] Setting work position: {...}               │
│     LOG: [Store] Setting machine position: {...}            │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  6. React Components re-render                              │
│     - DevicePanel shows updated DRO values                  │
│     - Green indicator pulses                                │
│     - lastPositionUpdate timestamp updates                  │
└─────────────────────────────────────────────────────────────┘
```

---

## Console Commands for Debugging

### Check Store State
```javascript
// In browser console
const store = window.__zustand_store__;
console.log('Work Position:', store.getState().position);
console.log('Machine Position:', store.getState().machinePosition);
```

### Manual Status Query
```
? (in app Console tab)
```

### Watch Position Updates Live
```javascript
// In browser console - watch for 10 seconds
let count = 0;
const interval = setInterval(() => {
    const state = window.__zustand_store__.getState();
    console.log(`Update ${count++}:`, state.position, state.machinePosition);
    if (count >= 40) clearInterval(interval); // Stop after 10 seconds (250ms × 40)
}, 250);
```

---

## Contact & Support

If position still not updating after following this guide:

1. **Share console logs** (F12 → Console tab → screenshot or copy all)
2. **Share backend logs** (terminal running `npm start` → last 50 lines)
3. **Describe what you see**:
   - Is green indicator pulsing?
   - What do console logs show?
   - Does position change when jogging?
   - Are position values all zero or do they change?

4. **Check created debug documents**:
   - `DIAGONAL_JOG_FIX.md` - Diagonal jogging details
   - `POSITION_DEBUG_GUIDE.md` - Position debugging details (this file)
