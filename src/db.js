// Database: schema, unique numbering, and the queries shared by admin and client pages.
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const { hashPw } = require('./password');
const F = require('./format');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const UPLOADS = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOADS, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'purologic.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  role TEXT NOT NULL,
  number TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pw_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  must_change INTEGER NOT NULL DEFAULT 0,
  phone TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  last_login TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS counters (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS shipments (
  id INTEGER PRIMARY KEY,
  shipment_no TEXT NOT NULL UNIQUE,
  watch_no TEXT NOT NULL UNIQUE,
  client_id INTEGER NOT NULL REFERENCES users(id),
  watch TEXT NOT NULL,
  reference TEXT NOT NULL DEFAULT '',
  serial TEXT NOT NULL DEFAULT '',
  watch_date TEXT NOT NULL DEFAULT '',
  value REAL,
  insurance TEXT NOT NULL DEFAULT '',
  accessories TEXT NOT NULL DEFAULT '[]',
  origin TEXT NOT NULL DEFAULT '',
  destination TEXT NOT NULL DEFAULT '',
  addr_name TEXT NOT NULL DEFAULT '',
  addr_lines TEXT NOT NULL DEFAULT '',
  addr_phone TEXT NOT NULL DEFAULT '',
  addr_note TEXT NOT NULL DEFAULT '',
  collected_at TEXT NOT NULL,
  status TEXT NOT NULL,
  courier TEXT NOT NULL DEFAULT '',
  awb TEXT NOT NULL DEFAULT '',
  cost REAL,
  paid_from TEXT NOT NULL DEFAULT '',
  eta_note TEXT NOT NULL DEFAULT '',
  delivered_at TEXT,
  signed_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS shipments_client ON shipments(client_id);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  shipment_id INTEGER NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  by_name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_shipment ON events(shipment_id);
CREATE TABLE IF NOT EXISTS photos (
  id INTEGER PRIMARY KEY,
  shipment_id INTEGER NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT '',
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS docs (
  id INTEGER PRIMARY KEY,
  shipment_id INTEGER NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES users(id),
  watch TEXT NOT NULL,
  preferred_at TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS topups (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES users(id),
  amount REAL NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  by_name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
`);

const now = () => new Date().toISOString();

function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// ---- settings ----
const DEFAULTS = {
  company_name: 'PuroLogic',
  prefix_client: 'CL-',
  prefix_watch: 'WT-',
  prefix_shipment: 'SH-',
  currency: 'USD',
  sender_address: ''
};
function getSettings() {
  const out = { ...DEFAULTS };
  for (const row of db.prepare('SELECT key, value FROM settings').all()) out[row.key] = row.value;
  return out;
}
function setSetting(key, value) {
  if (!(key in DEFAULTS)) return;
  db.prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
}

// ---- unique numbering: issued from a counter that only ever goes up, so numbers are never reused ----
const PAD = { client: 4, watch: 5, shipment: 4, admin: 2, staff: 2, courier: 2 };
const FIXED_PREFIX = { admin: 'AD-', staff: 'ST-', courier: 'CR-' };
function formatNumber(kind, n) {
  const prefix = FIXED_PREFIX[kind] || getSettings()['prefix_' + kind];
  return prefix + String(n).padStart(PAD[kind], '0');
}
function nextNumber(kind) {
  db.prepare('INSERT INTO counters(key, value) VALUES(?, 1) ON CONFLICT(key) DO UPDATE SET value = value + 1').run(kind);
  return formatNumber(kind, db.prepare('SELECT value FROM counters WHERE key = ?').get(kind).value);
}
function numbering() {
  const out = {};
  for (const kind of ['client', 'watch', 'shipment']) {
    const row = db.prepare('SELECT value FROM counters WHERE key = ?').get(kind);
    const issued = row ? row.value : 0;
    out[kind] = { issued, next: formatNumber(kind, issued + 1) };
  }
  return out;
}

// ---- users ----
function createUser({ role, name, email, password, mustChange = false, phone = '', address = '', city = '' }) {
  return tx(() => {
    const number = nextNumber(role);
    const info = db.prepare(
      'INSERT INTO users(role, number, name, email, pw_hash, must_change, phone, address, city, created_at) VALUES(?,?,?,?,?,?,?,?,?,?)'
    ).run(role, number, name, email, hashPw(password), mustChange ? 1 : 0, phone, address, city, now());
    return db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  });
}
const getUser = (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id);
const userCount = () => db.prepare('SELECT COUNT(*) n FROM users').get().n;

// ---- shipments ----
function createShipment(d, byName, at) {
  return tx(() => {
    const client = getUser(d.client_id);
    const collectedAt = d.collected_at || at || now();
    const info = db.prepare(`INSERT INTO shipments
      (shipment_no, watch_no, client_id, watch, reference, serial, watch_date, value, insurance, accessories,
       origin, destination, addr_name, addr_lines, addr_phone, addr_note, collected_at, status, eta_note, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      nextNumber('shipment'), nextNumber('watch'), client.id, d.watch, d.reference || '', d.serial || '', d.watch_date || '',
      d.value ?? null, d.insurance || '', JSON.stringify(d.accessories || []),
      d.origin || '', d.destination || '',
      d.addr_name || client.name, d.addr_lines || client.address, d.addr_phone || client.phone, d.addr_note || '',
      collectedAt, 'Collected', d.eta_note || '', now());
    const id = Number(info.lastInsertRowid);
    db.prepare('INSERT INTO events(shipment_id, status, location, note, by_name, created_at) VALUES(?,?,?,?,?,?)')
      .run(id, 'Collected', d.collected_from || d.origin || '', d.collected_note || '', byName, collectedAt);
    return id;
  });
}

function addEvent(shipmentId, { status, location = '', note = '', signed_by = '' }, byName, at) {
  const when = at || now();
  tx(() => {
    db.prepare('INSERT INTO events(shipment_id, status, location, note, by_name, created_at) VALUES(?,?,?,?,?,?)')
      .run(shipmentId, status, location, note, byName, when);
    db.prepare('UPDATE shipments SET status = ?, delivered_at = ?, signed_by = ? WHERE id = ?')
      .run(status, status === 'Delivered' ? when : null, status === 'Delivered' ? signed_by : '', shipmentId);
  });
}

// Removes the latest update (posted by mistake) and puts the shipment back on the one before it.
function undoLastEvent(shipmentId) {
  return tx(() => {
    const evs = db.prepare('SELECT * FROM events WHERE shipment_id = ? ORDER BY created_at DESC, id DESC LIMIT 2').all(shipmentId);
    if (evs.length < 2) return false;
    db.prepare('DELETE FROM events WHERE id = ?').run(evs[0].id);
    const prev = evs[1];
    db.prepare('UPDATE shipments SET status = ?, delivered_at = ?, signed_by = ? WHERE id = ?')
      .run(prev.status, prev.status === 'Delivered' ? prev.created_at : null, '', shipmentId);
    return true;
  });
}

const SHIP_SELECT = `SELECT s.*, u.name AS client_name, u.number AS client_no, u.city AS client_city,
  (SELECT location FROM events e WHERE e.shipment_id = s.id ORDER BY e.created_at DESC, e.id DESC LIMIT 1) AS last_location,
  (SELECT COUNT(*) FROM photos p WHERE p.shipment_id = s.id) AS photo_count
  FROM shipments s JOIN users u ON u.id = s.client_id`;

function listShipments({ q = '', clientId = null } = {}) {
  const where = [];
  const args = [];
  if (clientId) { where.push('s.client_id = ?'); args.push(clientId); }
  if (q) {
    const like = '%' + q.replace(/[%_]/g, '') + '%';
    where.push('(s.shipment_no LIKE ? OR s.watch_no LIKE ? OR s.serial LIKE ? OR s.reference LIKE ? OR s.watch LIKE ? OR u.number LIKE ? OR u.name LIKE ?)');
    args.push(like, like, like, like, like, like, like);
  }
  const sql = SHIP_SELECT + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY s.collected_at DESC, s.id DESC';
  return db.prepare(sql).all(...args);
}

// Collection requests sent in by clients and not yet handled.
function openRequests(clientId = null) {
  return db.prepare(`SELECT r.*, u.name AS client_name, u.number AS client_no FROM requests r JOIN users u ON u.id = r.client_id
    WHERE r.status = 'open' ${clientId ? 'AND r.client_id = ?' : ''} ORDER BY r.preferred_at`).all(...(clientId ? [clientId] : []));
}

function shipmentDetail(id) {
  const sh = db.prepare(SHIP_SELECT + ' WHERE s.id = ?').get(id);
  if (!sh) return null;
  const events = db.prepare('SELECT * FROM events WHERE shipment_id = ? ORDER BY created_at DESC, id DESC').all(id);
  const closed = F.isClosed(sh.status);
  const t = (e) => new Date(e.created_at).getTime();
  events.forEach((e, i) => {
    if (i === 0) e.dur = closed ? '' : 'here ' + F.dur(Date.now() - t(e));
    else e.dur = F.dur(t(events[i - 1]) - t(e));
  });
  const end = closed && events[0] ? t(events[0]) : Date.now();
  let accessories = [];
  try { accessories = JSON.parse(sh.accessories); } catch { /* keep empty */ }
  return {
    sh, events, accessories,
    elapsed: F.dur(end - new Date(sh.collected_at).getTime()),
    photos: db.prepare('SELECT * FROM photos WHERE shipment_id = ? ORDER BY id').all(id),
    docs: db.prepare('SELECT * FROM docs WHERE shipment_id = ? ORDER BY id DESC').all(id)
  };
}

// ---- wallet: top-ups minus shipping costs marked "Wallet". Costs on shipments still moving count as pending. ----
function wallet(clientId) {
  const topups = db.prepare('SELECT COALESCE(SUM(amount), 0) n FROM topups WHERE client_id = ?').get(clientId).n;
  const rows = db.prepare("SELECT status, cost, shipment_no FROM shipments WHERE client_id = ? AND paid_from = 'Wallet' AND cost IS NOT NULL").all(clientId);
  let charged = 0;
  const pendingItems = [];
  for (const r of rows) {
    if (F.isClosed(r.status)) charged += r.cost;
    else pendingItems.push(r);
  }
  const pending = pendingItems.reduce((a, r) => a + r.cost, 0);
  const balance = topups - charged;
  return { topups, charged, pending, pendingItems, balance, available: balance - pending };
}

module.exports = {
  db, tx, now, DATA_DIR, UPLOADS,
  getSettings, setSetting, DEFAULTS, nextNumber, numbering,
  createUser, getUser, userCount,
  createShipment, addEvent, undoLastEvent, listShipments, openRequests, shipmentDetail, wallet
};
