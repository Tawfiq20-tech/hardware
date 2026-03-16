/**
 * Connection - Manages connection lifecycle and firmware detection.
 *
 * Wraps SerialConnection to provide:
 *   - Automatic firmware detection (Grbl vs GrblHAL vs FluidNC)
 *   - Socket.io client management (multiple UI clients per connection)
 *   - Connection state tracking
 *   - Debug logging of serial traffic
 *   - Fallback to default firmware after timeout
 *
 * Modeled after gSender's Connection.js (GPLv3, Sienci Labs Inc.)
 * @see https://github.com/Sienci-Labs/gsender/blob/master/src/server/lib/Connection.js
 */
const { EventEmitter } = require('events');
const { SerialConnection } = require('./SerialConnection');
const logger = require('../logger');

const FIRMWARE_GRBL = 'Grbl';
const FIRMWARE_GRBLHAL = 'GrblHAL';
const FIRMWARE_FLUIDNC = 'FluidNC';
const FIRMWARE_RTS = 'RTS';
const FIRMWARE_GENERIC = 'Generic'; // [GENERIC MODE] Unknown/proprietary firmware

const FIRMWARE_DETECT_INTERVAL = 1500;
const FIRMWARE_DETECT_MAX_ATTEMPTS = 6;

class Connection extends EventEmitter {
    /**
     * @param {object} options
     * @param {string} options.path - Serial port path or IP address
     * @param {number} [options.baudRate=115200]
     * @param {boolean} [options.network=false]
     * @param {string} [options.defaultFirmware='Grbl'] - Fallback firmware if detection fails
     * @param {Function} [options.writeFilter] - Optional write filter
     */
    constructor(options = {}) {
        super();

        this.path = options.path;
        this.baudRate = options.baudRate || 115200;
        this.network = options.network || false;
        this.rtscts = options.rtscts || false;
        // [GENERIC MODE] Default to Generic instead of Grbl when detection fails
        this.defaultFirmware = options.defaultFirmware || FIRMWARE_GENERIC;

        /** @type {Object.<string, object>} Connected Socket.io clients keyed by socket id */
        this.sockets = {};

        /** @type {object|null} Active controller instance (GrblController or GrblHalController) */
        this.controller = null;

        /** @type {string|null} Detected controller type */
        this.controllerType = null;

        /** @type {SerialConnection|null} */
        this.connection = null;

        /** @type {boolean} Whether the connection is currently open */
        this.isOpen = false;

        /** @type {boolean} Whether firmware has been detected */
        this.firmwareDetected = false;

        // Firmware detection state
        this._detectTimer = null;
        this._detectAttempts = 0;
        this._dataBuffer = [];

        // Write filter
        this._writeFilter = options.writeFilter || null;
    }

    /**
     * Open the connection and begin firmware detection.
     * @param {Function} [callback] - Error-first callback
     */
    open(callback) {
        if (this.isOpen) {
            const err = new Error('Connection is already open');
            if (callback) callback(err);
            return;
        }

        try {
            this.connection = new SerialConnection({
                path: this.path,
                baudRate: this.baudRate,
                network: this.network,
                rtscts: this.rtscts,
                writeFilter: this._writeFilter,
            });
        } catch (err) {
            if (callback) callback(err);
            return;
        }

        // Wire up serial events
        this.connection.on('data', (data) => this._onData(data));
        this.connection.on('open', () => this._onOpen());
        this.connection.on('close', (err) => this._onClose(err));
        this.connection.on('error', (err) => this._onError(err));

        this.connection.open((err) => {
            if (err) {
                this.connection = null;
                if (callback) callback(err);
                return;
            }
            if (callback) callback(null);
        });
    }

    /**
     * Close the connection and clean up.
     * @param {Error} [err] - Optional error that caused the close
     */
    close(err) {
        this._stopFirmwareDetection();

        if (this.connection) {
            try {
                this.connection.close(() => {});
            } catch (_) {
                // Ignore close errors during cleanup
            }
            this.connection = null;
        }

        this.isOpen = false;
        this.firmwareDetected = false;
        this.controllerType = null;
        this._dataBuffer = [];

        this.emit('close', err);
    }

    /**
     * Register a Socket.io client with this connection.
     * @param {object} socket - Socket.io socket instance
     */
    addConnection(socket) {
        if (!socket || !socket.id) return;
        this.sockets[socket.id] = socket;
        logger.info(`Socket ${socket.id} added to connection ${this.path}`);
    }

    /**
     * Remove a Socket.io client from this connection.
     * @param {object} socket - Socket.io socket instance
     */
    removeConnection(socket) {
        if (!socket || !socket.id) return;
        delete this.sockets[socket.id];
        logger.info(`Socket ${socket.id} removed from connection ${this.path}`);
    }

    /**
     * Write data through the connection (with write filter applied).
     * @param {string|Buffer} data - Data to send
     * @param {object} [context] - Optional context for the write filter
     */
    write(data, context) {
        if (!this.connection || !this.connection.isOpen) return;
        this.connection.write(data, context);
        this.emit('write', data, context);
    }

    /**
     * Write a line to the connection (appends newline).
     * Skips newline for realtime commands (single-byte commands like ?, !, ~).
     * @param {string} data - Data to send
     * @param {object} [context] - Optional context for the write filter
     */
    writeln(data, context) {
        if (!this.connection || !this.connection.isOpen) return;

        // Realtime commands are single bytes that should not get a newline
        const isRealtime = data.length === 1 && (
            data === '?' ||
            data === '!' ||
            data === '~' ||
            data.charCodeAt(0) === 0x18 ||
            data.charCodeAt(0) === 0x85
        );

        if (isRealtime) {
            this.connection.writeImmediate(data);
        } else {
            this.connection.write(data + '\n', context);
        }
        this.emit('write', data, context);
    }

    /**
     * Write data immediately, bypassing write filter.
     * Used for realtime GRBL commands.
     * @param {string|Buffer} data
     */
    writeImmediate(data) {
        if (!this.connection || !this.connection.isOpen) return;
        this.connection.writeImmediate(data);
    }

    /**
     * Broadcast an event to all connected Socket.io clients.
     * @param {string} eventName
     * @param {...*} args
     */
    emitToSockets(eventName, ...args) {
        Object.values(this.sockets).forEach((socket) => {
            try {
                socket.emit(eventName, ...args);
            } catch (_) {
                // Ignore emit errors on stale sockets
            }
        });
    }

    /**
     * Get the number of connected Socket.io clients.
     * @returns {number}
     */
    get socketCount() {
        return Object.keys(this.sockets).length;
    }

    // ─── Internal Event Handlers ─────────────────────────────────────

    _onOpen() {
        this.isOpen = true;
        this.emit('open');
        logger.info(`Connection opened: ${this.path} (${this.network ? 'network' : 'serial'})`);

        // Begin firmware detection
        logger.info(`Connection ready on ${this.path} — baudRate: ${this.baudRate}, rtscts: ${this.rtscts}, network: ${this.network}`);
        this._startFirmwareDetection();
    }

    _onClose(err) {
        this.isOpen = false;
        this._stopFirmwareDetection();
        this.emit('close', err);
        logger.info(`Connection closed: ${this.path}`);
    }

    _onError(err) {
        logger.error(`Connection error on ${this.path}: ${err?.message}`);
        this.emit('error', err);
    }

    _onData(data) {
        const line = typeof data === 'string' ? data.trim() : String(data).trim();
        if (!line) return;

        // [GENERIC MODE] Log ALL raw serial data at connection level
        logger.info(`[SERIAL RX] ${this.path}: ${line}`);

        this.emit('data', line);

        // Feed data to firmware detection if not yet detected
        if (!this.firmwareDetected) {
            this._dataBuffer.push(line);
            this._checkFirmware(line);
        }
    }

    // ─── Firmware Detection ──────────────────────────────────────────

    /**
     * Start the firmware detection sequence.
     * Sends $I command and polls for a response.
     * Falls back to defaultFirmware after max attempts.
     */
    _startFirmwareDetection() {
        this._detectAttempts = 0;
        this.firmwareDetected = false;
        this._dataBuffer = [];

        // Send initial probe command
        this._sendFirmwareProbe();

        // Set up retry interval
        this._detectTimer = setInterval(() => {
            this._detectAttempts++;

            if (this._detectAttempts >= FIRMWARE_DETECT_MAX_ATTEMPTS) {
                // [GENERIC MODE] Timeout — no known firmware detected, use raw serial mode
                this._stopFirmwareDetection();
                logger.warn(`GRBL/RTS startup message not detected on ${this.path} — switching to generic serial mode`);
                this._setFirmware(this.defaultFirmware);
                return;
            }

            // Retry with soft reset + probe
            this._sendFirmwareProbe();
        }, FIRMWARE_DETECT_INTERVAL);
    }

    /**
     * Send firmware detection probe commands.
     */
    _sendFirmwareProbe() {
        if (!this.connection || !this.connection.isOpen) return;

        const attempt = this._detectAttempts;

        if (attempt === 0) {
            // First attempt: wait for board to boot, then send both probes
            // RTS/Buildbotics boards need time after port opens
            setTimeout(() => {
                if (this.connection && this.connection.isOpen && !this.firmwareDetected) {
                    // Send Buildbotics dump command first (single char, most likely to get a response)
                    this.connection.write('D\n');
                }
            }, 300);
            setTimeout(() => {
                if (this.connection && this.connection.isOpen && !this.firmwareDetected) {
                    // Then GRBL build info
                    this.connection.write('$I\n');
                }
            }, 600);
        } else if (attempt <= 2) {
            // Attempts 1-2: Try Buildbotics commands (report, help)
            this.connection.write('D\n');
            setTimeout(() => {
                if (this.connection && this.connection.isOpen && !this.firmwareDetected) {
                    this.connection.write('r\n'); // Buildbotics report command
                }
            }, 200);
        } else if (attempt <= 4) {
            // Attempts 3-4: Try GRBL approach with soft reset
            this.connection.writeImmediate('\x18');
            setTimeout(() => {
                if (this.connection && this.connection.isOpen && !this.firmwareDetected) {
                    this.connection.write('$I\n');
                    this.connection.write('\n'); // Empty line to trigger any banner
                }
            }, 200);
        } else {
            // Last attempt: send newlines to trigger any welcome message
            this.connection.write('\n');
            this.connection.write('\n');
        }
    }

    /**
     * Check a line of data for firmware identification strings.
     * @param {string} line
     */
    _checkFirmware(line) {
        const lower = line.toLowerCase();

        // Log every line received during detection for debugging
        logger.info(`Firmware probe response on ${this.path}: ${line.substring(0, 200)}`);

        // Check for RTS/Buildbotics JSON protocol
        if (line.startsWith('{') && (lower.includes('"msgtype"') || lower.includes('"firmware"') || lower.includes('"variables"'))) {
            this._stopFirmwareDetection();
            this._setFirmware(FIRMWARE_RTS);
        } else if (line.startsWith('{') && (lower.includes('"parameter"') || lower.includes('"value"') || lower.includes('"state"'))) {
            // Additional Buildbotics JSON patterns
            this._stopFirmwareDetection();
            this._setFirmware(FIRMWARE_RTS);
        } else if (lower.includes('buildbotics') || lower.includes('gsd rts') || lower.includes('rts-1') || lower.includes('rts-2') || lower.includes('realtimecnc')) {
            this._stopFirmwareDetection();
            this._setFirmware(FIRMWARE_RTS);
        } else if (lower.includes('grblhal')) {
            this._stopFirmwareDetection();
            this._setFirmware(FIRMWARE_GRBLHAL);
        } else if (lower.includes('fluidnc')) {
            this._stopFirmwareDetection();
            this._setFirmware(FIRMWARE_FLUIDNC);
        } else if (lower.includes('grbl')) {
            this._stopFirmwareDetection();
            this._setFirmware(FIRMWARE_GRBL);
        }
    }

    /**
     * Set the detected firmware and emit event.
     * @param {string} firmware
     */
    _setFirmware(firmware) {
        this.controllerType = firmware;
        this.firmwareDetected = true;

        logger.info(`Firmware detected on ${this.path}: ${firmware}`);
        this.emit('firmwareDetected', firmware, this._dataBuffer);
    }

    /**
     * Stop firmware detection timer.
     */
    _stopFirmwareDetection() {
        if (this._detectTimer) {
            clearInterval(this._detectTimer);
            this._detectTimer = null;
        }
    }
}

module.exports = {
    Connection,
    FIRMWARE_GRBL,
    FIRMWARE_GRBLHAL,
    FIRMWARE_FLUIDNC,
    FIRMWARE_RTS,
    FIRMWARE_GENERIC,
};
