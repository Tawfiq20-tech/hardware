/**
 * RTSController - RealtimeCNC RTS-1 binary protocol controller.
 *
 * Implements the real binary protocol reverse-engineered from USB captures:
 *   Frame format: 0x01 [length] [command] [payload...] 0xFF
 *   - Status polling at ~10Hz via register 0xB0
 *   - Positions as IEEE 754 LE floats in 30-byte status frames
 *   - JSON config messages prefixed with 0xA0
 *   - Jog commands as 25-byte frames with 4-axis velocity vectors
 *   - G-code mode via framed ASCII (01 09 00 40 3e [ASCII] FF)
 *   - Raw GRBL commands ($I, $H) as unframed ASCII
 *
 * Protocol reference: RTS1_PROTOCOL_ANALYSIS.md
 */
const { EventEmitter } = require('events');
const logger = require('../../logger');

// ─── Protocol Constants ────────────────────────────────────────────────────

const FRAME_START = 0x01;
const FRAME_END = 0xFF;

// Command bytes (host -> device)
const CMD_QUERY = 0x00;       // Query register: 01 05 00 XX FF
const CMD_JOG = 0x20;         // Jog: 01 19 00 20 [4xF32] [4 zeros] FF
const CMD_GCODE_MODE = 0x40;  // G-code mode: 01 09 00 40 3E [ASCII] FF
const CMD_WRITE_REG = 0x82;   // Write register: 01 0B 00 82 XX YY VV VV VV VV FF

// Response type bytes (device -> host)
const RESP_FIRMWARE = 0x01;   // Firmware version response
const RESP_STATUS = 0xB0;     // 30-byte position/status report
const RESP_JOG_ACK = 0xB3;   // Jog acknowledged
const RESP_JSON = 0xA0;       // JSON config message
const RESP_STATE = 0xC1;      // Machine state (00=idle, 01=moving)
const RESP_MOTION = 0xA1;     // Motion complete

// Register IDs for queries
const REG_FIRMWARE = 0x01;
const REG_STATE = 0x03;
const REG_CONFIG_TYPE = 0x09;
const REG_STATUS = 0xB0;
const REG_MACHINE_STATE = 0xC1;

// Write register IDs
const WREG_INVERTED = 0x03;
const WREG_MAX_VELOCITY = 0x04;
const WREG_ACCEL = 0x05;
const WREG_PROBE_X = 0x06;
const WREG_PROBE_Y = 0x07;
const WREG_PROBE_Z = 0x08;
const WREG_HOME_OFFSET = 0x09;
const WREG_JERK = 0x0A;
const WREG_STEPS_PER_MM = 0x0B;
const WREG_MIN_LIMIT = 0x0D;
const WREG_SPINDLE_MODE = 0x0E;
const WREG_SPINDLE_DELAY = 0x14;
const WREG_PWM_FREQ = 0x15;
const WREG_PROBE_SPEED = 0x17;

// Machine state byte values from C1 response
const MACHINE_STATE = {
    0x00: 'Idle',
    0x01: 'Run',
    0x02: 'Hold',
    0x03: 'Home',
    0x04: 'Alarm',
    0x05: 'Jog',
};

// Status polling interval (10Hz = 100ms)
const STATUS_POLL_INTERVAL = 100;

// Initialization timeout
const INIT_TIMEOUT = 5000;

// ─── Controller ────────────────────────────────────────────────────────────

class RTSController extends EventEmitter {
    constructor() {
        super();

        this.type = 'RTS';

        /** @type {import('../Connection').Connection|null} */
        this.connection = null;

        /** @type {Buffer} Incoming raw byte buffer for frame parsing */
        this._rxBuffer = Buffer.alloc(0);

        /** @type {boolean} Whether we have completed initialization */
        this._initialized = false;

        /** @type {NodeJS.Timeout|null} Status polling timer */
        this._pollTimer = null;

        /** @type {NodeJS.Timeout|null} Init timeout timer */
        this._initTimer = null;

        /** @type {NodeJS.Timeout|null} Jog stop timer for step jogs */
        this._jogStopTimer = null;

        /** @type {boolean} Whether we received the initial idle message */
        this._gotIdleMsg = false;

        // ─── Machine State ──────────────────────────────────────────

        /** @type {string} Current machine state for UI */
        this._activeState = 'Idle';

        /** @type {object} Machine positions (from B0 status) */
        this._mpos = { x: 0, y: 0, z: 0, a: 0 };

        /** @type {object} Work positions (calculated from mpos - wco) */
        this._wpos = { x: 0, y: 0, z: 0, a: 0 };

        /** @type {object} Work coordinate offsets */
        this._wco = { x: 0, y: 0, z: 0, a: 0 };

        /** @type {number} Status flags byte from B0 response */
        this._statusFlags = 0;

        /** @type {number} State byte from B0 response */
        this._stateByte = 0;

        /** @type {object} Feed/rapid/spindle overrides */
        this._overrides = { feed: 100, rapid: 100, spindle: 100 };

        /** @type {number} Current feedrate */
        this._feedrate = 0;

        /** @type {number} Current spindle speed */
        this._spindleSpeed = 0;

        /** @type {string} Spindle direction M-code */
        this._spindleDir = 'M5';

        // ─── Firmware / Config ──────────────────────────────────────

        /** @type {string} Firmware version string */
        this._firmwareVersion = '';

        /** @type {object} Board settings (from JSON config dump) */
        this._settings = {};

        /** @type {Array} Work coordinate offset table (G54-G59+) */
        this._offsets = [];

        /** @type {string} Board serial number */
        this._serialNumber = '';

        // ─── G-code Sender State ────────────────────────────────────

        /** @type {string[]} Loaded G-code lines */
        this._gcodeLines = [];

        /** @type {number} Current line index */
        this._gcodeIndex = 0;

        /** @type {boolean} Whether a job is running */
        this._running = false;

        /** @type {boolean} Whether the job is paused */
        this._paused = false;

        /** @type {number} Job start timestamp */
        this._jobStartTime = 0;

        // ─── State object for CNCEngine compatibility ───────────────

        this.state = {
            status: {},
            parserstate: {
                modal: {
                    motion: 'G0',
                    wcs: 'G54',
                    plane: 'G17',
                    units: 'G21',
                    distance: 'G90',
                    feedrate: 'G94',
                    program: 'M0',
                    spindle: 'M5',
                    coolant: 'M9',
                },
                tool: 0,
                feedrate: 0,
                spindle: 0,
            },
        };
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Connection Binding
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Bind to a Connection instance.
     * @param {import('../Connection').Connection} connection
     */
    bind(connection) {
        this.connection = connection;

        // Listen for raw binary data
        connection.on('rawData', (buf) => this._onRawData(buf));

        // Also listen for text data (for GRBL responses like $I)
        connection.on('data', (data) => {
            // In raw mode, 'data' events carry Buffers, not strings
            // Only handle string data here (text-mode fallback)
            if (typeof data === 'string') {
                this._onTextData(data);
            }
        });

        connection.on('close', () => {
            this._activeState = 'Alarm';
            this._stopPolling();
            this._clearInitTimer();
            this.emit('close');
        });

        connection.on('error', (err) => {
            logger.error('RTS connection error', { message: err?.message });
            this.emit('error', { message: err?.message });
        });

        // Start initialization sequence
        this._startInit();
    }

    /**
     * Unbind from the connection.
     */
    unbind() {
        this._stopPolling();
        this._clearInitTimer();
        if (this._jogStopTimer) {
            clearTimeout(this._jogStopTimer);
            this._jogStopTimer = null;
        }

        if (this.connection) {
            this.connection.removeAllListeners('rawData');
            this.connection.removeAllListeners('data');
            this.connection.removeAllListeners('close');
            this.connection.removeAllListeners('error');
        }

        this.connection = null;
        this._initialized = false;
        this._running = false;
        this._paused = false;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Initialization Sequence
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Start the initialization sequence.
     * Per the protocol analysis:
     *   1. Wait for board idle message (01 05 C1 00 FF)
     *   2. Query register 0x09
     *   3. Send $I (GRBL info)
     *   4. Query firmware version (register 0x01)
     *   5. Start status polling
     */
    _startInit() {
        this._initialized = false;
        this._gotIdleMsg = false;
        this._rxBuffer = Buffer.alloc(0);

        logger.info('[RTS] Starting initialization sequence');

        // Send initial queries after a short delay (board may need time)
        setTimeout(() => {
            if (!this.connection) return;

            // Query register 0x09 (machine config)
            this._sendQueryFrame(REG_CONFIG_TYPE);

            // Send $I for GRBL info (raw ASCII, no framing)
            this._writeAscii('$I\n');

            // Query firmware version
            setTimeout(() => {
                if (!this.connection) return;
                this._sendQueryFrame(REG_FIRMWARE);
            }, 200);
        }, 500);

        // Set init timeout - if we don't get a response, start polling anyway
        this._initTimer = setTimeout(() => {
            if (!this._initialized) {
                logger.warn('[RTS] Init timeout - starting polling without full init');
                this._completeInit();
            }
        }, INIT_TIMEOUT);
    }

    /**
     * Complete initialization and start status polling.
     */
    _completeInit() {
        if (this._initialized) return;
        this._initialized = true;
        this._clearInitTimer();

        logger.info(`[RTS] Initialization complete - firmware: ${this._firmwareVersion || 'unknown'}`);

        // Update state
        this._updateStateObject();

        // Emit initialized event
        this.emit('initialized', {
            firmwareType: 'RTS',
            firmwareVersion: this._firmwareVersion || 'unknown',
        });

        // Emit initial state
        this.emit('state', this.getState());
        this.emit('status', this.state.status);

        // Start 10Hz status polling
        this._startPolling();
    }

    _clearInitTimer() {
        if (this._initTimer) {
            clearTimeout(this._initTimer);
            this._initTimer = null;
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Raw Data Handling & Frame Parser
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Handle incoming raw binary data from the serial port.
     * Buffers bytes and extracts complete frames.
     * @param {Buffer} data
     */
    _onRawData(data) {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
        this._rxBuffer = Buffer.concat([this._rxBuffer, buf]);

        // Extract all complete frames from the buffer
        this._parseFrames();
    }

    /**
     * Handle text data (for GRBL ASCII responses).
     * @param {string} line
     */
    _onTextData(line) {
        const trimmed = line.trim();
        if (!trimmed) return;

        this.emit('console', trimmed);

        // GRBL responses
        if (trimmed.startsWith('[VER:') || trimmed.startsWith('[OPT:')) {
            logger.info(`[RTS] GRBL info: ${trimmed}`);
        } else if (trimmed.startsWith('ok')) {
            this._onAck();
        } else if (trimmed.startsWith('error:')) {
            this.emit('error', { message: trimmed });
        }
    }

    /**
     * Scan the receive buffer for complete binary frames.
     * Frame format: 0x01 [length] [payload...] 0xFF
     * Length byte = total frame size including 0x01 and 0xFF.
     */
    _parseFrames() {
        while (this._rxBuffer.length >= 3) {
            // Find start byte
            const startIdx = this._rxBuffer.indexOf(FRAME_START);
            if (startIdx === -1) {
                // No start byte found - discard buffer
                this._rxBuffer = Buffer.alloc(0);
                return;
            }

            // Discard bytes before start
            if (startIdx > 0) {
                // Check if discarded bytes contain ASCII text (GRBL responses)
                const discarded = this._rxBuffer.slice(0, startIdx);
                this._tryParseAscii(discarded);
                this._rxBuffer = this._rxBuffer.slice(startIdx);
            }

            // Need at least 2 bytes for start + length
            if (this._rxBuffer.length < 2) return;

            const frameLen = this._rxBuffer[1];

            // Sanity check on length
            if (frameLen < 3 || frameLen > 250) {
                // Invalid length - skip this start byte and try next
                this._rxBuffer = this._rxBuffer.slice(1);
                continue;
            }

            // Wait for complete frame
            if (this._rxBuffer.length < frameLen) return;

            // Verify end byte
            if (this._rxBuffer[frameLen - 1] !== FRAME_END) {
                // Bad frame - skip start byte
                logger.warn(`[RTS] Bad frame end byte at length ${frameLen}: 0x${this._rxBuffer[frameLen - 1].toString(16)}`);
                this._rxBuffer = this._rxBuffer.slice(1);
                continue;
            }

            // Extract complete frame
            const frame = this._rxBuffer.slice(0, frameLen);
            this._rxBuffer = this._rxBuffer.slice(frameLen);

            // Process the frame
            this._handleFrame(frame);
        }
    }

    /**
     * Try to parse discarded bytes as ASCII text (GRBL responses).
     * @param {Buffer} data
     */
    _tryParseAscii(data) {
        const text = data.toString('utf-8').trim();
        if (!text) return;

        // Split by newlines and process each line
        const lines = text.split('\n');
        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed) {
                this._onTextData(trimmed);
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Frame Handlers
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Dispatch a complete binary frame to the appropriate handler.
     * @param {Buffer} frame - Complete frame including 0x01 and 0xFF
     */
    _handleFrame(frame) {
        const len = frame[1];
        const cmdByte = frame[2];

        const frameHex = frame.toString('hex');
        logger.debug(`[RTS] Frame: ${frameHex} (cmd=0x${cmdByte.toString(16)}, len=${len})`);

        this.emit('console', `[RTS BIN] ${frameHex}`);

        switch (cmdByte) {
            case RESP_STATUS: // 0xB0 - Position/status report (30 bytes)
                this._handleStatusFrame(frame);
                break;

            case RESP_STATE: // 0xC1 - Machine state
                this._handleStateFrame(frame);
                break;

            case RESP_JSON: // 0xA0 - JSON config message
                this._handleJsonFrame(frame);
                break;

            case RESP_FIRMWARE: // 0x01 - Firmware version
                this._handleFirmwareFrame(frame);
                break;

            case RESP_JOG_ACK: // 0xB3 - Jog acknowledged
                this._handleJogAck(frame);
                break;

            case RESP_MOTION: // 0xA1 - Motion complete
                this._handleMotionComplete(frame);
                break;

            default:
                // Log unrecognized frames for protocol analysis
                logger.info(`[RTS] Unknown frame cmd=0x${cmdByte.toString(16)}: ${frameHex}`);
                break;
        }
    }

    /**
     * Parse 30-byte status frame (0xB0).
     * Format: 01 1E B0 [state] [flags] [X_f32] [Y_f32] [Z_f32] [A_f32] [?_f32] [?_f32] FF
     *
     * Offsets (0-indexed from frame start):
     *   [0]  = 0x01 (start)
     *   [1]  = 0x1E (30 = length)
     *   [2]  = 0xB0 (command)
     *   [3]  = state byte
     *   [4]  = flags byte
     *   [5-8]   = X position (float32 LE)
     *   [9-12]  = Y position (float32 LE)
     *   [13-16] = Z position (float32 LE)
     *   [17-20] = A position (float32 LE)
     *   [21-24] = unknown float (possibly feed rate or velocity)
     *   [25-28] = unknown float
     *   [29] = 0xFF (end)
     */
    _handleStatusFrame(frame) {
        if (frame.length < 30) {
            logger.warn(`[RTS] Short status frame: ${frame.length} bytes`);
            return;
        }

        const stateByte = frame[3];
        const flags = frame[4];

        // Read positions as IEEE 754 LE floats
        const x = frame.readFloatLE(5);
        const y = frame.readFloatLE(9);
        const z = frame.readFloatLE(13);
        const a = frame.readFloatLE(17);

        // Unknown floats (possibly velocity/feedrate)
        const unk1 = frame.readFloatLE(21);
        const unk2 = frame.readFloatLE(25);

        // Update state
        this._stateByte = stateByte;
        this._statusFlags = flags;

        // Map state byte to active state
        const prevState = this._activeState;
        this._activeState = MACHINE_STATE[stateByte] || 'Idle';

        // Update machine position
        this._mpos.x = this._roundPos(x);
        this._mpos.y = this._roundPos(y);
        this._mpos.z = this._roundPos(z);
        this._mpos.a = this._roundPos(a);

        // Calculate work position
        this._wpos.x = this._roundPos(x - this._wco.x);
        this._wpos.y = this._roundPos(y - this._wco.y);
        this._wpos.z = this._roundPos(z - this._wco.z);
        this._wpos.a = this._roundPos(a - this._wco.a);

        // Store unknown floats (may be useful later)
        this._feedrate = this._roundPos(unk1);

        // Update state object
        this._updateStateObject();

        // Emit events
        this.emit('status', this.state.status);
        this.emit('position', this.getPosition());

        if (prevState !== this._activeState) {
            this.emit('state', this.getState());

            // Emit alarm event when entering alarm state
            if (this._activeState === 'Alarm') {
                this.emit('alarm', { code: stateByte, message: 'Machine is in alarm state. Clear with Unlock ($X).' });
            }
        }

        // Complete init if not done yet (first status = board is alive)
        if (!this._initialized) {
            this._completeInit();
        }
    }

    /**
     * Parse machine state frame (0xC1).
     * Format: 01 05 C1 XX FF (XX: 00=idle, 01=moving, etc.)
     */
    _handleStateFrame(frame) {
        if (frame.length < 5) return;

        const stateVal = frame[3];
        const prevState = this._activeState;

        logger.info(`[RTS] Machine state: 0x${stateVal.toString(16)} (${MACHINE_STATE[stateVal] || 'unknown'})`);

        this._activeState = MACHINE_STATE[stateVal] || 'Idle';
        this._gotIdleMsg = true;

        if (prevState !== this._activeState) {
            this._updateStateObject();
            this.emit('state', this.getState());
            this.emit('status', this.state.status);

            if (this._activeState === 'Alarm') {
                this.emit('alarm', { code: stateVal, message: 'Machine is in alarm state. Clear with Unlock ($X).' });
            }
        }

        // If we get idle during init, it means the board is ready
        if (!this._initialized && stateVal === 0x00) {
            // Don't complete init yet - wait for firmware query response
            // But mark that we got the idle message
            logger.info('[RTS] Got initial idle message from board');
        }
    }

    /**
     * Parse JSON config frame (0xA0).
     * Format: 01 [len] A0 {"msgType":"...", ...} FF
     * The JSON text spans from byte 3 to byte (len-2).
     */
    _handleJsonFrame(frame) {
        try {
            // Extract JSON string between A0 byte and FF byte
            const jsonBytes = frame.slice(3, frame.length - 1);
            const jsonStr = jsonBytes.toString('utf-8');

            const msg = JSON.parse(jsonStr);
            logger.info(`[RTS] JSON: ${jsonStr.substring(0, 200)}`);

            this.emit('console', `[RTS JSON] ${JSON.stringify(msg)}`);

            if (msg.msgType === 'settings') {
                this._handleSettingMsg(msg);
            } else if (msg.msgType === 'offsets') {
                this._handleOffsetsMsg(msg);
            } else if (msg.msgType === 'fileCount' || msg.msgType === 'fileInfo') {
                this.emit('fileInfo', msg);
            } else {
                logger.info(`[RTS] Unknown JSON msgType: ${msg.msgType}`);
            }
        } catch (err) {
            logger.warn(`[RTS] JSON parse error: ${err.message}`);
        }
    }

    /**
     * Parse firmware version frame.
     * Format: 01 08 01 VV VV VV VV FF (version bytes)
     */
    _handleFirmwareFrame(frame) {
        if (frame.length < 5) return;

        // Extract version bytes (skip start, len, cmd byte)
        const versionBytes = [];
        for (let i = 3; i < frame.length - 1; i++) {
            versionBytes.push(frame[i]);
        }
        this._firmwareVersion = versionBytes.join('.');

        logger.info(`[RTS] Firmware version: ${this._firmwareVersion}`);

        // Complete init now that we have the firmware version
        if (!this._initialized) {
            // Start polling immediately, config will come later
            this._completeInit();
        }
    }

    /**
     * Handle jog acknowledge frame (0xB3).
     * Format: 01 05 B3 XX FF (XX: 01=moving)
     */
    _handleJogAck(frame) {
        if (frame.length < 5) return;
        const val = frame[3];
        logger.debug(`[RTS] Jog ack: state=0x${val.toString(16)}`);
        if (val === 0x01) {
            this._activeState = 'Jog';
            this._updateStateObject();
            this.emit('state', this.getState());
        }
    }

    /**
     * Handle motion complete frame (0xA1).
     */
    _handleMotionComplete(frame) {
        logger.debug(`[RTS] Motion complete: ${frame.toString('hex')}`);
        // Motion finished - state will update on next status poll
    }

    // ─── JSON Message Handlers ──────────────────────────────────────────

    /**
     * Handle a settings JSON message.
     * @param {object} msg - {msgType: "settings", parameter: "...", value: ...}
     */
    _handleSettingMsg(msg) {
        const param = msg.parameter;
        const value = msg.value;

        if (param === 'settings_end') {
            logger.info('[RTS] Settings dump complete');
            this.emit('settings', this._settings);
            return;
        }

        this._settings[param] = value;

        // Extract specific useful settings
        if (param === 'serial_num') {
            this._serialNumber = String(value);
        }

        // Emit individual setting for frontend
        this.emit('settings', { [param]: value });
    }

    /**
     * Handle work coordinate offset JSON message.
     * @param {object} msg - {msgType: "offsets", index: N, value: [x,y,z,a]}
     */
    _handleOffsetsMsg(msg) {
        if (msg.index !== undefined && Array.isArray(msg.value)) {
            const [x, y, z, a] = msg.value;
            this._offsets[msg.index] = { x, y, z, a };

            // If this is G54 (index 0), update the active WCO
            // (Default assumption - the board starts in G54)
            if (msg.index === 0) {
                this._wco = { x: x || 0, y: y || 0, z: z || 0, a: a || 0 };
            }

            this.emit('parameters', {
                type: `G${54 + msg.index}`,
                value: { x, y, z, a },
            });
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Binary Frame Builders
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Build and write a binary frame.
     * @param {Buffer|number[]} payload - Bytes between start/length and end byte
     * @returns {Buffer} The complete frame
     */
    _writeFrame(payload) {
        const payloadBuf = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
        // Total length = 1 (start) + 1 (length) + payload + 1 (end)
        const totalLen = payloadBuf.length + 3;
        const frame = Buffer.alloc(totalLen);

        frame[0] = FRAME_START;
        frame[1] = totalLen;
        payloadBuf.copy(frame, 2);
        frame[totalLen - 1] = FRAME_END;

        if (this.connection) {
            this.connection.writeRaw(frame);
            logger.debug(`[RTS TX] ${frame.toString('hex')}`);
        } else {
            logger.warn('[RTS] Cannot write frame - no connection');
        }

        return frame;
    }

    /**
     * Send a 5-byte query frame: 01 05 00 XX FF
     * @param {number} register - Register ID to query
     */
    _sendQueryFrame(register) {
        this._writeFrame(Buffer.from([CMD_QUERY, register]));
    }

    /**
     * Send a register write frame: 01 0B 00 82 XX YY VV VV VV VV FF
     * @param {number} register - Register to write
     * @param {number} axis - Axis index (0-3) or sub-register
     * @param {number} value - Value to write (float32 or uint32)
     * @param {boolean} [isFloat=true] - Whether value is float32 or uint32
     */
    _sendWriteRegister(register, axis, value, isFloat = true) {
        const payload = Buffer.alloc(8);
        payload[0] = CMD_QUERY;  // 0x00
        payload[1] = CMD_WRITE_REG; // 0x82
        payload[2] = register;
        payload[3] = axis;
        if (isFloat) {
            payload.writeFloatLE(value, 4);
        } else {
            payload.writeUInt32LE(value >>> 0, 4);
        }
        this._writeFrame(payload);
    }

    /**
     * Build a 25-byte jog frame.
     * Format: 01 19 00 20 [X_vel_f32] [Y_vel_f32] [Z_vel_f32] [A_vel_f32] [4_zero_bytes] FF
     * @param {number} vx - X velocity (-1.0 to 1.0 or higher for fast jog)
     * @param {number} vy - Y velocity
     * @param {number} vz - Z velocity
     * @param {number} va - A velocity
     */
    _sendJogFrame(vx, vy, vz, va) {
        const payload = Buffer.alloc(22); // 00 20 + 4*4 floats + 4 zero bytes = 22
        payload[0] = CMD_QUERY;  // 0x00
        payload[1] = CMD_JOG;   // 0x20
        payload.writeFloatLE(vx, 2);
        payload.writeFloatLE(vy, 6);
        payload.writeFloatLE(vz, 10);
        payload.writeFloatLE(va, 14);
        // Last 4 bytes are zeros (already from alloc)
        this._writeFrame(payload);
    }

    /**
     * Send a G-code mode command.
     * Format: 01 09 00 40 3E [ASCII bytes] FF
     * The 3E byte ('>') prefixes the G-code string.
     * @param {string} gcode - G-code string (e.g., "G54", "G21")
     */
    _sendGcodeMode(gcode) {
        const asciiBytes = Buffer.from(gcode, 'ascii');
        const payload = Buffer.alloc(3 + asciiBytes.length);
        payload[0] = CMD_QUERY;      // 0x00
        payload[1] = CMD_GCODE_MODE; // 0x40
        payload[2] = 0x3E;           // '>'
        asciiBytes.copy(payload, 3);
        this._writeFrame(payload);
    }

    /**
     * Write raw ASCII data (no binary framing).
     * Used for GRBL commands like $I, $H, etc.
     * @param {string} data
     */
    _writeAscii(data) {
        if (!this.connection) return;
        const buf = Buffer.from(data, 'ascii');
        this.connection.writeRaw(buf);
        logger.debug(`[RTS TX ASCII] ${data.trim()}`);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Status Polling
    // ═══════════════════════════════════════════════════════════════════════

    _startPolling() {
        this._stopPolling();
        this._pollTimer = setInterval(() => {
            this._sendQueryFrame(REG_STATUS);
        }, STATUS_POLL_INTERVAL);
        logger.info('[RTS] Status polling started at 10Hz');
    }

    _stopPolling() {
        if (this._pollTimer) {
            clearInterval(this._pollTimer);
            this._pollTimer = null;
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Public API (CNCEngine-compatible interface)
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Command dispatcher - same interface as GrblController.
     * @param {string} cmd - Command name
     * @param {...*} args - Command arguments
     */
    command(cmd, ...args) {
        const handler = this._commands[cmd];
        if (handler) {
            handler.call(this, ...args);
        } else {
            logger.warn(`[RTS] Unknown command: "${cmd}"`);
        }
    }

    get _commands() {
        return {
            // G-code streaming
            'gcode': (code) => this._sendGcode(code),
            'gcode:load': (name, gcode) => this._loadGcode(name, gcode),
            'gcode:start': () => this._startJob(0),
            'gcode:startFromLine': (line) => this._startJob(line),
            'gcode:pause': () => this._pauseJob(),
            'gcode:resume': () => this._resumeJob(),
            'gcode:stop': () => this._stopJob(),
            'gcode:unload': () => this._unloadGcode(),

            // Realtime commands
            'feedhold': () => this._feedHold(),
            'cyclestart': () => this._cycleStart(),
            'reset': () => this._softReset(),
            'jogcancel': () => this._jogCancel(),

            // Machine control
            'homing': () => this._home(),
            'unlock': () => this._unlock(),
            'jog': (params) => this._jog(params),
            'jog:safe': (params) => this._jog(params),

            // Info requests
            'settings': () => this._requestSettings(),
            'buildinfo': () => this._requestBuildInfo(),
            'statusreport': () => this._sendQueryFrame(REG_STATUS),

            // Raw data
            'raw': (data) => this._sendRaw(data),

            // Overrides
            'feedOverride:reset': () => { this._overrides.feed = 100; },
            'feedOverride:coarsePlus': () => { this._overrides.feed = Math.min(200, this._overrides.feed + 10); },
            'feedOverride:coarseMinus': () => { this._overrides.feed = Math.max(10, this._overrides.feed - 10); },
            'feedOverride:finePlus': () => { this._overrides.feed = Math.min(200, this._overrides.feed + 1); },
            'feedOverride:fineMinus': () => { this._overrides.feed = Math.max(10, this._overrides.feed - 1); },
            'spindleOverride:reset': () => { this._overrides.spindle = 100; },
            'spindleOverride:coarsePlus': () => { this._overrides.spindle = Math.min(200, this._overrides.spindle + 10); },
            'spindleOverride:coarseMinus': () => { this._overrides.spindle = Math.max(10, this._overrides.spindle - 10); },

            // E-stop
            'estop': () => this._estop(),
            'estop:clear': () => this._clearEstop(),

            // Macros
            'macro:run': (content) => this._sendGcode(content),

            // Triggers (no-op stubs)
            'trigger:set': () => {},
            'trigger:loadAll': () => {},

            // Debug (no-op stubs)
            'debug:enable': () => {},
            'debug:disable': () => {},
        };
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Motion Commands
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Send a jog command using the binary velocity jog protocol.
     * The frontend sends distance-based params (e.g. x=1 means move 1mm).
     * We convert to a velocity pulse: send velocity, wait for distance, send stop.
     *
     * Velocity = feedRate (mm/min) converted to the RTS velocity scale.
     * Duration = distance / velocity.
     *
     * @param {object} params - {x, y, z, a, feedRate}
     */
    _jog(params = {}) {
        const { x = 0, y = 0, z = 0, a = 0, feedRate = 1000 } = params;

        if (x === 0 && y === 0 && z === 0 && a === 0) return;

        // Cancel any pending jog stop timer
        if (this._jogStopTimer) {
            clearTimeout(this._jogStopTimer);
            this._jogStopTimer = null;
        }

        // Calculate the max distance requested across axes
        const maxDist = Math.max(Math.abs(x), Math.abs(y), Math.abs(z), Math.abs(a));
        if (maxDist === 0) return;

        // Jog velocity in mm/min (feedRate), convert to mm/s
        const velocityMmPerSec = feedRate / 60;

        // Duration to hold the jog (seconds) = distance / velocity
        const durationSec = maxDist / velocityMmPerSec;
        const durationMs = Math.max(20, Math.min(durationSec * 1000, 10000));

        // RTS velocity scale: the float values represent velocity in the board's
        // internal units. From captures, values around 50-200 are typical speeds.
        // Scale: feedRate mm/min maps to velocity value
        const scale = feedRate / 60; // mm/s as the velocity value

        // Direction vectors (normalized to -1/+1, scaled by velocity)
        const vx = x !== 0 ? Math.sign(x) * scale : 0;
        const vy = y !== 0 ? Math.sign(y) * scale : 0;
        const vz = z !== 0 ? Math.sign(z) * scale : 0;
        const va = a !== 0 ? Math.sign(a) * scale : 0;

        logger.info(`[RTS] Jog: dist=${maxDist}mm vel=${scale}mm/s dur=${durationMs.toFixed(0)}ms vx=${vx} vy=${vy} vz=${vz}`);

        // Send velocity jog frame
        this._sendJogFrame(vx, vy, vz, va);

        // Schedule stop after calculated duration
        this._jogStopTimer = setTimeout(() => {
            this._jogStopTimer = null;
            this._sendJogFrame(0, 0, 0, 0);
            logger.info('[RTS] Jog stop sent');
        }, durationMs);
    }

    /**
     * Cancel active jog (send zero velocity jog).
     */
    _jogCancel() {
        if (this._jogStopTimer) {
            clearTimeout(this._jogStopTimer);
            this._jogStopTimer = null;
        }
        this._sendJogFrame(0, 0, 0, 0);
    }

    /**
     * Home all axes.
     */
    _home() {
        this._writeAscii('$H\n');
        this._activeState = 'Home';
        this._updateStateObject();
        this.emit('state', this.getState());
    }

    /**
     * Unlock/clear alarm.
     */
    _unlock() {
        this._writeAscii('$X\n');
    }

    /**
     * Feed hold (pause motion).
     */
    _feedHold() {
        // Send zero-velocity jog to stop motion
        this._sendJogFrame(0, 0, 0, 0);
        this._activeState = 'Hold';
        this._updateStateObject();
        this.emit('state', this.getState());
    }

    /**
     * Resume motion (cycle start).
     */
    _cycleStart() {
        this._writeAscii('~');
    }

    /**
     * Soft reset.
     */
    _softReset() {
        this._writeAscii('\x18');
        this._running = false;
        this._paused = false;
    }

    /**
     * Emergency stop.
     */
    _estop() {
        this._writeAscii('\x18'); // Ctrl-X soft reset
        this._running = false;
        this._paused = false;
        this._activeState = 'Alarm';
        this._updateStateObject();
        this.emit('state', this.getState());
    }

    /**
     * Clear emergency stop.
     */
    _clearEstop() {
        this._writeAscii('$X\n');
    }

    // ═══════════════════════════════════════════════════════════════════════
    // G-code Sending
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Send a single G-code line or raw command.
     * @param {string} code
     */
    _sendGcode(code) {
        if (!code) return;
        const lines = code.split('\n').map(l => l.trim()).filter(Boolean);
        for (const line of lines) {
            // Check if it's a G-code mode command (G54, G21, etc.)
            if (/^G\d+/.test(line) && line.length <= 5) {
                this._sendGcodeMode(line);
            } else {
                // Send as raw ASCII with newline
                this._writeAscii(line + '\n');
            }
        }
    }

    /**
     * Send raw data.
     * @param {string|Buffer} data
     */
    _sendRaw(data) {
        if (Buffer.isBuffer(data)) {
            if (this.connection) this.connection.writeRaw(data);
        } else {
            this._writeAscii(String(data));
        }
    }

    /**
     * Load G-code for streaming.
     * @param {string} name
     * @param {string} gcode
     */
    _loadGcode(name, gcode) {
        this._gcodeLines = gcode.split('\n').map(l => l.trim()).filter(Boolean);
        this._gcodeIndex = 0;
        this._running = false;
        this._paused = false;
        this.emit('gcode:load', { name, total: this._gcodeLines.length });
    }

    /**
     * Unload G-code.
     */
    _unloadGcode() {
        this._gcodeLines = [];
        this._gcodeIndex = 0;
        this._running = false;
        this._paused = false;
    }

    /**
     * Start streaming loaded G-code.
     * @param {number} [fromLine=0]
     */
    _startJob(fromLine = 0) {
        if (this._gcodeLines.length === 0) return;
        this._gcodeIndex = fromLine || 0;
        this._running = true;
        this._paused = false;
        this._jobStartTime = Date.now();
        this.emit('sender:start');
        this._sendNextGcodeLine();
    }

    /**
     * Pause G-code streaming.
     */
    _pauseJob() {
        this._paused = true;
        this._feedHold();
        this.emit('sender:hold');
    }

    /**
     * Resume G-code streaming.
     */
    _resumeJob() {
        this._paused = false;
        this._cycleStart();
        this.emit('sender:unhold');
        this._sendNextGcodeLine();
    }

    /**
     * Stop G-code streaming.
     */
    _stopJob() {
        this._running = false;
        this._paused = false;
        this._jogCancel(); // Stop motion
        this.emit('sender:end');
    }

    /**
     * Send next G-code line.
     */
    _sendNextGcodeLine() {
        if (!this._running || this._paused) return;
        if (this._gcodeIndex >= this._gcodeLines.length) {
            this._running = false;
            this.emit('sender:end');
            return;
        }

        const line = this._gcodeLines[this._gcodeIndex];
        this._gcodeIndex++;
        this._sendGcode(line);

        const elapsed = Date.now() - this._jobStartTime;
        const rate = this._gcodeIndex / (elapsed / 1000);
        const remaining = ((this._gcodeLines.length - this._gcodeIndex) / rate) * 1000;

        this.emit('sender:status', {
            sent: this._gcodeIndex,
            total: this._gcodeLines.length,
            received: this._gcodeIndex - 1,
            startedAt: this._jobStartTime,
            elapsedTime: elapsed,
            remainingTime: remaining || 0,
        });
    }

    /**
     * Handle command acknowledgment - send next line.
     */
    _onAck() {
        if (this._running && !this._paused && this._gcodeIndex < this._gcodeLines.length) {
            this._sendNextGcodeLine();
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Info Requests
    // ═══════════════════════════════════════════════════════════════════════

    _requestSettings() {
        this._sendQueryFrame(REG_CONFIG_TYPE);
    }

    _requestBuildInfo() {
        this._writeAscii('$I\n');
        this._sendQueryFrame(REG_FIRMWARE);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Config Write Helpers
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Write a full machine configuration to the board.
     * @param {object} config - Machine configuration object
     */
    writeConfig(config) {
        if (!config) return;

        // Write axis-specific parameters
        const axisParams = [
            { reg: WREG_STEPS_PER_MM, key: 'steps' },
            { reg: WREG_MAX_VELOCITY, key: 'max_v' },
            { reg: WREG_ACCEL, key: 'accel' },
            { reg: WREG_JERK, key: 'jerk' },
            { reg: WREG_HOME_OFFSET, key: 'home_pos' },
            { reg: WREG_MIN_LIMIT, key: 'min_travel' },
            { reg: WREG_INVERTED, key: 'inverted', isFloat: false },
        ];

        for (const { reg, key, isFloat } of axisParams) {
            if (Array.isArray(config[key])) {
                for (let axis = 0; axis < Math.min(4, config[key].length); axis++) {
                    this._sendWriteRegister(reg, axis, config[key][axis], isFloat !== false);
                }
            }
        }

        // Write scalar parameters
        if (config.probe_speed !== undefined) {
            this._sendWriteRegister(WREG_PROBE_SPEED, 0, config.probe_speed);
        }
        if (config.probe && Array.isArray(config.probe)) {
            if (config.probe[0] !== undefined) this._sendWriteRegister(WREG_PROBE_X, 0, config.probe[0]);
            if (config.probe[1] !== undefined) this._sendWriteRegister(WREG_PROBE_Y, 0, config.probe[1]);
            if (config.probe[2] !== undefined) this._sendWriteRegister(WREG_PROBE_Z, 0, config.probe[2]);
        }
        if (config.spindle_mode !== undefined) {
            this._sendWriteRegister(WREG_SPINDLE_MODE, 0, config.spindle_mode, false);
        }
        if (config.spindle_delay !== undefined) {
            this._sendWriteRegister(WREG_SPINDLE_DELAY, 0, config.spindle_delay, false);
        }
        if (config.pwm_freq !== undefined) {
            this._sendWriteRegister(WREG_PWM_FREQ, 0, config.pwm_freq, false);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // State Accessors (CNCEngine-compatible)
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Update the state object that CNCEngine reads.
     */
    _updateStateObject() {
        this.state.status = {
            activeState: this._activeState,
            mpos: { ...this._mpos },
            wpos: { ...this._wpos },
            wco: { ...this._wco },
            feedrate: this._feedrate,
            spindle: this._spindleSpeed,
            spindleDirection: this._spindleDir,
            pinState: '',
            buf: { planner: 0, rx: 0 },
            ov: { ...this._overrides },
        };
    }

    getState() {
        this._updateStateObject();
        return this._activeState;
    }

    getMappedState() {
        const map = {
            'Idle': 'idle',
            'Run': 'run',
            'Hold': 'hold',
            'Home': 'home',
            'Alarm': 'alarm',
            'Jog': 'jog',
            'Check': 'check',
        };
        return map[this._activeState] || 'idle';
    }

    getPosition() {
        return { ...this._wpos };
    }

    getMachinePosition() {
        return { ...this._mpos };
    }

    getWorkflowState() {
        if (this._running && this._paused) return 'paused';
        if (this._running) return 'running';
        return 'idle';
    }

    getSenderStatus() {
        return {
            sent: this._gcodeIndex,
            total: this._gcodeLines.length,
            received: Math.max(0, this._gcodeIndex - 1),
            startedAt: this._jobStartTime,
            elapsedTime: this._running ? Date.now() - this._jobStartTime : 0,
            remainingTime: 0,
            name: '',
            size: 0,
            lines: this._gcodeLines.length,
        };
    }

    getFeederStatus() {
        return {
            hold: false,
            holdReason: null,
            queue: 0,
            pending: 0,
        };
    }

    getToolChangerStatus() {
        return {
            active: false,
            toolNumber: 0,
            state: 'idle',
        };
    }

    getOverrides() {
        return { ...this._overrides };
    }

    getHealthMetrics() {
        return {
            connected: !!this.connection,
            lastResponse: Date.now(),
            missedPolls: 0,
            reconnectAttempts: 0,
        };
    }

    getEventTriggers() {
        return {};
    }

    getSettings() {
        return this._settings;
    }

    getParserState() {
        return this.state.parserstate;
    }

    isInitialized() {
        return this._initialized;
    }

    isIdle() {
        return this._activeState === 'Idle';
    }

    /**
     * Write data to connection (CNCEngine compat).
     * @param {string} data
     * @param {object} [context]
     */
    write(data, context) {
        if (typeof data === 'string') {
            this._writeAscii(data);
        } else if (Buffer.isBuffer(data)) {
            this._sendRaw(data);
        }
    }

    /**
     * Write a line to connection (CNCEngine compat).
     * @param {string} data
     * @param {object} [context]
     */
    writeln(data, context) {
        if (typeof data === 'string') {
            this._writeAscii(data.endsWith('\n') ? data : data + '\n');
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Helpers
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Round a position value to 3 decimal places.
     * @param {number} val
     * @returns {number}
     */
    _roundPos(val) {
        if (!Number.isFinite(val)) return 0;
        return Math.round(val * 1000) / 1000;
    }

    /**
     * Clamp velocity to valid range.
     * @param {number} v
     * @returns {number}
     */
    _clampVelocity(v) {
        if (!Number.isFinite(v)) return 0;
        return Math.max(-10000, Math.min(10000, v));
    }

    /**
     * Stub for CNCEngine compatibility - debug monitor.
     */
    get debugMonitor() {
        return {
            getEntries: () => [],
            getStatus: () => ({ enabled: false, entries: 0 }),
        };
    }

    /**
     * Stub for CNCEngine compatibility - health monitor.
     */
    get healthMonitor() {
        return {
            recordPong: () => {},
            getMetrics: () => this.getHealthMetrics(),
        };
    }

    /**
     * Stub for CNCEngine compatibility - sender.
     */
    get sender() {
        return {
            total: this._gcodeLines.length,
            getStatus: () => this.getSenderStatus(),
        };
    }
}

module.exports = { RTSController };
