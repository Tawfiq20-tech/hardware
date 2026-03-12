# GRBL-HAL Controller Initialization Fix

## Issues Fixed

### 1. **Missing GRBL Initialization Commands**
- ✅ Added proper initialization sequence in `GRBLController.js`
- ✅ Sends `$I`, `$$`, `$#`, `$N`, `$G` commands after connection
- ✅ Detects firmware type (GRBL vs GRBL-HAL) from startup messages
- ✅ Emits `initialized` event when controller is ready

### 2. **Missing Standard GRBL Commands**
Added all missing commands that gSender validation report identified:
- ✅ `feedHold()` - Send `!` (0x21) to pause motion
- ✅ `cycleStart()` - Send `~` (0x7E) to resume from hold
- ✅ `softReset()` - Send Ctrl-X (0x18) to reset
- ✅ `checkMode()` - Send `$C` for G-code validation
- ✅ `getHelp()` - Send `$` for help
- ✅ `getBuildInfo()` - Send `$I` for version/build info
- ✅ `getWorkCoordinates()` - Send `$#` for work offsets
- ✅ `getParserState()` - Send `$G` for current modal states
- ✅ `jogCancel()` - Send `\x85` to cancel jogging

### 3. **Frontend Integration**
- ✅ Added firmware type and version display in Header
- ✅ Added initialization status ("INITIALIZING" state)
- ✅ Added GRBL Commands tab in Sidebar with all command buttons
- ✅ Updated Socket.io listeners for initialization events
- ✅ Backend/Browser mode support for all commands

### 4. **Improved Initialization Flow**
```javascript
// Old flow (broken):
onSerialOpen() {
    this.send('\x18');  // Only soft reset
    setTimeout(() => this._startStatusPoll(), 500);
}

// New flow (fixed):
onSerialOpen() {
    this.isInitialized = false;
    this._awaitingInitialization = true;
    this.send('\x18');  // Soft reset
    
    setTimeout(() => {
        this.send('$I');    // Build info
        this.send('$$');    // All settings
        this.send('$#');    // Work coordinates
        this.send('$N');    // Startup lines
        this.send('$G');    // Parser state
        this._startStatusPoll();
        this.emit('initialized', { firmwareType, firmwareVersion });
    }, 1500);
}
```

## Files Modified

### Backend:
- `backend/services/GRBLController.js` - Added initialization sequence and missing commands
- `backend/socketHandlers.js` - Added socket handlers for new commands and initialization event

### Frontend:
- `frontend/src/stores/cncStore.ts` - Added firmware info, initialization state, and command methods
- `frontend/src/utils/backendConnection.ts` - Added backend functions for new commands
- `frontend/src/components/Header.tsx` - Added firmware display and initialization status
- `frontend/src/components/Header.css` - Added initializing status dot style
- `frontend/src/components/Sidebar.tsx` - Added Commands tab with GRBL command buttons
- `frontend/src/components/Sidebar.css` - Added styles for command buttons

## New Features

### 1. **Firmware Detection**
- Automatically detects GRBL vs GRBL-HAL from startup messages
- Displays firmware type and version in Header
- Stores firmware info in application state

### 2. **Initialization Status**
- Shows "INITIALIZING" status while controller starts up
- Animated status dot during initialization
- Console messages for initialization progress

### 3. **GRBL Commands Interface**
New "Commands" tab in Sidebar with buttons for:
- Feed Hold / Cycle Start (pause/resume)
- Soft Reset (controller reset)
- Jog Cancel (stop jogging)
- Check Mode (validate G-code)
- Build Info (get firmware version)
- Work Coordinates (get coordinate systems)
- Parser State (get modal states)

## Testing

To test the fixes:

1. **Start the application:**
   ```bash
   npm run dev:all
   ```

2. **Connect to GRBL-HAL controller:**
   - Use Device tab to connect
   - Watch for "INITIALIZING" status in Header
   - Should change to "IDLE" when ready
   - Firmware type should display in Header

3. **Test GRBL commands:**
   - Go to Sidebar → Commands tab
   - Try "Build Info" button to get firmware version
   - Try "Work Coordinates" to get coordinate systems
   - All commands should appear in Console

4. **Verify initialization:**
   - Console should show initialization messages
   - No more "Waiting for controller initialization..." 
   - No more Error:2 responses

## Expected Results

- ✅ Controller initializes properly
- ✅ Firmware type detected and displayed
- ✅ All standard GRBL commands available
- ✅ No HTTP headers sent to GRBL controller
- ✅ Proper GRBL communication protocol followed
- ✅ Compatible with both GRBL and GRBL-HAL controllers