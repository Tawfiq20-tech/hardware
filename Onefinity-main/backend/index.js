/**
 * CNC backend: Express + Socket.IO + CNCEngine.
 *
 * Uses the 6-layer architecture:
 *   Layer 1: SerialConnection (hardware I/O)
 *   Layer 2: Connection (firmware detection, lifecycle)
 *   Layer 3: GrblController / GrblHalController (command handling)
 *   Layer 4: Sender (G-code streaming)
 *   Layer 5: CNCEngine (Socket.IO server) <-- this file wires it up
 *   Layer 6: Frontend controller.ts (client)
 *
 * Port: 4000 (or process.env.PORT)
 */
const http = require('http');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');
const logger = require('./logger');
const { CNCEngine } = require('./services/CNCEngine');
const errlog = require('./middleware/errlog');
const errclient = require('./middleware/errclient');
const errnotfound = require('./middleware/errnotfound');
const errserver = require('./middleware/errserver');

const PORT = Number(process.env.PORT) || 4000;
const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

// Request logging
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        logger.info('request', {
            method: req.method,
            url: req.url,
            statusCode: res.statusCode,
            responseTime: Date.now() - start,
        });
    });
    next();
});

// Frontend logging endpoint
app.post('/api/log', (req, res) => {
    const { level = 'info', message, meta } = req.body || {};
    logger.log(level, message || 'frontend log', meta ? { frontend: meta } : {});
    res.status(204).end();
});

// Create HTTP + Socket.IO server
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: true },
    path: '/socket.io',
    serveClient: true,
    pingTimeout: 60000,
    pingInterval: 25000,
    transports: ['websocket', 'polling'],
});

// Create CNCEngine (Layer 5)
const engine = new CNCEngine(io);

// ─── REST API ────────────────────────────────────────────────────

app.get('/api/ports', async (req, res) => {
    try {
        const ports = await engine.listPorts();
        res.json(ports);
    } catch (err) {
        logger.error(err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/state', (req, res) => {
    res.json(engine.getState());
});

app.post('/api/connect', (req, res) => {
    const path = req.body.path || req.body.port;
    const baudRate = req.body.baudRate || 115200;
    const network = req.body.network || false;
    if (!path) {
        return res.status(400).json({ error: 'Missing path, port, or IP address' });
    }

    // Use a temporary socket-like object for the REST callback
    const fakeSocket = {
        id: `rest-${Date.now()}`,
        emit: () => {},
    };

    engine._handleOpen(fakeSocket, path, { baudRate, network }, (err) => {
        if (err) {
            logger.error(err);
            return res.status(500).json({ error: err.message });
        }
        res.json({
            ok: true,
            port: engine.port,
            controllerType: engine.connection?.controllerType || null,
        });
    });
});

app.post('/api/disconnect', (req, res) => {
    try {
        engine._closeConnection();
        res.json({ ok: true });
    } catch (err) {
        logger.error(err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/command', (req, res) => {
    const cmd = req.body.command || req.body.cmd;
    const args = req.body.args || [];
    if (!cmd) return res.status(400).json({ error: 'Missing command' });
    if (!engine.controller) return res.status(400).json({ error: 'Not connected' });
    try {
        engine.controller.command(cmd, ...args);
        res.json({ ok: true });
    } catch (err) {
        logger.error(err);
        res.status(500).json({ error: err.message });
    }
});

// ─── Macro REST API ──────────────────────────────────────────────

app.get('/api/macros', (req, res) => {
    res.json(engine.config.getMacros());
});

app.post('/api/macros', (req, res) => {
    engine.config.saveMacro(req.body);
    res.json(engine.config.getMacros());
});

app.delete('/api/macros/:id', (req, res) => {
    engine.config.deleteMacro(req.params.id);
    res.json(engine.config.getMacros());
});

app.post('/api/macros/:id/run', (req, res) => {
    const macro = engine.config.getMacro(req.params.id);
    if (!macro) return res.status(404).json({ error: 'Macro not found' });
    if (!engine.controller) return res.status(400).json({ error: 'Not connected' });
    engine.controller.command('macro:run', macro.content);
    res.json({ ok: true });
});

// ─── Tool Library REST API ───────────────────────────────────────

app.get('/api/tools', (req, res) => {
    res.json(engine.config.getTools());
});

app.post('/api/tools', (req, res) => {
    engine.config.saveTool(req.body);
    res.json(engine.config.getTools());
});

app.delete('/api/tools/:id', (req, res) => {
    engine.config.deleteTool(req.params.id);
    res.json(engine.config.getTools());
});

// ─── Config REST API ─────────────────────────────────────────────

app.get('/api/config', (req, res) => {
    res.json(engine.config.getAll());
});

app.get('/api/config/:key', (req, res) => {
    const value = engine.config.get(req.params.key);
    res.json({ key: req.params.key, value });
});

app.post('/api/config', (req, res) => {
    const { key, value } = req.body;
    if (!key) return res.status(400).json({ error: 'Missing key' });
    engine.config.set(key, value);
    res.json({ ok: true });
});

// ─── Health REST API ─────────────────────────────────────────────

app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        uptime: process.uptime(),
        connected: engine.controller != null,
        health: engine.controller?.getHealthMetrics() || null,
    });
});

// ─── Firmware Flashing ───────────────────────────────────────────

const FirmwareFlashing = require('./lib/Firmware/Flashing/firmwareflashing');

app.post('/api/firmware/flash', async (req, res) => {
    const { port, boardType, hexPath } = req.body;

    if (!port || !boardType) {
        return res.status(400).json({ error: 'Missing port or boardType' });
    }

    try {
        // Get socket for progress events (if available from Socket.IO connection)
        const socket = io.sockets.sockets.values().next().value;
        await FirmwareFlashing.flash(port, boardType, { hexPath, socket });
        res.json({ success: true, message: 'Firmware flashed successfully' });
    } catch (err) {
        logger.error(err);
        res.status(500).json({ error: err.message });
    }
});

// ─── Error Handling Middleware Chain ──────────────────────────────
// Order matters: 404 → log → client (JSON) → server (fallback)
app.use(errnotfound());
app.use(errlog);
app.use(errclient);
app.use(errserver());

// Start server
const HOST = process.env.HOST || '0.0.0.0';
server.listen(PORT, HOST, () => {
    logger.info(`CNC backend listening on http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
});
