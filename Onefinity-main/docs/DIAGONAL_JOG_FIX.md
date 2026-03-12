# Diagonal Jog Fix Summary

## Issues Fixed

### 1. ✅ Diagonal Jog Commands Now Send Correctly

**Problem**: When clicking diagonal directions on the jog pad, two separate jog commands were being sent (one for X, one for Y), instead of a single combined diagonal movement command.

**Root Cause**: The diagonal jog buttons were calling `handleJog()` twice:
```typescript
onClick={() => { handleJog('x', 1); handleJog('y', 1); }}
```

This resulted in two separate commands:
- `$J=G21 G91 X6 F3000`
- `$J=G21 G91 Y6 F3000`

Instead of the correct diagonal command:
- `$J=G21 G91 X6 Y6 F3000`

**Solution**: Created a new `handleDiagonalJog()` function that combines X and Y movements into a single jog command:

```typescript
const handleDiagonalJog = (xDir: 1 | -1, yDir: 1 | -1) => {
    if (!connected) return;
    const xDistance = jogDistance * xDir;
    const yDistance = jogDistance * yDir;
    backendJog(xDistance, yDistance, undefined, continuousJogFeedRate);
    addConsoleLog('info', `Jog X${xDir > 0 ? '+' : ''}${xDistance} Y${yDir > 0 ? '+' : ''}${yDistance}mm`);
};
```

Updated all diagonal jog buttons:
- **NE (North-East)**: `handleDiagonalJog(1, 1)` - X+, Y+
- **SE (South-East)**: `handleDiagonalJog(1, -1)` - X+, Y-
- **SW (South-West)**: `handleDiagonalJog(-1, -1)` - X-, Y-
- **NW (North-West)**: `handleDiagonalJog(-1, 1)` - X-, Y+

**Result**: Diagonal jog commands now send as single combined movements, which is more efficient and accurate.

---

### 2. 🔍 Added Position Update Debugging

**Problem**: Position display (DRO) not updating when jogging.

**Investigation**: The user reported seeing correct jog commands being transmitted:
```
[12:27:48.442] TX $J=G21 G91 X-6 Y-6 F3000
feeder $J=G21 G91 X-6 Y-6 F3000
```

This means:
- ✅ Jog commands are being sent correctly
- ✅ Backend is receiving them
- ✅ Commands are being queued to GRBL

**Potential Issue**: The position updates from GRBL status reports might not be reaching the frontend or updating the UI.

**Solution**: Added debug logging to track position updates:

```typescript
// In backendConnection.ts

// Work position updates
if (state.status.wpos) {
    const newPos = {
        x: state.status.wpos.x,
        y: state.status.wpos.y,
        z: state.status.wpos.z,
    };
    console.log('[Position Update] Work:', newPos);  // ← Debug log
    s.setPosition(newPos);
}

// Machine position updates
if (state.status?.mpos) {
    const newMachinePos = {
        x: state.status.mpos.x,
        y: state.status.mpos.y,
        z: state.status.mpos.z,
    };
    console.log('[Position Update] Machine:', newMachinePos);  // ← Debug log
    getStore().setMachinePosition(newMachinePos);
}
```

---

## How to Test

1. **Refresh the browser** with `Ctrl + Shift + R` to load the updated code

2. **Open browser console** (F12) to see debug logs

3. **Connect to your CNC** controller via COM port

4. **Click diagonal jog buttons** on the jog pad

5. **Check console logs**:
   - You should see `[Position Update] Work:` logs showing position changes
   - You should see `[Position Update] Machine:` logs showing machine position changes
   - These should update every 250ms (GRBL status poll interval)

6. **Watch the DRO (Digital Readout)**:
   - Work Position should update in real-time
   - Machine Position should update in real-time
   - The values should change as the machine moves

---

## Expected Behavior

### Diagonal Jogging:
✅ **Single command** sent for diagonal movement  
✅ **Smooth diagonal motion** instead of zigzag  
✅ **Correct G-code format**: `$J=G21 G91 X[distance] Y[distance] F[feedrate]`

### Position Display:
✅ **Real-time updates** every 250ms  
✅ **Work position** updates in the DRO  
✅ **Machine position** updates in the DRO  
✅ **Console logs** show position changes (for debugging)

---

## Troubleshooting

If position still not updating:

1. **Check browser console** for `[Position Update]` logs
   - If you see logs → Backend is sending updates, issue might be in UI rendering
   - If no logs → Backend might not be receiving status reports from GRBL

2. **Check backend logs** (terminal running `npm start`)
   - Look for `TX ?` (status query commands)
   - Look for status report responses from GRBL

3. **Check GRBL connection**:
   - Send manual command in Console tab: `?` (status query)
   - You should get back a status report like: `<Idle|WPos:0.000,0.000,0.000|...>`

4. **Verify DRO is visible**:
   - Go to "Device" tab in right panel
   - Click "Position (DRO)" tab
   - You should see Work Position and Machine Position displays

---

## Files Modified

1. **`frontend/src/components/Sidebar.tsx`**:
   - Added `handleDiagonalJog()` function
   - Updated all 4 diagonal jog button handlers

2. **`frontend/src/utils/backendConnection.ts`**:
   - Added debug logging for work position updates
   - Added debug logging for machine position updates

---

## Next Steps

Once you test and confirm:
- If position updates are working → Remove console.log debug statements
- If position updates still not working → Check backend GRBL status polling
- If only UI not updating → Check Zustand store updates and React re-renders
