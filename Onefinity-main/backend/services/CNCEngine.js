/**
 * CNCEngine - Socket.IO server for real-time frontend communication.
 *
 * Manages:
 *   - Connection lifecycle (open/close serial/network ports)
 *   - Automatic firmware detection and controller instantiation
 *   - Multi-client Socket.IO broadcasting
 *   - Port enumeration
 *   - G-code file management
 *   - Command routing to active controller
 *
 * Reference: gSender CNCEngine.js (GPLv3, Sienci Labs Inc.)
 * @see https://github.com/Sienci-Labs/gsender/blob/master/src/server/services/cncengine/CNCEngine.js
 */
const path = require('path');
const { EventEmitter } = require('events');
const { Connection, FIRMWARE_GRBL, FIRMWARE_RTS, FIRMWARE_GENERIC } = require('./Connection');
const { SerialConnection } = require('./SerialConnection');
const { createController } = require('./controllers');
const { createSessionLogger } = require('./SessionLogger');
const { ConfigStore } = require('./ConfigStore');
const { isRotaryFile } = require('../lib/rotary');
const logger = require('../logger');

class CNCEngine extends EventEmitter {
    /**
     * @param {object} io - Socket.IO server instance
     */
    constructor(io) {
        super();

        this.io = io;

        /** @type {Connection|null} Active connection */
        this.connection = null;

        /** @type {import('./GRBLController').GrblController|null} Active controller */
        this.controller = null;

        /** @type {string|null} Active port/path */
        this.port = null;

        /** @type {object|null} Loaded G-code file info */
        this.loadedFile = null;

        /** @type {object|null} Session logger */
        this.sessionLogger = null;

        /** @type {ConfigStore} Persistent configuration */
        this.config = new ConfigStore(
            path.join(__dirname, '..', 'data', 'config.json')
        );

        this._setupSocketIO();
    }

    // ─── Socket.IO Setup ─────────────────────────────────────────────

    _setupSocketIO() {
        this.io.on('connection', (socket) => {
            logger.info(`Socket.IO client connected: ${socket.id}`);

            // Send current state to newly connected client
            this._sendInitialState(socket);

            // Register the socket with the active connection
            if (this.connection) {
                this.connection.addConnection(socket);
            }

            // ─── Port Management ─────────────────────────────────
            socket.on('list', (callback) => this._handleList(socket, callback));
            socket.on('open', (portPath, options, callback) => this._handleOpen(socket, portPath, options, callback));
            socket.on('close', (portPath, callback) => this._handleClose(socket, portPath, callback));

            // ─── Commands ────────────────────────────────────────
            socket.on('command', (portPath, cmd, ...args) => this._handleCommand(socket, portPath, cmd, ...args));
            socket.on('write', (portPath, data, context) => this._handleWrite(socket, portPath, data, context));
            socket.on('writeln', (portPath, data, context) => this._handleWriteln(socket, portPath, data, context));

            // [GENERIC MODE] Raw command passthrough — writes directly to serial port
            socket.on('command:raw', (cmd) => {
                if (this.connection && this.connection.isOpen) {
                    const data = String(cmd).endsWith('\n') ? String(cmd) : String(cmd) + '\n';
                    logger.info(`[RAW CMD] ${data.trim()}`);
                    this.connection.write(data);
                }
            });

            // ─── File Management ─────────────────────────────────
            socket.on('file:load', (data) => this._handleFileLoad(socket, data));
            socket.on('file:unload', () => this._handleFileUnload(socket));

            // ─── Macros ──────────────────────────────────────────
            socket.on('macro:list', (callback) => {
                const macros = this.config.getMacros();
                if (typeof callback === 'function') callback(null, macros);
                else socket.emit('macro:list', macros);
            });
            socket.on('macro:save', (macro, callback) => {
                this.config.saveMacro(macro);
                const macros = this.config.getMacros();
                this.io.emit('macro:list', macros);
                if (typeof callback === 'function') callback(null, macros);
            });
            socket.on('macro:delete', (id, callback) => {
                this.config.deleteMacro(id);
                const macros = this.config.getMacros();
                this.io.emit('macro:list', macros);
                if (typeof callback === 'function') callback(null, macros);
            });
            socket.on('macro:run', (id) => {
                const macro = this.config.getMacro(id);
                if (macro && this.controller) {
                    this.controller.command('macro:run', macro.content);
                }
            });

            // ─── Tool Library ────────────────────────────────────
            socket.on('tool:list', (callback) => {
                const tools = this.config.getTools();
                if (typeof callback === 'function') callback(null, tools);
                else socket.emit('tool:list', tools);
            });
            socket.on('tool:save', (tool, callback) => {
                this.config.saveTool(tool);
                const tools = this.config.getTools();
                this.io.emit('tool:list', tools);
                if (typeof callback === 'function') callback(null, tools);
            });
            socket.on('tool:delete', (id, callback) => {
                this.config.deleteTool(id);
                const tools = this.config.getTools();
                this.io.emit('tool:list', tools);
                if (typeof callback === 'function') callback(null, tools);
            });

            // ─── Event Triggers ──────────────────────────────────
            socket.on('trigger:list', (callback) => {
                if (this.controller) {
                    const triggers = this.controller.getEventTriggers();
                    if (typeof callback === 'function') callback(null, triggers);
                    else socket.emit('trigger:list', triggers);
                }
            });
            socket.on('trigger:set', (eventName, config) => {
                if (this.controller) {
                    this.controller.command('trigger:set', eventName, config);
                    this.config.set(`eventTriggers.${eventName}`, config);
                }
            });

            // ─── Config / Preferences ────────────────────────────
            socket.on('config:get', (key, callback) => {
                const value = this.config.get(key);
                if (typeof callback === 'function') callback(null, value);
            });
            socket.on('config:set', (key, value) => {
                this.config.set(key, value);
                this.io.emit('config:change', { key, value });
            });
            socket.on('config:getAll', (callback) => {
                if (typeof callback === 'function') callback(null, this.config.getAll());
            });

            // ─── Debug Monitor ───────────────────────────────────
            socket.on('debug:enable', () => {
                if (this.controller) this.controller.command('debug:enable');
            });
            socket.on('debug:disable', () => {
                if (this.controller) this.controller.command('debug:disable');
            });
            socket.on('debug:getEntries', (count, type, callback) => {
                if (this.controller) {
                    const entries = this.controller.debugMonitor.getEntries(count, type);
                    if (typeof callback === 'function') callback(null, entries);
                }
            });

            // ─── Health Check ────────────────────────────────────
            socket.on('hPing', () => {
                socket.emit('hPong');
                if (this.controller) {
                    this.controller.healthMonitor.recordPong();
                }
            });
            socket.on('health:metrics', (callback) => {
                if (this.controller) {
                    const metrics = this.controller.getHealthMetrics();
                    if (typeof callback === 'function') callback(null, metrics);
                    else socket.emit('health:metrics', metrics);
                }
            });

            // ─── Firmware Flashing ───────────────────────────────
            socket.on('firmware:flash', async (options, callback) => {
                const { port, boardType, hexPath } = options || {};
                try {
                    const FirmwareFlashing = require('../lib/Firmware/Flashing/firmwareflashing');
                    await FirmwareFlashing.flash(port, boardType, { hexPath, socket });
                    if (typeof callback === 'function') callback(null, { success: true });
                } catch (err) {
                    logger.error(err);
                    if (typeof callback === 'function') callback(err);
                    else socket.emit('flash:error', err.message);
                }
            });

            // ─── Cleanup ─────────────────────────────────────────
            socket.on('disconnect', () => {
                logger.info(`Socket.IO client disconnected: ${socket.id}`);
                if (this.connection) {
                    this.connection.removeConnection(socket);
                }
            });
        });
    }

    // ─── Initial State ───────────────────────────────────────────────

    _sendInitialState(socket) {
        // Send current connection state
        if (this.controller && this.connection && this.connection.isOpen) {
            socket.emit('serialport:open', {
                port: this.port,
                controllerType: this.connection.controllerType,
            });

            // Send current controller state
            const controllerState = {
                status: this.controller.state?.status || {},
                parserstate: this.controller.state?.parserstate || {},
            };
            socket.emit('controller:state', this.controller.type, controllerState);

            // Send workflow state (all controllers implement this)
            if (typeof this.controller.getWorkflowState === 'function') {
                socket.emit('workflow:state', this.controller.getWorkflowState());
            }

            // Send sender status
            if (typeof this.controller.getSenderStatus === 'function') {
                socket.emit('sender:status', this.controller.getSenderStatus());
            }

            // Send feeder status
            if (typeof this.controller.getFeederStatus === 'function') {
                socket.emit('feeder:status', this.controller.getFeederStatus());
            }

            // Send tool changer status
            if (typeof this.controller.getToolChangerStatus === 'function') {
                socket.emit('toolchanger:status', this.controller.getToolChangerStatus());
            }

            // Send loaded file info
            if (this.loadedFile) {
                socket.emit('file:load', this.loadedFile);
            }
        }

        // Always send config data (macros, tools, preferences)
        socket.emit('macro:list', this.config.getMacros());
        socket.emit('tool:list', this.config.getTools());
        socket.emit('config:all', this.config.getAll());
    }

    // ─── Port Listing ────────────────────────────────────────────────

    async _handleList(socket, callback) {
        try {
            const ports = await SerialConnection.listPorts();
            const portList = ports.map((p) => ({
                port: p.path,
                manufacturer: p.manufacturer || '',
                serialNumber: p.serialNumber || '',
                vendorId: p.vendorId || '',
                productId: p.productId || '',
                inuse: this.port === p.path,
            }));

            if (typeof callback === 'function') {
                callback(null, portList);
            }
            socket.emit('serialport:list', portList);
        } catch (err) {
            logger.error('Port listing error:', err);
            if (typeof callback === 'function') {
                callback(err);
            }
        }
    }

    // ─── Open Connection ─────────────────────────────────────────────

    async _handleOpen(socket, portPath, options, callback) {
        if (typeof options === 'function') {
            callback = options;
            options = {};
        }
        options = options || {};

        if (!portPath) {
            const err = new Error('Missing port path or IP address');
            if (typeof callback === 'function') callback(err);
            return;
        }

        // Close existing connection if any
        if (this.connection && this.connection.isOpen) {
            this._closeConnection();
        }

        const baudRate = options.baudRate || 115200;
        const network = options.network || false;
        const rtscts = options.rtscts || false;

        logger.info(`Opening connection: ${portPath} (baud: ${baudRate}, network: ${network}, rtscts: ${rtscts})`);

        // Create Connection (Layer 2)
        this.connection = new Connection({
            path: portPath,
            baudRate,
            network,
            rtscts,
        });
        this.port = portPath;

        // Register the requesting socket
        this.connection.addConnection(socket);

        // Listen for firmware detection
        this.connection.on('firmwareDetected', (firmware, dataBuffer) => {
            this._onFirmwareDetected(firmware, dataBuffer);
        });

        // Listen for connection events
        this.connection.on('error', (err) => {
            logger.error(`Connection error: ${err?.message}`);
            this.io.emit('serialport:error', { port: portPath, error: err?.message });
        });

        this.connection.on('close', () => {
            this._onConnectionClose();
        });

        // Open the connection
        this.connection.open((err) => {
            if (err) {
                logger.error(`Failed to open ${portPath}: ${err.message}`);
                this.connection = null;
                this.port = null;
                if (typeof callback === 'function') callback(err);
                socket.emit('serialport:error', { port: portPath, error: err.message });
                return;
            }

            // Start session logging
            if (this.sessionLogger) {
                this.sessionLogger.close();
            }
            this.sessionLogger = createSessionLogger(logger.sessionsDir, portPath);
            this.sessionLogger.logConnection(true, portPath);

            logger.info(`Connection opened: ${portPath}`);
            this.io.emit('serialport:open', { port: portPath });

            if (typeof callback === 'function') callback(null);
        });
    }

    // ─── Firmware Detection → Controller Instantiation ───────────────

    _onFirmwareDetected(firmware, dataBuffer) {
        logger.info(`Firmware detected: ${firmware}`);

        // For RTS firmware, switch the connection to rawMode if not already
        if (firmware === FIRMWARE_RTS && this.connection && !this.connection.rawMode) {
            logger.info('RTS firmware detected - reopening connection in raw binary mode');
            const connPath = this.connection.path;
            const connBaudRate = this.connection.baudRate;
            const connNetwork = this.connection.network;
            const connRtscts = this.connection.rtscts;
            const sockets = { ...this.connection.sockets };

            // Close existing connection
            this.connection.close();

            // Reopen in raw mode
            this.connection = new Connection({
                path: connPath,
                baudRate: connBaudRate,
                network: connNetwork,
                rtscts: connRtscts,
                rawMode: true,
            });

            // Re-register sockets
            for (const socket of Object.values(sockets)) {
                this.connection.addConnection(socket);
            }

            // Re-wire connection events
            this.connection.on('error', (err) => {
                logger.error(`Connection error: ${err?.message}`);
                this.io.emit('serialport:error', { port: connPath, error: err?.message });
            });
            this.connection.on('close', () => {
                this._onConnectionClose();
            });

            // Mark firmware as already detected so we don't re-detect
            this.connection.firmwareDetected = true;
            this.connection.controllerType = firmware;

            // Open the raw connection
            this.connection.open((err) => {
                if (err) {
                    logger.error(`Failed to reopen in raw mode: ${err.message}`);
                    return;
                }

                // Create and bind controller
                this.controller = createController(firmware);
                this.controller.bind(this.connection);
                this._wireControllerEvents();
                this.io.emit('controller:type', firmware);

                if (this.sessionLogger) {
                    this.sessionLogger.logConnection(true, `Firmware: ${firmware} (raw binary mode)`);
                }
            });
            return;
        }

        // Create the appropriate controller
        this.controller = createController(firmware);

        // Bind controller to connection
        this.controller.bind(this.connection);

        // Wire controller events to Socket.IO
        this._wireControllerEvents();

        // Notify all clients
        this.io.emit('controller:type', firmware);

        // [GENERIC MODE] GenericController has no runner — skip replay
        // [RTS] RTSController has no runner — skip replay
        // [GRBL ONLY] Replay buffered data through the GRBL runner
        if (this.controller.runner && typeof this.controller.runner.parse === 'function' && dataBuffer && dataBuffer.length > 0) {
            for (const line of dataBuffer) {
                this.controller.runner.parse(line);
            }
        }

        // Log
        if (this.sessionLogger) {
            this.sessionLogger.logConnection(true, `Firmware: ${firmware}`);
        }
    }

    // ─── Controller Event Wiring ─────────────────────────────────────

    _wireControllerEvents() {
        if (!this.controller) return;

        // Console output
        this.controller.on('console', (line) => {
            this.io.emit('serialport:read', line);
            if (this.sessionLogger) this.sessionLogger.logConsole(line);
        });

        // Status updates
        this.controller.on('status', (status) => {
            this.io.emit('controller:state', this.controller.type, {
                status,
                parserstate: this.controller.state.parserstate,
            });
            if (this.sessionLogger) {
                this.sessionLogger.logPosition(status.wpos || status.mpos);
            }
        });

        // Parser state
        this.controller.on('parserstate', (ps) => {
            this.io.emit('controller:state', this.controller.type, {
                status: this.controller.state.status,
                parserstate: ps,
            });
        });

        // Initialization
        this.controller.on('initialized', (info) => {
            this.io.emit('controller:initialized', info);
            if (this.sessionLogger) {
                this.sessionLogger.logConnection(true, `Initialized: ${info.firmwareType} ${info.firmwareVersion}`);
            }
        });

        // Workflow state changes
        this.controller.on('workflow:state', (state) => {
            this.io.emit('workflow:state', state);
            if (this.sessionLogger) this.sessionLogger.logState(state);
        });

        // Sender status
        this.controller.on('sender:status', (status) => {
            this.io.emit('sender:status', status);
        });

        this.controller.on('sender:start', (data) => {
            this.io.emit('sender:start', data);
            if (this.sessionLogger) this.sessionLogger.logJob({ event: 'started' });
        });

        this.controller.on('sender:end', (data) => {
            this.io.emit('sender:end', data);
            if (this.sessionLogger) this.sessionLogger.logJob({ event: 'completed', ...data });
        });

        this.controller.on('sender:error', (err) => {
            this.io.emit('sender:error', err);
            if (this.sessionLogger) this.sessionLogger.logJob({ event: 'error', ...err });
        });

        // Alarms and errors
        this.controller.on('alarm', (alarm) => {
            this.io.emit('controller:alarm', alarm);
        });

        this.controller.on('error', (err) => {
            this.io.emit('controller:error', err);
        });

        // Settings
        this.controller.on('settings', (setting) => {
            this.io.emit('controller:settings', setting);
        });

        // Feedback messages
        this.controller.on('feedback', (fb) => {
            this.io.emit('controller:feedback', fb);
        });

        // Parameters (probe results, work coordinates)
        this.controller.on('parameters', (params) => {
            this.io.emit('controller:parameters', params);
        });

        // ─── Feeder events ───────────────────────────────────
        this.controller.on('feeder:status', (status) => {
            this.io.emit('feeder:status', status);
        });

        // ─── Tool changer events ─────────────────────────────
        this.controller.on('toolchange:start', (data) => {
            this.io.emit('toolchange:start', data);
        });
        this.controller.on('toolchange:complete', (data) => {
            this.io.emit('toolchange:complete', data);
        });
        this.controller.on('toolchange:cancel', () => {
            this.io.emit('toolchange:cancel');
        });
        this.controller.on('toolchange:request', (data) => {
            this.io.emit('toolchange:request', data);
        });
        this.controller.on('toolchange:error', (data) => {
            this.io.emit('toolchange:error', data);
        });

        // ─── Event trigger events ────────────────────────────
        this.controller.on('eventtrigger:fired', (data) => {
            this.io.emit('eventtrigger:fired', data);
        });

        // ─── Debug monitor events ────────────────────────────
        this.controller.on('serial:debug:log', (entry) => {
            this.io.emit('serial:debug:log', entry);
        });

        // ─── Health monitor events ───────────────────────────
        this.controller.on('health:stale', (data) => {
            this.io.emit('health:stale', data);
        });
        this.controller.on('health:reconnect:attempt', (data) => {
            this.io.emit('health:reconnect:attempt', data);
        });
        this.controller.on('health:reconnect:success', () => {
            this.io.emit('health:reconnect:success');
        });
        this.controller.on('health:reconnect:failed', (data) => {
            this.io.emit('health:reconnect:failed', data);
        });

        // ─── Homing events ──────────────────────────────────
        this.controller.on('homing:location', (data) => {
            this.io.emit('homing:location', data);
        });
        this.controller.on('homing:limits', (data) => {
            this.io.emit('homing:limits', data);
        });

        // Close
        this.controller.on('close', () => {
            // Handled by _onConnectionClose
        });

        // Load saved event triggers into the controller
        const savedTriggers = this.config.get('eventTriggers', {});
        if (Object.keys(savedTriggers).length > 0) {
            this.controller.command('trigger:loadAll', savedTriggers);
        }
    }

    // ─── Close Connection ────────────────────────────────────────────

    _handleClose(socket, portPath, callback) {
        if (typeof portPath === 'function') {
            callback = portPath;
            portPath = this.port;
        }

        this._closeConnection();

        if (typeof callback === 'function') callback(null);
    }

    _closeConnection() {
        if (this.controller) {
            this.controller.unbind();
            this.controller.removeAllListeners();
            this.controller = null;
        }

        if (this.connection) {
            this.connection.close();
            this.connection = null;
        }

        const closedPort = this.port;
        this.port = null;

        if (this.sessionLogger) {
            this.sessionLogger.logConnection(false, 'disconnect');
            this.sessionLogger.close();
            this.sessionLogger = null;
        }

        if (closedPort) {
            this.io.emit('serialport:close', { port: closedPort });
        }
    }

    _onConnectionClose() {
        const closedPort = this.port;

        if (this.controller) {
            this.controller.unbind();
            this.controller.removeAllListeners();
            this.controller = null;
        }

        this.connection = null;
        this.port = null;

        if (this.sessionLogger) {
            this.sessionLogger.logConnection(false, 'disconnect');
            this.sessionLogger.close();
            this.sessionLogger = null;
        }

        if (closedPort) {
            logger.info(`Connection closed: ${closedPort}`);
            this.io.emit('serialport:close', { port: closedPort });
        }
    }

    // ─── Command Handling ────────────────────────────────────────────

    _handleCommand(socket, portPath, cmd, ...args) {
        if (!this.controller) {
            socket.emit('serialport:error', { error: 'No active controller' });
            return;
        }

        try {
            this.controller.command(cmd, ...args);
        } catch (err) {
            socket.emit('serialport:error', { error: err.message });
        }
    }

    _handleWrite(socket, portPath, data, context) {
        if (!this.controller) return;
        this.controller.write(data, context);
    }

    _handleWriteln(socket, portPath, data, context) {
        if (!this.controller) return;
        this.controller.writeln(data, context);
    }

    // ─── File Management ─────────────────────────────────────────────

    _handleFileLoad(socket, data) {
        if (!this.controller) {
            socket.emit('serialport:error', { error: 'No active controller' });
            return;
        }

        const { name, content, gcode } = data || {};
        const gcodeContent = content || gcode;

        if (!gcodeContent) {
            socket.emit('serialport:error', { error: 'Missing G-code content' });
            return;
        }

        const fileName = name || 'untitled.gcode';

        // Load into controller's sender
        this.controller.command('gcode:load', fileName, gcodeContent);

        // Store file info for reconnecting clients
        const senderTotal = this.controller.sender?.total || gcodeContent.split('\n').filter(l => l.trim()).length;
        this.loadedFile = {
            name: fileName,
            total: senderTotal,
            size: gcodeContent.length,
            isRotary: isRotaryFile(gcodeContent),
        };

        this.io.emit('file:load', this.loadedFile);

        if (this.sessionLogger) {
            this.sessionLogger.logJob({ event: 'loaded', name: fileName, total: this.controller.sender.total });
        }
    }

    _handleFileUnload(socket) {
        if (this.controller) {
            this.controller.command('gcode:unload');
        }
        this.loadedFile = null;
        this.io.emit('file:unload');
    }

    // ─── Public API ──────────────────────────────────────────────────

    /**
     * Get current engine state for REST API.
     */
    getState() {
        const ctrl = this.controller;
        return {
            connected: this.connection != null && this.connection.isOpen,
            port: this.port,
            controllerType: this.connection?.controllerType || null,
            machineState: (typeof ctrl?.getMappedState === 'function') ? ctrl.getMappedState() : 'idle',
            activeState: (typeof ctrl?.getState === 'function') ? ctrl.getState() : 'Idle',
            position: (typeof ctrl?.getPosition === 'function') ? ctrl.getPosition() : { x: 0, y: 0, z: 0 },
            machinePosition: (typeof ctrl?.getMachinePosition === 'function') ? ctrl.getMachinePosition() : { x: 0, y: 0, z: 0 },
            workflowState: (typeof ctrl?.getWorkflowState === 'function') ? ctrl.getWorkflowState() : 'idle',
            senderStatus: (typeof ctrl?.getSenderStatus === 'function') ? ctrl.getSenderStatus() : null,
            feederStatus: (typeof ctrl?.getFeederStatus === 'function') ? ctrl.getFeederStatus() : null,
            overrides: (typeof ctrl?.getOverrides === 'function') ? ctrl.getOverrides() : { feed: 100, rapid: 100, spindle: 100 },
            toolChanger: (typeof ctrl?.getToolChangerStatus === 'function') ? ctrl.getToolChangerStatus() : null,
            health: (typeof ctrl?.getHealthMetrics === 'function') ? ctrl.getHealthMetrics() : null,
            loadedFile: this.loadedFile,
        };
    }

    /**
     * List available serial ports.
     */
    async listPorts() {
        return SerialConnection.listPorts();
    }
}

module.exports = { CNCEngine };
