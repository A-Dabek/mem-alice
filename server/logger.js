// never log req.body — see AGENTS.md
// server/logger.js — minimal stdout abstraction, migratable to pino/winston.
// Only allowed meta keys: method, path, status, reason (enum), id, limit,
// stage, clientError, errCode, hasEmail, hasPreferredUsername.
// The auth keys carry client-forwarded diagnostics (sanitized, untrusted),
// a library error code, and identity *key-presence booleans* only.
// Never log: req.body, title/subtitle text, token/identity values, media_mime value.

function format(level, msg, meta = {}) {
  return `[${new Date().toISOString()}] ${level} ${msg}` + (Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '');
}

export const logger = {
  info: (msg, meta) => console.log(format('INFO', msg, meta)),
  warn: (msg, meta) => console.warn(format('WARN', msg, meta)),
  error: (msg, meta) => console.error(format('ERROR', msg, meta)),
};
