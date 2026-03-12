/**
 * Winston app logger: console + file. Used for requests, errors, and frontend-sent logs (POST /api/log).
 */
const path = require('path');
const fs = require('fs');
const winston = require('winston');

const logsDir = path.join(__dirname, 'logs');
const sessionsDir = path.join(logsDir, 'sessions');
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
if (!fs.existsSync(sessionsDir)) fs.mkdirSync(sessionsDir, { recursive: true });

const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
    ),
    defaultMeta: { service: 'cnc-backend' },
    transports: [
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.simple()
            ),
        }),
        new winston.transports.File({ filename: path.join(logsDir, 'app.log') }),
    ],
});

module.exports = logger;
module.exports.logsDir = logsDir;
module.exports.sessionsDir = sessionsDir;
