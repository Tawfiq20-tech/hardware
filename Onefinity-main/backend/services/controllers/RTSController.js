/**
 * RTSController - RealtimeCNC RTS-1/RTS-2 controller support.
 *
 * Speaks the Buildbotics-derived protocol used by RealtimeCNC boards:
 *   - Sends single-letter commands + base64-encoded floats to the board
 *   - Receives JSON status messages from the board
 *   - G-code goes through the planner (line commands), not raw text
 *   - Uses USB CDC serial at 230400 baud with RTS/CTS flow control
 *
 * Protocol reference:
 *   - Buildbotics bbctrl-firmware (CERN-OHL-S v2)
 *   - RealtimeCNC RTS-X firmware strings analysis
 *
 * Board → Host messages:
 *   {"msgType":"settings","parameter":"<name>","value":<val>}
 *   {"msgType":"offsets","index":<n>,"value":[x,y,z,a]}
 *   {"msgType":"fileCount","Count":"<n>"}
 *   {"msgType":"fileInfo",...}
 *
 * Host → Board commands (Buildbotics Cmd protocol):
 *   D  = Dump all variables
 *   r  = Request status report
 *   E  = Emergency stop
 *   C  = Clear alarms
 *   h  = Help
 *   F  = Flush
 *   S  = Stop
 *   U  = Unpause/Resume
 *   P1 = Pause (program)
 *   j<id><axes> = Jog command
 *   $<name>=<value> = Set variable
 *   G-code lines for motion (processed by gcParserTask)
 */
const { EventEmitter } = require('events');
const logger = require('../../logger');

// Buildbotics command characters (keep in sync with Cmd.py)
const CMD = {
    SET:          '$',
    SET_SYNC:     '#',
    SEEK:         's',
    SET_AXIS:     'a',
    LINE:         'l',
    SPEED:        'p',
    INPUT:        'I',
    DWELL:        'd',
    PAUSE:        'P',
    STOP:         'S',
    UNPAUSE:      'U',
    JOG:          'j',
    REPORT:       'r',
    REBOOT:       'R',
    RESUME:       'c',
    ESTOP:        'E',
    SHUTDOWN:     'X',
    CLEAR:        'C',
    FLUSH:        'F',
    DUMP:         'D',
    HELP:         'h',
};

// RTS machine states (mapped from firmware task states)
const RTS_STATE = {
    READY:    'Ready',
    RUNNING:  'Running',
    HOLDING:  'Holding',
    HOMING:   'Homing',
    JOGGING:  'Jogging',
    PROBING:  'Probing',
    ESTOPPED: 'Estopped',
    ALARM:    'Alarm',
    OFFLINE:  'Offline',
};

// Map RTS states to GRBL-compatible states for the UI
const STATE_MAP = {
    [RTS_STATE.READY]:    'Idle',
    [RTS_STATE.RUNNING]:  'Run',
    [RTS_STATE.HOLDING]:  'Hold',
    [RTS_STATE.HOMING]:   'Home',
    [RTS_STATE.JOGGING]:  'Jog',
    [RTS_STATE.PROBING]:  'Run',
    [RTS_STATE.ESTOPPED]: 'Alarm',
    [RTS_STATE.ALARM]:    'Alarm',
    [RTS_STATE.OFFLINE]:  'Alarm',
};

/**
 * Encode a float as base64 (Buildbotics format).
 * 4-byte little-endian float → base64 → strip trailing '=='
 */
function encodeFloat(value) {
    const buf = Buffer.alloc(4);
    buf.writeFloatLE(value, 0);
    return buf.toString('base64').slice(0, -2); // Remove trailing ==
}

/**
 * Decode a base64-encoded float (Buildbotics format).
 */
function decodeFloat(str) {
    const buf = Buffer.from(str + '==', 'base64');
    return buf.readFloatLE(0);
}

/**
 * Encode axis values for jog/line commands.
 */
function encodeAxes(axes) {
    let data = '';
    for (const axis of ['x', 'y', 'z', 'a', 'b', 'c']) {
        const val = axes[axis] ?? axes[axis.toUpperCase()];
        if (val !== undefined && val !== null) {
            data += axis + encodeFloat(val);
        }
    }
    return data;
}

class RTSController extends EventEmitter {
    constructor() {
        super();

        this.type = 'RTS';
        this.connection = null;
        this._inBuf = '';
        this._jogId = 0;

        // Machine state
        this.state = {
            activeState: RTS_STATE.OFFLINE,
            mpos: { x: 0, y: 0, z: 0, a: 0 },
            wpos: { x: 0, y: 0, z: 0, a: 0 },
            wco: { x: 0, y: 0, z: 0, a: 0 },
            feedrate: 0,
            spindle: 0,
            spindleDirection: 'M5',
            pinState: '',
            buf: { planner: 0, rx: 0 },
            ov: { feed: 100, rapid: 100, spindle: 100 },
        };

        // Settings received from the board
        this.settings = {};
        this.settingsComplete = false;

        // Status polling
        this._pollTimer = null;
        this._initialized = false;

        // G-code sender state
        this._gcodeLines = [];
        this._gcodeIndex = 0;
        this._running = false;
        this._paused = false;
    }

    /**
     * Bind to a connection (serial port).
     */
    bind(connection) {
        this.connection = connection;

        connection.on('data', (data) => this._onData(data));
        connection.on('close', () => {
            this.state.activeState = RTS_STATE.OFFLINE;
            this._stopPolling();
            this.emit('close');
        });
        connection.on('error', (err) => {
            logger.error('RTS connection error', { message: err?.message });
        });
    }

    /**
     * Called when serial port opens — initialize communication.
     */
    onSerialOpen() {
        this._inBuf = '';
        this.state.activeState = RTS_STATE.OFFLINE;
        this.settingsComplete = false;
        this.settings = {};

        // Request full variable dump to initialize
        setTimeout(() => {
            this._write(CMD.DUMP);
            this._write(CMD.REPORT);
        }, 500);

        // Start status polling
        this._startPolling();
    }

    /**
     * Parse incoming serial data (JSON lines from the board).
     */
    _onData(data) {
        const str = typeof data === 'string' ? data : data.toString('utf-8');
        this._inBuf += str;

        let nlIdx;
        while ((nlIdx = this._inBuf.indexOf('\n')) !== -1) {
            const line = this._inBuf.substring(0, nlIdx).trim();
            this._inBuf = this._inBuf.substring(nlIdx + 1);

            if (!line) continue;

            this.emit('console', line);

            try {
                const msg = JSON.parse(line);
                this._handleMessage(msg);
            } catch (e) {
                // Not JSON — might be a plain text response
                this._handlePlainText(line);
            }
        }
    }

    /**
     * Handle a parsed JSON message from the board.
     */
    _handleMessage(msg) {
        // RTS-specific message format
        if (msg.msgType === 'settings') {
            this._handleSetting(msg);
            return;
        }

        if (msg.msgType === 'offsets') {
            this._handleOffsets(msg);
            return;
        }

        if (msg.msgType === 'fileCount' || msg.msgType === 'fileInfo') {
            this.emit('fileInfo', msg);
            return;
        }

        // Buildbotics-style messages
        if (msg.variables) {
            this._handleVariables(msg.variables);
            return;
        }

        if (msg.firmware) {
            logger.info('RTS firmware info', msg.firmware);
            this._initialized = true;
            this.state.activeState = RTS_STATE.READY;
            this.emit('initialized', {
                firmwareType: 'RTS',
                firmwareVersion: msg.firmware.version || 'unknown',
            });
            this.emit('state', this.getState());
            return;
        }

        if (msg.msg) {
            const level = msg.level || 'info';
            this.emit('console', `[${level}] ${msg.msg}`);
            if (level === 'error') {
                this.emit('error', { message: msg.msg });
            }
            return;
        }

        // Position/status updates (Buildbotics variable format)
        if (msg.xp !== undefined || msg.yp !== undefined || msg.zp !== undefined) {
            this._updatePosition(msg);
            return;
        }

        // State variable update
        if (msg.xx !== undefined) {
            this._updateMachineState(msg.xx);
        }
    }

    /**
     * Handle RTS settings message.
     */
    _handleSetting(msg) {
        const param = msg.parameter;
        const value = msg.value;

        if (param === 'settings_end') {
            this.settingsComplete = true;
            if (!this._initialized) {
                this._initialized = true;
                this.state.activeState = RTS_STATE.READY;
                this.emit('initialized', {
                    firmwareType: 'RTS',
                    firmwareVersion: this.settings.serial_num || 'unknown',
                });
                this.emit('state', this.getState());
            }
            this.emit('settings', this.settings);
            return;
        }

        this.settings[param] = value;

        // Extract useful info from settings
        if (param === 'steps' && Array.isArray(value)) {
            // Steps per mm for each axis
            this.settings._stepsPerMm = { x: value[0], y: value[1], z: value[2], a: value[3] };
        }
        if (param === 'max_v' && Array.isArray(value)) {
            this.settings._maxVelocity = { x: value[0], y: value[1], z: value[2], a: value[3] };
        }
    }

    /**
     * Handle work coordinate offsets.
     */
    _handleOffsets(msg) {
        if (msg.index !== undefined && Array.isArray(msg.value)) {
            const wcsIndex = msg.index; // 0=G54, 1=G55, etc.
            const [x, y, z, a] = msg.value;
            this.emit('parameters', {
                type: `G${54 + wcsIndex}`,
                value: { x, y, z, a },
            });
        }
    }

    /**
     * Handle Buildbotics-style variable updates.
     */
    _handleVariables(vars) {
        for (const [key, value] of Object.entries(vars)) {
            this._updateVariable(key, value);
        }
        this.emit('state', this.getState());
        this.emit('position', this.getPosition());
    }

    /**
     * Update a single state variable.
     */
    _updateVariable(key, value) {
        // Position variables (Buildbotics naming)
        if (key === 'xp') this.state.mpos.x = value;
        else if (key === 'yp') this.state.mpos.y = value;
        else if (key === 'zp') this.state.mpos.z = value;
        else if (key === 'ap') this.state.mpos.a = value;
        // Work position offsets
        else if (key === 'xo') this.state.wco.x = value;
        else if (key === 'yo') this.state.wco.y = value;
        else if (key === 'zo') this.state.wco.z = value;
        else if (key === 'ao') this.state.wco.a = value;
        // Feed rate and spindle
        else if (key === 'fr') this.state.feedrate = value;
        else if (key === 'ss') this.state.spindle = value;
        // Machine state
        else if (key === 'xx') this._updateMachineState(value);
        // Buffer state
        else if (key === 'qr') this.state.buf.planner = value;
        else if (key === 'rx') this.state.buf.rx = value;
        // Overrides
        else if (key === 'fo') this.state.ov.feed = value;
        else if (key === 'ro') this.state.ov.rapid = value;
        else if (key === 'so') this.state.ov.spindle = value;
        // Pin states
        else if (key === 'pi') this.state.pinState = value;

        // Calculate work position from machine position - offset
        this.state.wpos.x = this.state.mpos.x - this.state.wco.x;
        this.state.wpos.y = this.state.mpos.y - this.state.wco.y;
        this.state.wpos.z = this.state.mpos.z - this.state.wco.z;
        this.state.wpos.a = this.state.mpos.a - this.state.wco.a;
    }

    /**
     * Update position from a direct message.
     */
    _updatePosition(msg) {
        if (msg.xp !== undefined) this.state.mpos.x = msg.xp;
        if (msg.yp !== undefined) this.state.mpos.y = msg.yp;
        if (msg.zp !== undefined) this.state.mpos.z = msg.zp;
        if (msg.ap !== undefined) this.state.mpos.a = msg.ap;

        this.state.wpos.x = this.state.mpos.x - this.state.wco.x;
        this.state.wpos.y = this.state.mpos.y - this.state.wco.y;
        this.state.wpos.z = this.state.mpos.z - this.state.wco.z;
        this.state.wpos.a = this.state.mpos.a - this.state.wco.a;

        this.emit('position', this.getPosition());
    }

    /**
     * Update machine state from state code.
     */
    _updateMachineState(stateCode) {
        // Buildbotics state codes (from firmware)
        const stateMap = {
            'READY':    RTS_STATE.READY,
            'ESTOPPED': RTS_STATE.ESTOPPED,
            'RUNNING':  RTS_STATE.RUNNING,
            'HOLDING':  RTS_STATE.HOLDING,
            'HOMING':   RTS_STATE.HOMING,
            'JOGGING':  RTS_STATE.JOGGING,
            'STOPPING': RTS_STATE.HOLDING,
        };

        const newState = typeof stateCode === 'string'
            ? stateMap[stateCode.toUpperCase()] || stateCode
            : stateCode;

        if (newState !== this.state.activeState) {
            this.state.activeState = newState;
            this.emit('state', this.getState());
        }
    }

    /**
     * Handle plain text (non-JSON) response from the board.
     */
    _handlePlainText(line) {
        // Could be an error, ack, or G-code response
        if (line.startsWith('ok')) {
            this._onAck();
        } else if (line.startsWith('error')) {
            this.emit('error', { message: line });
        }
    }

    /**
     * Handle command acknowledgment.
     */
    _onAck() {
        // If running a G-code job, send next line
        if (this._running && !this._paused && this._gcodeIndex < this._gcodeLines.length) {
            this._sendNextGcodeLine();
        }
    }

    // ==================== Public API ====================

    getState() {
        const mapped = STATE_MAP[this.state.activeState] || 'Idle';
        return {
            status: {
                activeState: mapped,
                mpos: { ...this.state.mpos },
                wpos: { ...this.state.wpos },
                wco: { ...this.state.wco },
                feedrate: this.state.feedrate,
                spindle: this.state.spindle,
                spindleDirection: this.state.spindleDirection,
                pinState: this.state.pinState,
                buf: { ...this.state.buf },
                ov: { ...this.state.ov },
            },
        };
    }

    getPosition() {
        return {
            mpos: { ...this.state.mpos },
            wpos: { ...this.state.wpos },
        };
    }

    getMappedState() {
        return STATE_MAP[this.state.activeState] || 'Idle';
    }

    isIdle() {
        return this.state.activeState === RTS_STATE.READY;
    }

    // ==================== Commands ====================

    /**
     * Command dispatcher — same interface as GrblController.
     */
    command(cmd, ...args) {
        const handler = this._commands[cmd];
        if (handler) {
            handler(...args);
        } else {
            logger.warn(`RTSController: unknown command "${cmd}"`);
        }
    }

    get _commands() {
        return {
            // G-code streaming
            'gcode': (code) => this.sendGcode(code),
            'gcode:load': (name, gcode) => this.loadGcode(name, gcode),
            'gcode:start': () => this.startJob(0),
            'gcode:startFromLine': (line) => this.startJob(line),
            'gcode:pause': () => this.pauseJob(),
            'gcode:resume': () => this.resumeJob(),
            'gcode:stop': () => this.stopJob(),

            // Realtime commands
            'feedhold': () => this.feedHold(),
            'cyclestart': () => this.cycleStart(),
            'reset': () => this.softReset(),
            'jogcancel': () => this.jogCancel(),

            // Machine control
            'homing': () => this.home(),
            'unlock': () => this.unlock(),
            'jog': (params) => this.jog(params),
            'jog:safe': (params) => this.jog(params),

            // Info requests
            'settings': () => this.getSettings(),
            'buildinfo': () => this.getBuildInfo(),
            'statusreport': () => this.requestStatus(),

            // Overrides
            'feedOverride:reset': () => this._setOverride('fo', 100),
            'feedOverride:coarsePlus': () => this._adjustOverride('fo', 10),
            'feedOverride:coarseMinus': () => this._adjustOverride('fo', -10),
            'feedOverride:finePlus': () => this._adjustOverride('fo', 1),
            'feedOverride:fineMinus': () => this._adjustOverride('fo', -1),
            'spindleOverride:reset': () => this._setOverride('so', 100),
            'spindleOverride:coarsePlus': () => this._adjustOverride('so', 10),
            'spindleOverride:coarseMinus': () => this._adjustOverride('so', -10),

            // E-stop
            'estop': () => this.estop(),
            'estop:clear': () => this.clearEstop(),
        };
    }

    // ==================== Motion Commands ====================

    /**
     * Send a jog command using Buildbotics jog protocol.
     */
    jog(params = {}) {
        const { x, y, z, a, feedRate = 1000 } = params;
        const axes = {};
        if (x !== undefined && x !== 0) axes.x = x;
        if (y !== undefined && y !== 0) axes.y = y;
        if (z !== undefined && z !== 0) axes.z = z;
        if (a !== undefined && a !== 0) axes.a = a;

        if (Object.keys(axes).length === 0) return;

        // Buildbotics jog format: j<4-hex-id><base64-encoded-axes>
        this._jogId = (this._jogId + 1) & 0xFFFF;
        const id = this._jogId.toString(16).padStart(4, '0');
        const cmd = CMD.JOG + id + encodeAxes(axes);
        this._write(cmd);
    }

    /**
     * Cancel active jog.
     */
    jogCancel() {
        this._write(CMD.FLUSH);
    }

    /**
     * Home all axes.
     */
    home() {
        this.sendGcode('$H');
    }

    /**
     * Unlock/clear alarm.
     */
    unlock() {
        this._write(CMD.CLEAR);
    }

    /**
     * Feed hold (pause motion).
     */
    feedHold() {
        this._write(CMD.PAUSE + '1');
    }

    /**
     * Resume motion (cycle start).
     */
    cycleStart() {
        this._write(CMD.UNPAUSE);
    }

    /**
     * Soft reset.
     */
    softReset() {
        this._write(CMD.FLUSH);
        this._write(CMD.CLEAR);
    }

    /**
     * Emergency stop.
     */
    estop() {
        this._write(CMD.ESTOP);
        this.state.activeState = RTS_STATE.ESTOPPED;
        this.emit('state', this.getState());
    }

    /**
     * Clear emergency stop.
     */
    clearEstop() {
        this._write(CMD.CLEAR);
    }

    /**
     * Check mode (not supported on RTS, send as G-code).
     */
    checkMode() {
        this.sendGcode('$C');
    }

    // ==================== G-code Sending ====================

    /**
     * Send a single G-code line or raw command.
     */
    sendGcode(code) {
        if (!code) return;
        const lines = code.split('\n').map(l => l.trim()).filter(Boolean);
        for (const line of lines) {
            this._write(line);
        }
    }

    /**
     * Alias for sendGcode (used by CNCEngine).
     */
    send(data) {
        this.sendGcode(data);
    }

    /**
     * Load G-code for streaming.
     */
    loadGcode(name, gcode) {
        this._gcodeLines = gcode.split('\n').map(l => l.trim()).filter(Boolean);
        this._gcodeIndex = 0;
        this._running = false;
        this._paused = false;
        this.emit('gcode:load', { name, total: this._gcodeLines.length });
    }

    /**
     * Start streaming loaded G-code.
     */
    startJob(fromLine = 0) {
        if (this._gcodeLines.length === 0) return;
        this._gcodeIndex = fromLine || 0;
        this._running = true;
        this._paused = false;
        this.emit('sender:start');
        this._sendNextGcodeLine();
    }

    /**
     * Pause G-code streaming.
     */
    pauseJob() {
        this._paused = true;
        this.feedHold();
        this.emit('sender:hold');
    }

    /**
     * Resume G-code streaming.
     */
    resumeJob() {
        this._paused = false;
        this.cycleStart();
        this.emit('sender:unhold');
        this._sendNextGcodeLine();
    }

    /**
     * Stop G-code streaming.
     */
    stopJob() {
        this._running = false;
        this._paused = false;
        this._write(CMD.STOP);
        this._write(CMD.FLUSH);
        this.emit('sender:end');
    }

    /**
     * Send next G-code line in the job.
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
        this._write(line);

        // Emit progress
        this.emit('sender:status', {
            sent: this._gcodeIndex,
            total: this._gcodeLines.length,
            received: this._gcodeIndex - 1,
            startedAt: Date.now(),
            elapsedTime: 0,
            remainingTime: 0,
        });
    }

    // ==================== Info Requests ====================

    getSettings() {
        this._write(CMD.DUMP);
    }

    getBuildInfo() {
        this._write(CMD.HELP);
    }

    getParserState() {
        // Not directly supported in RTS protocol — request status instead
        this._write(CMD.REPORT);
    }

    getWorkCoordinates() {
        // Request a dump which includes offsets
        this._write(CMD.DUMP);
    }

    getHelp() {
        this._write(CMD.HELP);
    }

    requestStatus() {
        this._write(CMD.REPORT);
    }

    // ==================== Overrides ====================

    _setOverride(variable, value) {
        this._write(CMD.SET + `${variable}=${value}`);
    }

    _adjustOverride(variable, delta) {
        const current = variable === 'fo' ? this.state.ov.feed
            : variable === 'so' ? this.state.ov.spindle
            : this.state.ov.rapid;
        this._setOverride(variable, Math.max(10, Math.min(200, current + delta)));
    }

    // ==================== Internal ====================

    /**
     * Write data to the serial connection.
     */
    _write(data) {
        if (!this.connection) {
            logger.warn('RTSController: no connection');
            return;
        }

        const str = data.endsWith('\n') ? data : data + '\n';

        try {
            this.connection.write(str);
        } catch (err) {
            logger.error('RTSController: write error', { message: err?.message });
        }
    }

    /**
     * Start status polling.
     */
    _startPolling() {
        this._stopPolling();
        this._pollTimer = setInterval(() => {
            this._write(CMD.REPORT);
        }, 500);
    }

    /**
     * Stop status polling.
     */
    _stopPolling() {
        if (this._pollTimer) {
            clearInterval(this._pollTimer);
            this._pollTimer = null;
        }
    }
}

module.exports = { RTSController, RTS_STATE, CMD, encodeFloat, decodeFloat, encodeAxes };
