// services/logger.js
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const LOG_DIR = path.join(process.cwd(), 'logs');

// Ensure logs directory exists — synchronous is fine here, this runs
// once at module load, before any request can come in.
try {
  fs.mkdirSync(LOG_DIR, { recursive: true });
} catch (err) {
  console.error('Failed to create logs directory:', err);
}

const LOG_LEVELS = {
  ERROR: 'ERROR',
  WARN: 'WARN',
  INFO: 'INFO',
  DEBUG: 'DEBUG',
  AUDIT: 'AUDIT',
};

const LEVEL_EMOJI = {
  [LOG_LEVELS.ERROR]: '❌',
  [LOG_LEVELS.WARN]: '⚠️',
  [LOG_LEVELS.INFO]: 'ℹ️',
  [LOG_LEVELS.DEBUG]: '🐛',
  [LOG_LEVELS.AUDIT]: '📋',
};

/** JSON.stringify that never throws on circular refs / BigInt / etc. */
function safeStringify(value) {
  const seen = new WeakSet();
  try {
    return JSON.stringify(value, (_key, val) => {
      if (typeof val === 'bigint') return val.toString();
      if (typeof val === 'object' && val !== null) {
        if (seen.has(val)) return '[Circular]';
        seen.add(val);
      }
      return val;
    });
  } catch (err) {
    return `"[unserializable: ${err.message}]"`;
  }
}

function formatEntry(level, message, metadata) {
  return {
    timestamp: new Date().toISOString(),
    level,
    message,
    metadata: metadata || {},
    environment: process.env.NODE_ENV || 'development',
  };
}

/**
 * Fire-and-forget async file write. Errors are caught and logged to
 * stderr instead of crashing the process or being silently dropped
 * (the previous appendFileSync(..., callback) call did neither
 * correctly — appendFileSync is synchronous and ignores callbacks).
 */
function writeToFile(level, entry) {
  const date = entry.timestamp.split('T')[0];
  const filename = path.join(LOG_DIR, `${level.toLowerCase()}-${date}.log`);
  fsp.appendFile(filename, safeStringify(entry) + '\n').catch((err) => {
    console.error('Log file write error:', err.message);
  });
}

function log(level, message, metadata) {
  const entry = formatEntry(level, message, metadata);

  if (process.env.NODE_ENV === 'development') {
    const emoji = LEVEL_EMOJI[level] || '📝';
    console.log(`${emoji} [${level}] ${entry.timestamp} ${message}`, metadata || '');
  }

  // Always persist to file, in every environment — not just production —
  // so local debugging has the same log files to inspect as prod does.
  writeToFile(level, entry);
}

class Logger {
  static info(message, data = {}) {
    log(LOG_LEVELS.INFO, message, data);
  }

  static warn(message, data = {}) {
    log(LOG_LEVELS.WARN, message, data);
  }

  static error(message, error = {}) {
    // Normalize Error objects into plain metadata (name/message/stack)
    // instead of relying on error.message existing, so this never
    // stringifies an Error to "{}" or throws on a non-Error input.
    const metadata =
      error instanceof Error
        ? { name: error.name, message: error.message, stack: error.stack }
        : error;
    log(LOG_LEVELS.ERROR, message, metadata);
  }

  static debug(message, data = {}) {
    log(LOG_LEVELS.DEBUG, message, data);
  }

  static audit(action, userId, details = {}) {
    log(LOG_LEVELS.AUDIT, `User: ${userId} | Action: ${action}`, details);
  }
}

module.exports = Logger;