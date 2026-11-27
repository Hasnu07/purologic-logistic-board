// Sign-in sessions. Each device gets its own session row, so one account can be open on
// several devices at once and an admin can end any of them remotely.
const crypto = require('crypto');
const { db, now } = require('./db');

const COOKIE = 'sid';
const SHORT_MS = 12 * 3600 * 1000;       // normal sign-in
const LONG_MS = 30 * 24 * 3600 * 1000;   // "stay signed in on this device"
const ONLINE_MS = 15 * 60 * 1000;

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) {
      try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* ignore bad cookie */ }
    }
  }
  return out;
}

function deviceLabel(ua = '') {
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android'
    : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Unknown device';
  return `${browser} · ${os}`;
}

function createSession(req, res, user, remember) {
  const token = crypto.randomBytes(32).toString('hex');
  const ttl = remember ? LONG_MS : SHORT_MS;
  const t = now();
  db.prepare('INSERT INTO sessions(id, user_id, device, created_at, last_seen, expires_at) VALUES(?,?,?,?,?,?)')
    .run(sha(token), user.id, deviceLabel(req.get('user-agent')), t, t, new Date(Date.now() + ttl).toISOString());
  db.prepare('UPDATE users SET last_login = ? WHERE id = ?').run(t, user.id);
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: req.secure, path: '/', ...(remember ? { maxAge: ttl } : {}) });
}

function destroySession(req, res) {
  if (req.sessionId) db.prepare('DELETE FROM sessions WHERE id = ?').run(req.sessionId);
  res.clearCookie(COOKIE, { path: '/' });
}

function load(req, res, next) {
  res.locals.user = null;
  const token = parseCookies(req)[COOKIE];
  if (!token) return next();
  const id = sha(token);
  const row = db.prepare(`SELECT s.last_seen, u.* FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.id = ? AND s.expires_at > ? AND u.status = 'active'`).get(id, now());
  if (!row) return next();
  if (Date.now() - new Date(row.last_seen).getTime() > 60000) {
    db.prepare('UPDATE sessions SET last_seen = ? WHERE id = ?').run(now(), id);
  }
  req.sessionId = id;
  req.user = row;
  res.locals.user = row;
  res.locals.deviceCount = db.prepare('SELECT COUNT(*) n FROM sessions WHERE user_id = ? AND expires_at > ?').get(row.id, now()).n;
  next();
}

const homeFor = (user) => (user.role === 'client' ? '/client' : user.role === 'courier' ? '/admin/update' : '/admin');

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.redirect('/login');
    if (req.user.must_change) return res.redirect('/account');
    if (!roles.includes(req.user.role)) {
      return res.status(403).render('error', { title: 'No access', message: 'Your account does not have access to this page.' });
    }
    next();
  };
}

function requireUser(req, res, next) {
  if (!req.user) return res.redirect('/login');
  next();
}

function activeSessions() {
  return db.prepare(`SELECT s.id, s.device, s.created_at, s.last_seen, u.name, u.number, u.id AS user_id
    FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.expires_at > ? ORDER BY s.last_seen DESC`).all(now());
}
const isOnline = (lastSeen) => Date.now() - new Date(lastSeen).getTime() < ONLINE_MS;
const purgeExpired = () => db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now());

module.exports = { parseCookies, createSession, destroySession, load, requireRole, requireUser, homeFor, activeSessions, isOnline, purgeExpired };
