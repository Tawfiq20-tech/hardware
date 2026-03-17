#!/usr/bin/env node
/**
 * RTS-1 Serial Proxy Client
 *
 * Runs on the machine connected to the CNC controller (e.g., Tawfiq's Windows PC).
 * Opens the serial port and forwards all raw bytes to the VPC monitor server via WebSocket.
 * Also accepts injected commands from the VPC dashboard.
 *
 * Usage:
 *   node proxy-client.js --port COM3 --server ws://10.1.76.249:8765
 *   node proxy-client.js --port /dev/ttyACM0 --baud 230400
 *   node proxy-client.js --list   (list available serial ports)
 */

const { SerialPort } = require('serialport');
const WebSocket = require('ws');

// ─── CLI Args ──────────────────────────────────────────────────────────────

function parseArgs() {
    const args = process.argv.slice(2);
    const opts = {
        port: 'COM3',
        baud: 230400,
        rtscts: true,
        server: 'ws://10.1.76.249:8765',
        list: false,
    };

    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--port': case '-p': opts.port = args[++i]; break;
            case '--baud': case '-b': opts.baud = parseInt(args[++i], 10); break;
            case '--server': case '-s': opts.server = args[++i]; break;
            case '--no-rtscts': opts.rtscts = false; break;
            case '--list': case '-l': opts.list = true; break;
            case '--help': case '-h':
                console.log(`
RTS-1 Serial Proxy Client

Usage: node proxy-client.js [options]

Options:
  --port, -p <port>      Serial port (default: COM3)
  --baud, -b <rate>      Baud rate (default: 230400)
  --server, -s <url>     WebSocket server URL (default: ws://10.1.76.249:8765)
  --no-rtscts            Disable RTS/CTS flow control
  --list, -l             List available serial ports
  --help, -h             Show this help
`);
                process.exit(0);
        }
    }
    return opts;
}

const opts = parseArgs();

// ─── List Ports ────────────────────────────────────────────────────────────

if (opts.list) {
    SerialPort.list().then(ports => {
        console.log('\nAvailable serial ports:\n');
        if (ports.length === 0) {
            console.log('  (none found)');
        } else {
            ports.forEach(p => {
                const vid = p.vendorId ? `VID=${p.vendorId}` : '';
                const pid = p.productId ? `PID=${p.productId}` : '';
                const mfr = p.manufacturer || '';
                console.log(`  ${p.path}  ${vid} ${pid}  ${mfr}`);
            });
        }
        console.log();
    }).catch(err => {
        console.error('Error listing ports:', err.message);
        process.exit(1);
    });
} else {
    startProxy();
}

// ─── Main Proxy ────────────────────────────────────────────────────────────

function startProxy() {
    const ts = () => new Date().toISOString().slice(11, 23);

    console.log(`\n[${ts()}] RTS-1 Serial Proxy`);
    console.log(`[${ts()}] Serial: ${opts.port} @ ${opts.baud} baud (rtscts=${opts.rtscts})`);
    console.log(`[${ts()}] Server: ${opts.server}\n`);

    // ── Serial Port ──

    let serial = null;
    let serialReady = false;

    function openSerial() {
        try {
            serial = new SerialPort({
                path: opts.port,
                baudRate: opts.baud,
                rtscts: opts.rtscts,
                autoOpen: false,
            });

            serial.on('open', () => {
                serialReady = true;
                console.log(`[${ts()}] SERIAL: Opened ${opts.port}`);
                sendWsJson({ type: 'status', serial: 'connected', port: opts.port });
            });

            serial.on('data', (data) => {
                // Forward raw bytes to WebSocket as hex
                const hex = data.toString('hex').match(/.{1,2}/g).join(' ');
                if (ws && ws.readyState === WebSocket.OPEN) {
                    sendWsJson({ type: 'data', dir: 'rx', ts: Date.now(), hex, len: data.length });
                }
                // Local compact display
                const preview = hex.length > 80 ? hex.slice(0, 80) + '...' : hex;
                console.log(`[${ts()}] RX ${data.length}B: ${preview}`);
            });

            serial.on('error', (err) => {
                console.error(`[${ts()}] SERIAL ERROR: ${err.message}`);
                serialReady = false;
                sendWsJson({ type: 'status', serial: 'error', message: err.message });
            });

            serial.on('close', () => {
                console.log(`[${ts()}] SERIAL: Closed`);
                serialReady = false;
                sendWsJson({ type: 'status', serial: 'disconnected' });
                // Retry after 3 seconds
                setTimeout(openSerial, 3000);
            });

            serial.open((err) => {
                if (err) {
                    console.error(`[${ts()}] SERIAL: Failed to open ${opts.port}: ${err.message}`);
                    sendWsJson({ type: 'status', serial: 'error', message: err.message });
                    setTimeout(openSerial, 3000);
                }
            });
        } catch (err) {
            console.error(`[${ts()}] SERIAL: Exception: ${err.message}`);
            setTimeout(openSerial, 3000);
        }
    }

    // ── WebSocket ──

    let ws = null;
    let wsReconnectDelay = 1000;

    function connectWs() {
        try {
            ws = new WebSocket(opts.server);

            ws.on('open', () => {
                console.log(`[${ts()}] WS: Connected to ${opts.server}`);
                wsReconnectDelay = 1000;
                // Send current serial status
                sendWsJson({
                    type: 'status',
                    serial: serialReady ? 'connected' : 'disconnected',
                    port: opts.port,
                    baud: opts.baud,
                });
            });

            ws.on('message', (data) => {
                try {
                    const msg = JSON.parse(data.toString());

                    if (msg.type === 'inject' && msg.hex) {
                        // Command injection from VPC dashboard
                        const bytes = Buffer.from(msg.hex.replace(/\s/g, ''), 'hex');
                        if (serial && serialReady) {
                            serial.write(bytes, (err) => {
                                if (err) {
                                    console.error(`[${ts()}] INJECT ERROR: ${err.message}`);
                                } else {
                                    const hex = bytes.toString('hex').match(/.{1,2}/g).join(' ');
                                    console.log(`[${ts()}] TX ${bytes.length}B: ${hex} (injected)`);
                                    sendWsJson({ type: 'data', dir: 'tx', ts: Date.now(), hex, len: bytes.length, injected: true });
                                }
                            });
                        } else {
                            console.error(`[${ts()}] INJECT: Serial port not ready`);
                            sendWsJson({ type: 'error', message: 'Serial port not ready' });
                        }
                    } else if (msg.type === 'inject_ascii' && msg.text) {
                        // ASCII command injection (e.g., $X, $I)
                        if (serial && serialReady) {
                            serial.write(msg.text, (err) => {
                                if (err) {
                                    console.error(`[${ts()}] INJECT ASCII ERROR: ${err.message}`);
                                } else {
                                    const hex = Buffer.from(msg.text).toString('hex').match(/.{1,2}/g).join(' ');
                                    console.log(`[${ts()}] TX ASCII: ${msg.text.trim()} (${hex})`);
                                    sendWsJson({ type: 'data', dir: 'tx', ts: Date.now(), hex, len: msg.text.length, injected: true });
                                }
                            });
                        }
                    }
                } catch (err) {
                    console.error(`[${ts()}] WS MSG ERROR: ${err.message}`);
                }
            });

            ws.on('close', () => {
                console.log(`[${ts()}] WS: Disconnected — retrying in ${wsReconnectDelay / 1000}s`);
                ws = null;
                setTimeout(connectWs, wsReconnectDelay);
                wsReconnectDelay = Math.min(wsReconnectDelay * 2, 30000);
            });

            ws.on('error', (err) => {
                // Suppress ECONNREFUSED spam — close handler will retry
                if (err.code !== 'ECONNREFUSED') {
                    console.error(`[${ts()}] WS ERROR: ${err.message}`);
                }
            });
        } catch (err) {
            console.error(`[${ts()}] WS: Exception: ${err.message}`);
            setTimeout(connectWs, wsReconnectDelay);
            wsReconnectDelay = Math.min(wsReconnectDelay * 2, 30000);
        }
    }

    function sendWsJson(obj) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(obj));
        }
    }

    // ── Start ──

    openSerial();
    connectWs();

    // Graceful shutdown
    process.on('SIGINT', () => {
        console.log(`\n[${ts()}] Shutting down...`);
        if (serial && serial.isOpen) serial.close();
        if (ws) ws.close();
        process.exit(0);
    });

    process.on('SIGTERM', () => {
        if (serial && serial.isOpen) serial.close();
        if (ws) ws.close();
        process.exit(0);
    });
}
