# RTS-1 Protocol Analysis — USB Capture Results

## 1. Device Identification

**STM32 CDC ACM Device CONFIRMED at Device Address 3**
- VID: 0x0483 (STMicroelectronics)
- PID: 0x5740 (Virtual COM Port)
- USB 2.0, CDC ACM class (class 0x02, subclass 0x02)
- Configuration descriptor: 2 interfaces, self-powered, 100mA max
- Endpoints: EP1 IN/OUT (Bulk, 64B max packet), EP2 IN (Interrupt, 8B, 16ms interval)
- Serial Number from board: **A425120400010012**

Other devices in capture:
- Device 1: VID=0x30C9, PID=0x0069 (webcam — isochronous traffic, irrelevant)
- Device 2: VID=0x13D3, PID=0x3567 (Bluetooth adapter, irrelevant)

## 2. Transfer Type Summary

| Type | Count | Notes |
|------|-------|-------|
| Bulk | 4,115 | Serial data — the protocol |
| Control | 1,494 | USB enumeration + CDC ACM setup |
| Isochronous | 12,120 | Webcam (Device 1), ignore |
| Interrupt | 4 | CDC ACM notification endpoint, no data |

**Bulk packets with data: 2,057** (out of 4,115 total — rest are empty URB completions)
- Host -> Device: 976 packets, 5,623 bytes total
- Device -> Host: 1,081 packets, 31,640 bytes total

## 3. CDC ACM Control Requests

The CDC ACM setup happens at ~16.48s:
- **GET_LINE_CODING** response (repeated 12 times): **9600 baud, 8N1**
- No SET_LINE_CODING seen — the baud rate is likely firmware-default or set before capture
- No SET_CONTROL_LINE_STATE seen (no DTR/RTS toggling captured)

Note: The baud rate (9600) is the CDC ACM virtual parameter — actual USB bulk transfers run at USB full-speed (12 Mbps). The 9600 is just a formality for the virtual COM port.

## 4. Protocol Frame Format

### Binary Framing

Every message follows this structure:
```
[0x01] [LENGTH] [COMMAND/TYPE] [PAYLOAD...] [0xFF]
```

- **Start byte**: Always `0x01`
- **Length byte**: Total message length (including start byte but excluding... or including all bytes — need to verify)
- **Command byte(s)**: Identifies the message type
- **Payload**: Variable length, can be binary (IEEE 754 floats) or JSON text
- **End byte**: Always `0xFF`

### Two Message Types

#### Type A: Binary Command/Status (small packets, 5-25 bytes)

Host -> Device commands:
```
01 05 00 XX ff          — 5-byte "get/query" command (XX = register/parameter ID)
01 06 00 XX YY ff       — 6-byte "set single byte"
01 09 00 XX YY YY YY YY ff   — 9-byte "set 32-bit value" or text command
01 0b 00 82 XX YY VV VV VV VV ff  — 11-byte "write register" (axis config)
01 19 00 20 VV VV VV VV VV VV VV VV VV VV VV VV VV VV VV VV ff  — 25-byte jog command
```

Device -> Host responses:
```
01 05 XX VV ff           — 5-byte status/value response
01 08 XX VV VV VV VV ff  — 8-byte register value response
01 1e b0 ... ff          — 30-byte position/status report (b0 = status poll response)
01 14 XX ... ff          — 20-byte extended status
```

#### Type B: JSON Messages (device -> host, prefixed with 0xA0)

All JSON messages from the device follow this pattern:
```
01 [LENGTH] a0 {"msgType":"...", ...} ff
```

The `0xA0` byte marks the start of a JSON payload. Message types observed:
- `{"msgType":"settings", "parameter":"...", "value":...}` — config readback
- `{"msgType":"offsets", "index":N, "value":[x,y,z,a]}` — work coordinate offsets

## 5. Initialization Sequence (Complete)

### Phase 1: USB Enumeration (t=0.000s)
1. GET_DESCRIPTOR (Device) -> VID=0x0483, PID=0x5740 confirmed
2. GET_DESCRIPTOR (Configuration) -> 2 interfaces, CDC ACM
3. SET_CONFIGURATION(1)

### Phase 2: CDC ACM Setup (t=16.48s, ~16.5s after enumeration)
- GET_LINE_CODING -> 9600,8,N,1 (repeated multiple times)
- First bulk transfer opens

### Phase 3: Initial Device Response (t=16.48s)
Device immediately sends unsolicited status:
```
01 05 c1 00 ff    — Status register C1 = 0x00 (idle/ready)
```
This is sent 3 times before the host responds.

### Phase 4: Host Sends Initial Command (t=16.58s)
```
01 05 00 09 ff    — Query register 0x09 (machine type/config?)
```

### Phase 5: Host Sends G-code Info Query (t=17.08s)
```
$I\n              — ASCII G-code "$I" command (GRBL info request!)
```
**This is significant** — the RTS-1 firmware supports at least some GRBL-compatible commands via ASCII.

### Phase 6: Host Queries Device Info (t=17.59s)
```
01 05 00 01 ff    — Query register 0x01
```
Response:
```
01 08 01 01 01 04 07 ff  — Firmware version? (1.1.1.4.7?)
```

### Phase 7: Bulk Configuration Write (t=17.60s)
Host sends a rapid burst of 11-byte register writes (command 0x82):

Register map observed:
| Reg | Sub | Description | Value Written |
|-----|-----|-------------|---------------|
| 0x17 | 0x00 | probe_speed | 1000.0 (float 0x447A0000) |
| 0x06 | 0x00 | probe_x | 54.0 (float 0x42580000) |
| 0x07 | 0x00 | probe_y | 54.0 (float 0x42580000) |
| 0x08 | 0x00 | probe_z | 15.0 (float 0x41700000) |
| 0x10 | 0x00 | ? | 0.0 |
| 0x0E | 0x00 | spindle_mode | 255 |
| 0x0F | 0x00 | ? | 0.0 |
| 0x14 | 0x00 | spindle_delay | 1000 (0x000003E8) |
| 0x15 | 0x00 | pwm_freq | 1000 |
| 0x03 | 0x00-0x03 | inverted[axis] | [1,1,1,0] |
| 0x0B | 0x00-0x03 | steps_per_mm[axis] | [125.0, 200.0, 200.0, 38.889] |
| 0x04 | 0x00-0x03 | max_velocity[axis] | [15240, 15240, 7620, 21600] |
| 0x05 | 0x00-0x03 | accel[axis] | [1800000, 1800000, 1800000, 750000] |
| 0x09 | 0x00-0x03 | home_offset[axis] | [0, 0, 0, varies] |
| 0x0A | 0x00-0x03 | jerk[axis] | [816, 816, 800, 720] |
| 0x0D | 0x00-0x03 | min_limit[axis] | [0, 0, 0, 0] |
| 0x16 | 0x00 | ? | 0 |

The device responds with JSON confirmations after batches of writes.

### Phase 8: Device Dumps Full Config (t=17.61s)
After the config write burst, the device sends back ALL settings as JSON:
- `probe_speed`: 1000.0
- `probe`: [54.000, 54.000, 15.000]
- `spindle_mode`: 255
- `spindle_delay`: 0
- `pwm_freq`: 1000
- `pwm_max`: 1000
- `inverted`: [1, 1, 1, 0]
- `steps`: [125.000, 200.000, 200.000, 38.889]
- `max_v`: [15240.000, 15240.000, 7620.000, 21600.000]
- `accel`: [1800000.000, 1800000.000, 1800000.000, 750000.000]
- `min_travel`: [0.000, 0.000, 0.000, -720.000]
- `max_travel`: [816.000, 816.000, 800.000, 720.000]
- `home_pos`: [0.000, 0.000, 0.000, 0.000]
- `axis_enable`: "0"
- `offsets` (indices 0-8): G54-G59 + extended work coordinate offsets
- `serial_num`: "A425120400010012"

### Phase 9: Status Polling Loop (t=17.63s+)
Host continuously polls with:
```
01 05 00 b0 ff    — Status request (register 0xB0)
```
~100ms interval. Device responds with 30-byte status report:
```
01 1e b0 [state] [flags] [X_pos_float] [Y_pos_float] [Z_pos_float] [A_pos_float] [?_float] [?_float] ff
```

Position values are IEEE 754 single-precision floats. Before jogging, the response is:
```
01 1e b0 01 00 [X=260.808] [Y=349.150] [Z=0.0] [A=0.0] [200.0] [200.0] ff
```
(0x43826D6D = 260.808, 0x43AE1333 = 349.150, etc.)

### Phase 10: G-code Mode Commands (t=18.39s)
```
01 05 00 05 ff         — Query something
01 05 00 03 ff         — Query state
01 09 00 40 3e 47 35 34 ff  — Set G54 coordinate system (ASCII ">G54" embedded)
01 09 00 40 3e 47 32 31 ff  — Set G21 (metric mode) (ASCII ">G21" embedded)
```

### Phase 11: Jogging (t=21.90s+)
25-byte jog commands:
```
01 19 00 20 [vel_x_f32] [vel_y_f32] [vel_z_f32] [vel_a_f32] ff
```

Example - jog X+Y+:
```
01 19 00 20 00 00 80 3f 00 00 80 3f 00 00 00 00 00 00 00 00 00 00 00 00 ff
```
- 0x3F800000 = 1.0 (normalized velocity in X)
- 0x3F800000 = 1.0 (normalized velocity in Y)
- Z and A = 0.0

Example - jog X+Y-:
```
01 19 00 20 00 00 80 3f 00 00 80 bf 00 00 00 00 00 00 00 00 00 00 00 00 ff
```
- 0xBF800000 = -1.0 (negative Y direction)

Bigger jog velocity example:
```
01 19 00 20 00 00 c8 42 00 00 c8 c2 00 00 00 00 00 00 00 00 00 00 00 00 ff
```
- 0x42C80000 = 100.0 (X velocity)
- 0xC2C80000 = -100.0 (Y velocity)

Also seen Z-only jog:
```
01 19 00 20 00 00 00 00 00 00 c8 42 00 00 00 00 00 00 00 00 00 00 00 00 ff
```
- Y = 100.0 (Z jog up? or is it the 2nd axis?)

Response to jog:
```
01 05 b3 01 ff   — Jog acknowledged, state=moving
01 05 a1 45 ff   — Motion complete?
01 05 b3 01 ff   — Back to moving state
```

## 6. Register Map (Decoded)

### Read Registers (01 05 00 XX ff)
| ID | Name | Response Format |
|----|------|-----------------|
| 0x01 | firmware_version | 8 bytes |
| 0x03 | state | 5 bytes |
| 0x05 | ? | 5 bytes |
| 0x08 | ? | 5 bytes |
| 0x09 | config_type | 5 bytes |
| 0xB0 | position_status | 30 bytes (primary poll) |
| 0xB2-B5 | input_states | 5-20 bytes |
| 0xBA | ? | 5 bytes |
| 0xBB | ? | 5 bytes |
| 0xBC | home_config | 8 bytes |
| 0xBE | ? | 5 bytes |
| 0xC1 | machine_state | 5 bytes (00=idle) |
| 0xD0-D4 | limit/io_state | 5-8 bytes |
| 0xD8 | temperature? | 20 bytes |

### Write Registers (01 0b 00 82 XX YY VV VV VV VV ff)
| XX | YY | Parameter | Value Type |
|----|----|-----------|------------|
| 0x03 | 0-3 | inverted[axis] | uint32 (0 or 1) |
| 0x04 | 0-3 | max_velocity[axis] | float32 |
| 0x05 | 0-3 | accel[axis] | float32 |
| 0x06 | 0 | probe_x | float32 |
| 0x07 | 0 | probe_y | float32 |
| 0x08 | 0 | probe_z | float32 |
| 0x09 | 0-3 | home_offset[axis] | float32 |
| 0x0A | 0-3 | jerk[axis] | float32 |
| 0x0B | 0-3 | steps_per_mm[axis] | float32 |
| 0x0D | 0-3 | min_limit[axis] | float32 |
| 0x0E | 0 | spindle_mode | uint32 |
| 0x0F | 0 | ? | float32 |
| 0x10 | 0 | ? | float32 |
| 0x14 | 0 | spindle_delay | uint32 |
| 0x15 | 0 | pwm_freq | uint32 |
| 0x16 | 0 | ? | uint32 |
| 0x17 | 0 | probe_speed | float32 |

### Commands
| Format | Description |
|--------|-------------|
| 01 19 00 20 [4xF32] [4 zero bytes] ff | Jog (4-axis velocity vector) |
| 01 09 00 40 3e [ASCII] ff | G-code mode set (">G54", ">G21") |
| 01 09 00 52/77 ... ff | Set parameter by ID |
| $I\n | GRBL info query (raw ASCII, no framing!) |

## 7. Machine Configuration (from capture)

This is a **Onefinity CNC** (likely Woodworker or Machinist model):
- 4 axes: X, Y, Z, A (rotary)
- Steps/mm: X=125, Y=200, Z=200, A=38.889
- Max velocity (mm/min): X=15240, Y=15240, Z=7620, A=21600
- Acceleration: X/Y/Z=1800000 mm/min^2, A=750000
- Travel: X=0-816mm, Y=0-816mm, Z=0-800mm, A=-720 to +720 degrees
- Axis inversion: X=inverted, Y=inverted, Z=inverted, A=normal
- Spindle: PWM mode (freq=1000Hz, max=1000)
- Probe dimensions: 54x54x15mm
- Serial: A425120400010012

## 8. Key Findings

1. **The protocol is NOT GRBL** — it's a proprietary binary protocol with JSON response messages, built on USB CDC ACM. However, it does accept at least some GRBL ASCII commands (`$I`).

2. **Frame format is simple**: `01 [len] [cmd] [data...] ff` — easy to implement.

3. **Status polling** is the primary feedback mechanism — the host polls `0xB0` at ~10Hz and gets back position + state in a 30-byte binary packet with IEEE 754 floats.

4. **JSON responses** from the device are rich and self-documenting — they include parameter names as strings.

5. **Jogging** uses normalized velocity vectors (float32 per axis), making it straightforward to implement directional jogging.

6. **The register map** uses a 2-byte addressing scheme: [register_group][axis_index], which cleanly maps 4-axis configurations.

7. **The firmware is essentially a Buildbotics/Onefinity derivative** — the JSON message structure and parameter names match the Onefinity/Buildbotics open-source controller firmware.
