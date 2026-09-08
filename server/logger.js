// never log req.body — see AGENTS.md:30
// server/logger.js — minimal stdout abstraction, migratable to pino/winston.
// Only allowed meta keys: method, path, status, reason (enum), id, limit.
// Never log: req.body, ciphertext (title_ct etc), verifier_ct/iv, passphrase, title, media_mime value.

function format(level, msg, meta = {}) {
  return `[${new Date().toISOString()}] ${level} ${msg}` + (Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '');
}

export const logger = {
  info: (msg, meta) => console.log(format('INFO', msg, meta)),
  warn: (msg, meta) => console.warn(format('WARN', msg, meta)),
  error: (msg, meta) => console.error(format('ERROR', msg, meta)),
};
