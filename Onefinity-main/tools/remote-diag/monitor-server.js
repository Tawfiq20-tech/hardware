#!/usr/bin/env node
/**
 * RTS-1 Remote Diagnostics Monitor Server
 *
 * Runs on the VPC. Accepts WebSocket connections from the serial proxy client
 * and serves a live web dashboard for protocol analysis.
 *
 * Usage:
 *   node monitor-server.js
 *   node monitor-server.js --ws-port 8765 --http-port 8766
 */

const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');
const fs = require('fs');
const path = require('path');

// ─── Config ────────────────────────────────────────────────────────────────

const WS_PORT = parseInt(process.argv.find((a, i) => process.argv[i - 1] === '--ws-port') || '8765', 10);
const HTTP_PORT = parseInt(process.argv.find((a, i) => process.argv[i - 1] === '--http-port') || '8766', 10);
const MAX_TRAFFIC = 10000; // In-memory ring buffer size
const LOG_DIR = path.join(__dirname, 'logs');

// ─── RTS-1 Protocol Constants ──────────────────────────────────────────────

const CMD_NAMES = {
    0x00: 'Query',
    0x01: 'FirmwareVersion',
    0x0A: 'Home',
    0x10: 'JogMode',
    0x20: 'Jog',
    0x40: 'GCodeMode',
    0x81: 'Unlock',
    0x82: 'WriteReg',
    0xA0: 'JSON',
    0xA1: 'MotionComplete',
    0xB0: 'Status',
    0xB3: 'JogAck',
    0xC1: 'MachineState',
};

const STATE_NAMES = {
    0x00: 'Idle', 0x01: 'Run', 0x02: 'Hold', 0x03: 'Home',
    0x04: 'Alarm', 0x05: 'Jog', 0x08: 'Homing', 0x09: 'MotorError',
};

const WREG_NAMES = {
    0x03: 'Inverted', 0x04: 'MaxVelocity', 0x05: 'Accel',
    0x06: 'ProbeX', 0x07: 'ProbeY', 0x08: 'ProbeZ',
    0x09: 'HomeOffset', 0x0A: 'Jerk', 0x0B: 'StepsPerMM',
    0x0D: 'MinLimit', 0x0E: 'SpindleMode', 0x14: 'SpindleDelay',
    0x15: 'PWMFreq', 0x17: 'ProbeSpeed',
};

// ─── State ─────────────────────────────────────────────────────────────────

let proxyClient = null;
const dashboardClients = new Set();
const trafficLog = [];
let frameCount = 0;
let logStream = null;

// Live machine state (updated from decoded B0 frames)
const machineState = {
    state: 'Unknown',
    stateByte: 0,
    flags: 0,
    x: 0, y: 0, z: 0, a: 0,
    lastUpdate: 0,
};

// ─── Logging ───────────────────────────────────────────────────────────────

function initLog() {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const logPath = path.join(LOG_DIR, `diag-${ts}.log`);
    logStream = fs.createWriteStream(logPath, { flags: 'a' });
    console.log(`[Monitor] Logging to ${logPath}`);
}

function logLine(dir, hex, decoded) {
    if (logStream) {
        logStream.write(`${new Date().toISOString()} ${dir} ${hex} ${decoded}\n`);
    }
}

// ─── RTS-1 Frame Parser ───────────────────────────────────────────────────

function decodeFrame(hexStr, dir) {
    const bytes = Buffer.from(hexStr.replace(/\s/g, ''), 'hex');

    // Extract individual frames from hex data (may contain multiple frames or partial data)
    const frames = [];
    let i = 0;

    while (i < bytes.length) {
        // Look for frame start
        if (bytes[i] !== 0x01) {
            // Non-framed data (could be ASCII like $X\n or JSON fragment)
            let end = i;
            while (end < bytes.length && bytes[end] !== 0x01) end++;
            const raw = bytes.slice(i, end);
            const text = raw.toString('ascii').replace(/[\x00-\x08\x0e-\x1f]/g, '.');
            frames.push({ type: 'ascii', text: text.trim(), hex: raw.toString('hex') });
            i = end;
            continue;
        }

        // Have 0x01 start byte
        if (i + 1 >= bytes.length) break; // Need at least length byte

        const len = bytes[i + 1];
        if (len < 3 || len > 255) {
            // Invalid length — skip this byte
            i++;
            continue;
        }

        if (i + len > bytes.length) break; // Incomplete frame

        // Verify end byte
        if (bytes[i + len - 1] !== 0xFF) {
            // No end marker at expected position — might be wrong frame boundary
            i++;
            continue;
        }

        const frame = bytes.slice(i, i + len);
        const cmdByte = frame.length > 2 ? frame[2] : 0;

        const decoded = decodeCommand(frame, cmdByte, dir);
        frames.push({
            type: 'frame',
            cmd: cmdByte,
            cmdName: CMD_NAMES[cmdByte] || `0x${cmdByte.toString(16)}`,
            len: len,
            hex: frame.toString('hex').match(/.{1,2}/g).join(' '),
            decoded,
        });

        i += len;
    }

    return frames;
}

function decodeCommand(frame, cmd, dir) {
    try {
        switch (cmd) {
            case 0xB0: // Status report (30 bytes: state, flags, X/Y/Z/A floats)
                if (frame.length >= 30) {
                    const stateByte = frame[3];
                    const flags = frame[4];
                    const x = frame.readFloatLE(5);
                    const y = frame.readFloatLE(9);
                    const z = frame.readFloatLE(13);
                    const a = frame.readFloatLE(17);
                    const unk1 = frame.readFloatLE(21);
                    const unk2 = frame.readFloatLE(25);

                    if (dir === 'rx') {
                        // Update live state
                        machineState.stateByte = stateByte;
                        machineState.state = STATE_NAMES[stateByte] || `0x${stateByte.toString(16)}`;
                        machineState.flags = flags;
                        machineState.x = parseFloat(x.toFixed(3));
                        machineState.y = parseFloat(y.toFixed(3));
                        machineState.z = parseFloat(z.toFixed(3));
                        machineState.a = parseFloat(a.toFixed(3));
                        machineState.lastUpdate = Date.now();
                    }

                    const stName = STATE_NAMES[stateByte] || `0x${stateByte.toString(16)}`;
                    return `Status: ${stName} flags=0x${flags.toString(16)} X=${x.toFixed(3)} Y=${y.toFixed(3)} Z=${z.toFixed(3)} A=${a.toFixed(3)}`;
                }
                if (frame.length === 5 && dir === 'tx') {
                    return 'Poll Status';
                }
                return `Status (${frame.length}B)`;

            case 0xC1: // Machine state
                if (frame.length >= 4) {
                    const st = frame[3];
                    return `State: ${STATE_NAMES[st] || `0x${st.toString(16)}`}`;
                }
                return 'Machine State';

            case 0x20: // Jog command (25 bytes: 4x float32 velocity + feed float)
                if (frame.length >= 22) {
                    // Payload starts at byte 3
                    const vx = frame.readFloatLE(3);
                    const vy = frame.readFloatLE(7);
                    const vz = frame.readFloatLE(11);
                    const va = frame.readFloatLE(15);
                    let feed = 0;
                    if (frame.length >= 24) feed = frame.readFloatLE(19);
                    return `Jog: vX=${vx.toFixed(1)} vY=${vy.toFixed(1)} vZ=${vz.toFixed(1)} vA=${va.toFixed(1)} feed=${feed.toFixed(0)}`;
                }
                return 'Jog';

            case 0x0A: // Home
                if (frame.length >= 5) {
                    return `Home: enable=${frame[3]}`;
                }
                return 'Home';

            case 0x10: // Jog Mode
                if (frame.length >= 5) {
                    return `JogMode: ${frame[3] === 1 ? 'ENABLE' : 'DISABLE'}`;
                }
                return 'JogMode';

            case 0x81: // Unlock
                if (frame.length >= 5) {
                    return `Unlock ($X): 0x${frame[3].toString(16)}`;
                }
                return 'Unlock';

            case 0x82: // Write Register
                if (frame.length >= 9) {
                    const regId = frame[3];
                    const axisIdx = frame[4];
                    const val = frame.readFloatLE(5);
                    const regName = WREG_NAMES[regId] || `0x${regId.toString(16)}`;
                    const axisName = ['X', 'Y', 'Z', 'A'][axisIdx] || `#${axisIdx}`;
                    return `WriteReg: ${regName}[${axisName}] = ${val}`;
                }
                return 'WriteReg';

            case 0x40: // G-code Mode
                if (frame.length > 5) {
                    // ASCII payload after 0x3E marker
                    const markerIdx = frame.indexOf(0x3E, 3);
                    if (markerIdx >= 0) {
                        const gcode = frame.slice(markerIdx + 1, frame.length - 1).toString('ascii').trim();
                        return `GCode: ${gcode}`;
                    }
                }
                return 'GCodeMode';

            case 0xA0: // JSON message
                if (frame.length > 4) {
                    try {
                        const json = frame.slice(3, frame.length - 1).toString('utf8');
                        const parsed = JSON.parse(json);
                        if (parsed.msgType === 'settings') {
                            return `JSON: settings.${parsed.parameter} = ${JSON.stringify(parsed.value)}`;
                        }
                        return `JSON: ${parsed.msgType || 'unknown'}`;
                    } catch {
                        return 'JSON (parse error)';
                    }
                }
                return 'JSON';

            case 0xB3: return 'JogAck';
            case 0xA1: return 'MotionComplete';
            case 0x01: // Could be firmware version
                if (frame.length >= 5) {
                    return `FirmwareVersion: ${frame.slice(3, frame.length - 1).toString('hex')}`;
                }
                return 'FirmwareVersion';

            case 0x00: // Query
                if (frame.length >= 4) {
                    const reg = frame[3];
                    const regName = CMD_NAMES[reg] || `0x${reg.toString(16)}`;
                    return `Query: ${regName}`;
                }
                return 'Query';

            default:
                return `Unknown cmd=0x${cmd.toString(16)}`;
        }
    } catch (err) {
        return `Decode error: ${err.message}`;
    }
}

// ─── WebSocket Server (proxy client connects here) ─────────────────────────

const wss = new WebSocketServer({ port: WS_PORT });

wss.on('connection', (socket, req) => {
    const ip = req.socket.remoteAddress;
    console.log(`[Monitor] Proxy client connected from ${ip}`);

    if (proxyClient) {
        console.log('[Monitor] Replacing existing proxy client connection');
        proxyClient.close();
    }
    proxyClient = socket;

    // Notify dashboards
    broadcastToDashboards({ type: 'proxy_status', connected: true, ip });

    socket.on('message', (data) => {
        try {
            const msg = JSON.parse(data.toString());

            if (msg.type === 'data') {
                frameCount++;

                // Decode the frame(s)
                const decoded = decodeFrame(msg.hex, msg.dir);

                const entry = {
                    id: frameCount,
                    ts: msg.ts || Date.now(),
                    dir: msg.dir,
                    hex: msg.hex,
                    len: msg.len,
                    injected: msg.injected || false,
                    frames: decoded,
                };

                // Store in ring buffer
                trafficLog.push(entry);
                if (trafficLog.length > MAX_TRAFFIC) trafficLog.shift();

                // Log to file
                const decodedSummary = decoded.map(f => f.decoded || f.text || f.cmdName).join('; ');
                logLine(msg.dir.toUpperCase(), msg.hex, decodedSummary);

                // Broadcast to dashboards
                broadcastToDashboards({
                    type: 'frame',
                    entry,
                    machineState,
                });
            } else if (msg.type === 'status') {
                broadcastToDashboards({ type: 'serial_status', ...msg });
            }
        } catch (err) {
            console.error(`[Monitor] Error processing proxy message: ${err.message}`);
        }
    });

    socket.on('close', () => {
        console.log('[Monitor] Proxy client disconnected');
        proxyClient = null;
        broadcastToDashboards({ type: 'proxy_status', connected: false });
    });

    socket.on('error', (err) => {
        console.error(`[Monitor] Proxy client error: ${err.message}`);
    });
});

console.log(`[Monitor] WebSocket server listening on port ${WS_PORT}`);

// ─── HTTP Server (dashboard) ───────────────────────────────────────────────

const httpServer = http.createServer((req, res) => {
    if (req.url === '/' || req.url === '/index.html') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(DASHBOARD_HTML);
    } else if (req.url === '/api/state') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            machineState,
            frameCount,
            proxyConnected: proxyClient !== null,
            recentFrames: trafficLog.slice(-100),
        }));
    } else {
        res.writeHead(404);
        res.end('Not found');
    }
});

// Dashboard WebSocket (browsers connect here)
const dashWss = new WebSocketServer({ server: httpServer });

dashWss.on('connection', (socket) => {
    console.log('[Monitor] Dashboard client connected');
    dashboardClients.add(socket);

    // Send current state
    socket.send(JSON.stringify({
        type: 'init',
        machineState,
        frameCount,
        proxyConnected: proxyClient !== null,
        recentFrames: trafficLog.slice(-200),
    }));

    socket.on('message', (data) => {
        try {
            const msg = JSON.parse(data.toString());

            if (msg.type === 'inject' || msg.type === 'inject_ascii') {
                // Forward injection command to proxy client
                if (proxyClient && proxyClient.readyState === WebSocket.OPEN) {
                    proxyClient.send(JSON.stringify(msg));
                } else {
                    socket.send(JSON.stringify({ type: 'error', message: 'Proxy client not connected' }));
                }
            } else if (msg.type === 'clear') {
                trafficLog.length = 0;
                frameCount = 0;
                broadcastToDashboards({ type: 'cleared' });
            }
        } catch (err) {
            console.error(`[Monitor] Dashboard message error: ${err.message}`);
        }
    });

    socket.on('close', () => {
        dashboardClients.delete(socket);
        console.log('[Monitor] Dashboard client disconnected');
    });
});

httpServer.listen(HTTP_PORT, '0.0.0.0', () => {
    console.log(`[Monitor] Dashboard at http://0.0.0.0:${HTTP_PORT}`);
    console.log(`[Monitor] Ready — waiting for proxy client connection...\n`);
});

function broadcastToDashboards(msg) {
    const json = JSON.stringify(msg);
    for (const client of dashboardClients) {
        if (client.readyState === WebSocket.OPEN) {
            client.send(json);
        }
    }
}

// ─── Init ──────────────────────────────────────────────────────────────────

initLog();

// ─── Embedded Dashboard HTML ───────────────────────────────────────────────

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>RTS-1 Remote Diagnostics</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Consolas', 'Fira Code', monospace; background: #0a0a0f; color: #c0c0c0; }

.header {
    background: #12121a; border-bottom: 1px solid #2a2a3a; padding: 12px 20px;
    display: flex; align-items: center; justify-content: space-between;
}
.header h1 { font-size: 16px; color: #e0e0e0; }
.header h1 span { color: #4fc3f7; }
.status-bar { display: flex; gap: 16px; font-size: 12px; }
.status-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 4px; }
.status-dot.on { background: #4caf50; box-shadow: 0 0 6px #4caf50; }
.status-dot.off { background: #666; }

.main { display: grid; grid-template-columns: 1fr 300px; grid-template-rows: 1fr auto; height: calc(100vh - 50px); }

/* Left panel: traffic log */
.traffic-panel { overflow: hidden; display: flex; flex-direction: column; border-right: 1px solid #2a2a3a; }
.traffic-header {
    display: flex; justify-content: space-between; align-items: center;
    padding: 8px 12px; background: #14141e; border-bottom: 1px solid #2a2a3a; font-size: 12px;
}
.traffic-header button {
    background: #2a2a3a; color: #aaa; border: none; padding: 4px 10px;
    border-radius: 3px; cursor: pointer; font-size: 11px;
}
.traffic-header button:hover { background: #3a3a4a; color: #fff; }
.traffic-log {
    flex: 1; overflow-y: auto; padding: 4px 0; font-size: 12px; line-height: 1.6;
}
.traffic-entry { padding: 2px 12px; border-bottom: 1px solid #1a1a24; }
.traffic-entry:hover { background: #1a1a28; }
.traffic-entry .time { color: #666; margin-right: 8px; }
.traffic-entry .dir-rx { color: #4caf50; font-weight: 700; }
.traffic-entry .dir-tx { color: #42a5f5; font-weight: 700; }
.traffic-entry .dir-inject { color: #ff9800; font-weight: 700; }
.traffic-entry .hex { color: #888; font-size: 11px; }
.traffic-entry .decoded { color: #e0e0e0; margin-left: 8px; }
.traffic-entry .cmd-name { color: #ce93d8; font-weight: 600; }

/* Right panel: state + injection */
.right-panel { display: flex; flex-direction: column; overflow-y: auto; }

.state-panel { padding: 12px; border-bottom: 1px solid #2a2a3a; }
.state-panel h3 { font-size: 13px; color: #4fc3f7; margin-bottom: 8px; }
.state-grid { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; font-size: 13px; }
.state-grid .label { color: #888; }
.state-grid .value { color: #e0e0e0; font-weight: 600; }
.state-grid .value.idle { color: #4caf50; }
.state-grid .value.alarm { color: #f44336; }
.state-grid .value.motorError { color: #ff9800; }
.state-grid .value.homing { color: #42a5f5; }
.state-grid .value.jog { color: #ce93d8; }

.inject-panel { padding: 12px; border-bottom: 1px solid #2a2a3a; }
.inject-panel h3 { font-size: 13px; color: #4fc3f7; margin-bottom: 8px; }
.inject-row { display: flex; gap: 6px; margin-bottom: 8px; }
.inject-row input {
    flex: 1; background: #1a1a24; border: 1px solid #2a2a3a; color: #e0e0e0;
    padding: 6px 8px; font-family: inherit; font-size: 12px; border-radius: 3px;
}
.inject-row input:focus { outline: none; border-color: #4fc3f7; }
.inject-row button, .quick-btn {
    background: #2a2a3a; color: #ccc; border: none; padding: 6px 12px;
    border-radius: 3px; cursor: pointer; font-size: 11px; font-family: inherit;
}
.inject-row button:hover, .quick-btn:hover { background: #3a3a4a; color: #fff; }
.quick-cmds { display: flex; flex-wrap: wrap; gap: 4px; }
.quick-btn { font-size: 10px; padding: 4px 8px; }
.quick-btn.danger { background: #3a1a1a; color: #f44; }
.quick-btn.danger:hover { background: #4a2a2a; }

.filter-panel { padding: 12px; }
.filter-panel h3 { font-size: 13px; color: #4fc3f7; margin-bottom: 8px; }
.filter-row { display: flex; gap: 6px; flex-wrap: wrap; }
.filter-btn {
    background: #2a2a3a; color: #aaa; border: none; padding: 4px 8px;
    border-radius: 3px; cursor: pointer; font-size: 10px;
}
.filter-btn.active { background: #1a3a4a; color: #4fc3f7; border: 1px solid #4fc3f7; }

.serial-status { padding: 12px; font-size: 11px; color: #666; border-top: 1px solid #2a2a3a; }
</style>
</head>
<body>

<div class="header">
    <h1><span>RTS-1</span> Remote Diagnostics</h1>
    <div class="status-bar">
        <span><span class="status-dot" id="proxyDot"></span>Proxy: <span id="proxyStatus">--</span></span>
        <span><span class="status-dot" id="serialDot"></span>Serial: <span id="serialStatus">--</span></span>
        <span>Frames: <span id="frameCount">0</span></span>
    </div>
</div>

<div class="main">
    <div class="traffic-panel">
        <div class="traffic-header">
            <span>Live Traffic</span>
            <div style="display:flex;gap:6px;">
                <button onclick="toggleAutoScroll()">Auto-scroll: <span id="autoScrollLabel">ON</span></button>
                <button onclick="clearTraffic()">Clear</button>
                <label style="display:flex;align-items:center;gap:4px;color:#888;font-size:11px;">
                    <input type="checkbox" id="showPolls" checked onchange="togglePolls()">
                    Show polls
                </label>
            </div>
        </div>
        <div class="traffic-log" id="trafficLog"></div>
    </div>

    <div class="right-panel">
        <div class="state-panel">
            <h3>Machine State</h3>
            <div class="state-grid">
                <span class="label">State:</span> <span class="value" id="stateValue">--</span>
                <span class="label">Flags:</span> <span class="value" id="flagsValue">--</span>
                <span class="label">X:</span> <span class="value" id="posX">--</span>
                <span class="label">Y:</span> <span class="value" id="posY">--</span>
                <span class="label">Z:</span> <span class="value" id="posZ">--</span>
                <span class="label">A:</span> <span class="value" id="posA">--</span>
            </div>
        </div>

        <div class="inject-panel">
            <h3>Command Injection</h3>
            <div class="inject-row">
                <input type="text" id="hexInput" placeholder="Raw hex: 01 05 00 b0 ff" onkeydown="if(event.key==='Enter')injectHex()">
                <button onclick="injectHex()">Send</button>
            </div>
            <div class="inject-row">
                <input type="text" id="asciiInput" placeholder="ASCII: $X" onkeydown="if(event.key==='Enter')injectAscii()">
                <button onclick="injectAscii()">Send</button>
            </div>
            <div class="quick-cmds">
                <button class="quick-btn" onclick="quickCmd('01 05 00 b0 ff')">Poll Status</button>
                <button class="quick-btn" onclick="quickCmd('01 05 00 01 ff')">Firmware</button>
                <button class="quick-btn" onclick="quickCmd('01 05 00 c1 ff')">State</button>
                <button class="quick-btn" onclick="quickCmd('01 06 00 0a 01 ff')">Home</button>
                <button class="quick-btn" onclick="quickCmd('01 06 00 10 01 ff')">JogMode ON</button>
                <button class="quick-btn" onclick="quickCmd('01 06 00 10 00 ff')">JogMode OFF</button>
                <button class="quick-btn" onclick="quickAscii('$X\\n')">Unlock ($X)</button>
                <button class="quick-btn" onclick="quickCmd('01 06 00 81 58 ff')">Unlock (bin)</button>
                <button class="quick-btn danger" onclick="quickAscii('\\x18')">Soft Reset</button>
                <button class="quick-btn" onclick="quickCmd('01 19 00 20 00000000 00000000 00000000 00000000 00000000 ff')">Stop (zero jog)</button>
            </div>
        </div>

        <div class="filter-panel">
            <h3>Filters</h3>
            <div class="filter-row">
                <button class="filter-btn active" data-filter="all" onclick="setFilter('all',this)">All</button>
                <button class="filter-btn" data-filter="rx" onclick="setFilter('rx',this)">RX only</button>
                <button class="filter-btn" data-filter="tx" onclick="setFilter('tx',this)">TX only</button>
                <button class="filter-btn" data-filter="status" onclick="setFilter('status',this)">Status</button>
                <button class="filter-btn" data-filter="jog" onclick="setFilter('jog',this)">Jog</button>
                <button class="filter-btn" data-filter="home" onclick="setFilter('home',this)">Home</button>
                <button class="filter-btn" data-filter="wreg" onclick="setFilter('wreg',this)">WriteReg</button>
            </div>
        </div>

        <div class="serial-status" id="serialInfo">
            Waiting for proxy connection...
        </div>
    </div>
</div>

<script>
const log = document.getElementById('trafficLog');
const MAX_ENTRIES = 1500;
let autoScroll = true;
let showPolls = true;
let activeFilter = 'all';
let ws = null;

function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(proto + '://' + location.host);

    ws.onopen = () => { document.getElementById('proxyDot').className = 'status-dot on'; };

    ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        switch (msg.type) {
            case 'init':
                updateState(msg.machineState);
                document.getElementById('frameCount').textContent = msg.frameCount;
                updateProxyStatus(msg.proxyConnected);
                if (msg.recentFrames) msg.recentFrames.forEach(entry => addEntry(entry));
                break;
            case 'frame':
                addEntry(msg.entry);
                if (msg.machineState) updateState(msg.machineState);
                document.getElementById('frameCount').textContent = msg.entry.id;
                break;
            case 'proxy_status':
                updateProxyStatus(msg.connected, msg.ip);
                break;
            case 'serial_status':
                updateSerialStatus(msg);
                break;
            case 'cleared':
                log.innerHTML = '';
                document.getElementById('frameCount').textContent = '0';
                break;
            case 'error':
                addSystemMessage(msg.message, 'red');
                break;
        }
    };

    ws.onclose = () => {
        document.getElementById('proxyDot').className = 'status-dot off';
        document.getElementById('proxyStatus').textContent = 'Reconnecting...';
        setTimeout(connect, 2000);
    };
}

function updateState(s) {
    if (!s) return;
    const stEl = document.getElementById('stateValue');
    stEl.textContent = s.state;
    stEl.className = 'value ' + s.state.toLowerCase().replace(/\\s/g, '');
    document.getElementById('flagsValue').textContent = '0x' + (s.flags || 0).toString(16).padStart(2, '0');
    document.getElementById('posX').textContent = (s.x || 0).toFixed(3) + ' mm';
    document.getElementById('posY').textContent = (s.y || 0).toFixed(3) + ' mm';
    document.getElementById('posZ').textContent = (s.z || 0).toFixed(3) + ' mm';
    document.getElementById('posA').textContent = (s.a || 0).toFixed(3) + ' deg';
}

function updateProxyStatus(connected, ip) {
    const dot = document.getElementById('proxyDot');
    const text = document.getElementById('proxyStatus');
    dot.className = 'status-dot ' + (connected ? 'on' : 'off');
    text.textContent = connected ? ('Connected' + (ip ? ' (' + ip + ')' : '')) : 'Disconnected';
}

function updateSerialStatus(msg) {
    const dot = document.getElementById('serialDot');
    const text = document.getElementById('serialStatus');
    const info = document.getElementById('serialInfo');
    if (msg.serial === 'connected') {
        dot.className = 'status-dot on';
        text.textContent = msg.port || 'Connected';
        info.textContent = 'Serial: ' + (msg.port || '?') + ' @ ' + (msg.baud || '?') + ' baud';
    } else {
        dot.className = 'status-dot off';
        text.textContent = msg.serial === 'error' ? 'Error' : 'Disconnected';
        info.textContent = msg.message || 'Serial disconnected';
    }
}

function addEntry(entry) {
    if (!entry || !entry.frames) return;

    // Filter check
    if (!shouldShow(entry)) return;

    for (const frame of entry.frames) {
        const div = document.createElement('div');
        div.className = 'traffic-entry';
        div.dataset.dir = entry.dir;
        div.dataset.cmd = frame.cmdName || '';

        const time = new Date(entry.ts).toISOString().slice(11, 23);
        const dirClass = entry.injected ? 'dir-inject' : ('dir-' + entry.dir);
        const dirLabel = entry.injected ? 'INJ' : entry.dir.toUpperCase();

        let decoded = '';
        if (frame.type === 'frame') {
            decoded = '<span class="cmd-name">[' + frame.cmdName + ']</span> <span class="decoded">' + escHtml(frame.decoded || '') + '</span>';
        } else if (frame.type === 'ascii') {
            decoded = '<span class="cmd-name">[ASCII]</span> <span class="decoded">' + escHtml(frame.text) + '</span>';
        }

        const hexStr = frame.hex || entry.hex || '';
        const shortHex = hexStr.length > 60 ? hexStr.slice(0, 60) + '...' : hexStr;

        div.innerHTML =
            '<span class="time">' + time + '</span>' +
            '<span class="' + dirClass + '">' + dirLabel + '</span> ' +
            decoded +
            '<br><span class="hex">' + shortHex + '</span>';

        log.appendChild(div);
    }

    // Trim old entries
    while (log.children.length > MAX_ENTRIES) log.removeChild(log.firstChild);

    if (autoScroll) log.scrollTop = log.scrollHeight;
}

function shouldShow(entry) {
    if (!showPolls) {
        // Hide B0 poll requests (TX 01 05 00 b0 ff)
        if (entry.dir === 'tx' && entry.hex && entry.hex.replace(/\\s/g, '') === '010500b0ff') return false;
    }
    if (activeFilter === 'all') return true;
    if (activeFilter === 'rx') return entry.dir === 'rx';
    if (activeFilter === 'tx') return entry.dir === 'tx';
    if (activeFilter === 'status') return entry.frames && entry.frames.some(f => f.cmdName === 'Status');
    if (activeFilter === 'jog') return entry.frames && entry.frames.some(f => f.cmdName === 'Jog' || f.cmdName === 'JogMode' || f.cmdName === 'JogAck');
    if (activeFilter === 'home') return entry.frames && entry.frames.some(f => f.cmdName === 'Home');
    if (activeFilter === 'wreg') return entry.frames && entry.frames.some(f => f.cmdName === 'WriteReg');
    return true;
}

function addSystemMessage(text, color) {
    const div = document.createElement('div');
    div.className = 'traffic-entry';
    div.style.color = color || '#ff9800';
    div.textContent = '[SYSTEM] ' + text;
    log.appendChild(div);
    if (autoScroll) log.scrollTop = log.scrollHeight;
}

function escHtml(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function toggleAutoScroll() {
    autoScroll = !autoScroll;
    document.getElementById('autoScrollLabel').textContent = autoScroll ? 'ON' : 'OFF';
}

function togglePolls() {
    showPolls = document.getElementById('showPolls').checked;
}

function setFilter(f, btn) {
    activeFilter = f;
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
}

function clearTraffic() {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'clear' }));
    }
    log.innerHTML = '';
}

function injectHex() {
    const hex = document.getElementById('hexInput').value.trim();
    if (!hex) return;
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'inject', hex }));
        document.getElementById('hexInput').value = '';
    }
}

function injectAscii() {
    const text = document.getElementById('asciiInput').value;
    if (!text) return;
    if (ws && ws.readyState === WebSocket.OPEN) {
        // Unescape \\n and \\x sequences
        const unescaped = text.replace(/\\\\n/g, '\\n').replace(/\\\\x([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
        ws.send(JSON.stringify({ type: 'inject_ascii', text: unescaped }));
        document.getElementById('asciiInput').value = '';
    }
}

function quickCmd(hex) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'inject', hex }));
    }
}

function quickAscii(text) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        const unescaped = text.replace(/\\\\n/g, '\\n').replace(/\\\\x([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
        ws.send(JSON.stringify({ type: 'inject_ascii', text: unescaped }));
    }
}

// Pause auto-scroll on hover
log.addEventListener('mouseenter', () => { if (autoScroll) { autoScroll = false; document.getElementById('autoScrollLabel').textContent = 'OFF (hover)'; } });
log.addEventListener('mouseleave', () => { autoScroll = true; document.getElementById('autoScrollLabel').textContent = 'ON'; });

connect();
</script>
</body>
</html>`;
