# Controller Initialization Improvements

## Changes Made

### 1. Enhanced Serial Connection (`serialConnection.ts`)
- Added proper soft reset with delay to trigger GRBL startup message
- Added new GRBL command methods: `getBuildInfo()`, `getWorkCoordinates()`, `getParserState()`, `feedHold()`, `cycleStart()`

### 2. Improved Initialization Sequence (`cncStore.ts`)
- **Automatic initialization detection** - detects GRBL/grblHAL startup messages
- **Firmware detection** - identifies controller type and version
- **Timeout handling** - 5-second timeout with fallback initialization
- **Progressive command sequence** - sends initialization commands with proper delays:
  - 500ms: `$I` (build info)
  - 1000ms: `$$` (settings)
  - 1500ms: `$#` (work coordinates)
  - 2000ms: `$G` (parser state)
  - 3000ms: `?` (status request as fallback)

### 3. Faster Response Times
- Reduced initialization detection delay from 2500ms to 1000ms
- Immediate initialization (500ms) for GRBL startup messages
- Reset initialization state on each connection attempt

### 4. Better Error Handling
- Handles controller errors with proper logging
- Timeout fallback ensures UI doesn't get stuck
- Graceful handling of missing responses

## How It Works

1. **Connection**: User clicks "Connect" → Serial port opens → Soft reset sent
2. **Detection**: Controller responds with startup message (e.g., "Grbl 1.1h")
3. **Initialization**: System sends configuration commands and waits for responses
4. **Completion**: Status changes from "INITIALIZING" to controller state (e.g., "IDLE")

## Expected Behavior

- **Fast initialization** (1-3 seconds for responsive controllers)
- **Automatic firmware detection** (GRBL vs grblHAL with version)
- **Timeout protection** (5 seconds max, then continues anyway)
- **Clear status indication** in the header

## Testing

1. Connect to your CNC controller
2. Watch the console for initialization messages
3. Header should show "INITIALIZING" then change to controller state
4. Firmware type and version should appear in header when connected

The "Waiting for controller initialization..." message should now resolve much faster!