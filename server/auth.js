/**
 * Server-side auth: verifies the SPA's Microsoft ID token and enforces an
 * email allowlist on /api/milestones.
 *
 * The token audience is our own client id (the SPA requests `openid` and sends
 * the resulting `id_token`). Signing keys and the issuer come from the
 * authority's OIDC discovery document, so no tenant-specific values are
 * hard-coded.
 *
 * `AUTH_DISABLED=1` disables enforcement for local development but is ignored
 * (with a warning) when `NODE_ENV=production`.
 */

import { createRemoteJWKSet, jwtVerify } from 'jose';

import { logger } from './logger.js';

const DEFAULT_AUTHORITY = 'https://login.microsoftonline.com/consumers';
const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const MAX_CLIENT_DIAGNOSTIC = 64;

const discoveryCache = new Map();

/**
 * Sanitizes a client-forwarded diagnostic header. These values are untrusted
 * and used for logging only: newlines are collapsed and the length is capped so
 * a malicious client cannot forge log lines or flood the log.
 *
 * @param {unknown} value
 * @returns {string}
 */
function sanitizeDiagnostic(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\r\n\t]+/g, ' ').trim().slice(0, MAX_CLIENT_DIAGNOSTIC);
}

/**
 * Parses a comma-separated allowlist into a lowercase array.
 *
 * @param {string | undefined | null} value
 * @returns {string[]}
 */
export function parseList(value) {
  return String(value ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Loads (and caches) the OIDC discovery document for an authority, returning
 * the issuer plus a JWKS resolver.
 *
 * @param {string} [authority]
 * @returns {Promise<{ issuer: string, jwks: ReturnType<typeof createRemoteJWKSet> }>}
 */
export async function loadDiscovery(authority = DEFAULT_AUTHORITY) {
  const base = authority.replace(/\/$/, '');
  if (!discoveryCache.has(base)) {
    const promise = (async () => {
      const response = await fetch(
        `${base}/v2.0/.well-known/openid-configuration`
      );
      if (!response.ok) {
        throw new Error(`OIDC discovery failed (${response.status})`);
      }
      const config = await response.json();
      return {
        issuer: config.issuer,
        jwks: createRemoteJWKSet(new URL(config.jwks_uri)),
      };
    })().catch((error) => {
      discoveryCache.delete(base);
      throw error;
    });
    discoveryCache.set(base, promise);
  }
  return discoveryCache.get(base);
}

/**
 * @param {Record<string, unknown>} payload
 * @returns {string | null}
 */
function identityFrom(payload) {
  const value = payload.email || payload.preferred_username;
  return typeof value === 'string' && value ? value : null;
}

/**
 * Returns true when the request Origin/Referer matches the request host or an
 * explicitly allowed origin. Mutations must be same-origin.
 *
 * @param {import('express').Request} req
 * @param {string[]} allowedOrigins
 * @returns {boolean}
 */
function originAllowed(req, allowedOrigins) {
  const origin = req.get('origin') || req.get('referer');
  if (!origin) return false;

  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }

  if (allowedOrigins.includes(parsed.origin.toLowerCase())) return true;

  const host = req.get('host');
  return Boolean(host) && parsed.host === host;
}

/**
 * Builds the auth middleware.
 *
 * @param {{
 *   clientId?: string,
 *   authority?: string,
 *   allowedEmails?: string[],
 *   allowedOrigins?: string[],
 *   authDisabled?: boolean,
 *   nodeEnv?: string,
 *   resolveDiscovery?: (authority: string) => Promise<{ issuer: string, jwks: unknown }>,
 * }} [options]
 * @returns {import('express').RequestHandler}
 */
export function createAuthMiddleware(options = {}) {
  const clientId = options.clientId ?? process.env.MS_CLIENT_ID;
  const authority =
    options.authority ?? process.env.MS_AUTHORITY ?? DEFAULT_AUTHORITY;
  const allowedEmails =
    options.allowedEmails ?? parseList(process.env.ALLOWED_EMAILS);
  const allowedOrigins =
    options.allowedOrigins ?? parseList(process.env.ALLOWED_ORIGINS);
  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV;
  const authDisabled =
    options.authDisabled ?? process.env.AUTH_DISABLED === '1';
  const resolveDiscovery = options.resolveDiscovery ?? loadDiscovery;

  if (authDisabled && nodeEnv === 'production') {
    logger.warn('AUTH_DISABLED is ignored when NODE_ENV=production');
  }
  const disabled = authDisabled && nodeEnv !== 'production';
  if (disabled) {
    logger.warn('AUTH_DISABLED=1 - /api/milestones is unauthenticated (dev only)');
  }

  return async function authMiddleware(req, res, next) {
    if (disabled) return next();

    if (!clientId) {
      logger.warn('auth rejected request', { reason: 'MS_CLIENT_ID missing' });
      return res.status(500).json({ error: 'Authentication is not configured' });
    }

    if (MUTATION_METHODS.has(req.method) && !originAllowed(req, allowedOrigins)) {
      logger.warn('auth rejected request', { reason: 'origin' });
      return res.status(403).json({ error: 'Origin not allowed' });
    }

    const header = req.get('authorization') || '';
    const match = /^Bearer (.+)$/.exec(header);
    if (!match) {
      const clientError = sanitizeDiagnostic(req.get('x-auth-error'));
      const stage = sanitizeDiagnostic(req.get('x-auth-stage'));
      logger.warn('auth rejected request', {
        reason: 'missing token',
        ...(stage ? { stage } : {}),
        ...(clientError ? { clientError } : {}),
      });
      return res.status(401).json({ error: 'Missing bearer token' });
    }

    let discovery;
    try {
      discovery = await resolveDiscovery(authority);
    } catch {
      logger.warn('auth rejected request', { reason: 'discovery' });
      return res.status(503).json({ error: 'Authentication unavailable' });
    }

    let payload;
    try {
      ({ payload } = await jwtVerify(match[1], discovery.jwks, {
        issuer: discovery.issuer,
        audience: clientId,
        algorithms: ['RS256'],
      }));
    } catch (error) {
      logger.warn('auth rejected request', {
        reason: 'invalid token',
        errCode: typeof error?.code === 'string' ? error.code : undefined,
      });
      return res.status(401).json({ error: 'Invalid token' });
    }

    const identity = identityFrom(payload);
    if (!identity) {
      const hasEmail = typeof payload.email === 'string' && payload.email.length > 0;
      const hasPreferredUsername =
        typeof payload.preferred_username === 'string' &&
        payload.preferred_username.length > 0;
      logger.warn('auth rejected request', {
        reason: 'no identity',
        hasEmail,
        hasPreferredUsername,
      });
      return res.status(403).json({ error: 'Token has no identity' });
    }
    if (!allowedEmails.includes(identity.toLowerCase())) {
      logger.warn('auth rejected request', { reason: 'email not allowed' });
      return res.status(403).json({ error: 'Account not allowed' });
    }

    req.identity = identity;
    req.auth = payload;
    return next();
  };
}
