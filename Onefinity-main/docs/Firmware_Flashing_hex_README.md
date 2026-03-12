# Firmware Hex Files

Place your firmware `.hex` files in `backend/lib/Firmware/Flashing/hex/` for flashing.

## Supported Files

- `mk1_20220214.hex` - LongMill MK1 firmware
- `mk2_20220214.hex` - LongMill MK2 firmware
- `slb_orange.hex` - SuperLongBoard (SLB) firmware
- `grblsept15.hex` - Generic GRBL firmware

These files will be used by the firmware flashing system when you call:

```javascript
FirmwareFlashing.flash(port, 'MK1', options);
```

Or via REST API:

```bash
POST /api/firmware/flash
{
  "port": "/dev/ttyUSB0",
  "boardType": "MK1"
}
```

Or via Socket.IO:

```javascript
socket.emit('firmware:flash', { port, boardType }, callback);
```
