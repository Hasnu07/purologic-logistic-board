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
CREATE TABLE IF NOT EXISTS watches (
  id INTEGER PRIMARY KEY,
  shipment_id INTEGER NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  watch_no TEXT NOT NULL UNIQUE,
  watch TEXT NOT NULL,
  reference TEXT NOT NULL DEFAULT '',
  serial TEXT NOT NULL DEFAULT '',
  watch_date TEXT NOT NULL DEFAULT '',
  value REAL,
  insurance TEXT NOT NULL DEFAULT '',
  accessories TEXT NOT NULL DEFAULT '[]',
  pos INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS watches_shipment ON watches(shipment_id, pos, id);
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

// Schema upgrades are additive: a column is added only when the live database has not got it yet.
function addColumn(table, col, decl) {
  const has = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
  if (!has) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${decl}`);
}
addColumn('photos', 'watch_id', 'INTEGER REFERENCES watches(id) ON DELETE SET NULL');
addColumn('requests', 'watches', "TEXT NOT NULL DEFAULT '[]'");
// How the watches reach us: 'collection' = we collect from the client, 'dropoff' = the client sends them to us.
addColumn('requests', 'kind', "TEXT NOT NULL DEFAULT 'collection'");
addColumn('requests', 'contact_name', "TEXT NOT NULL DEFAULT ''");
for (const c of ['d_name', 'd_line1', 'd_line2', 'd_post', 'd_city', 'd_country', 'd_phone']) {
  addColumn('requests', c, "TEXT NOT NULL DEFAULT ''");
}
addColumn('requests', 'total_value', 'REAL');
db.exec(`CREATE TABLE IF NOT EXISTS request_photos (
  id INTEGER PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  pos INTEGER NOT NULL DEFAULT 0,
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS request_photos_req ON request_photos(request_id, pos);`);

// Every shipment made before watches had their own table keeps its watch, as the first one on the shipment.
db.exec(`INSERT INTO watches(shipment_id, watch_no, watch, reference, serial, watch_date, value, insurance, accessories, pos, created_at)
  SELECT s.id, s.watch_no, s.watch, s.reference, s.serial, s.watch_date, s.value, s.insurance, s.accessories, 0, s.created_at
  FROM shipments s WHERE NOT EXISTS (SELECT 1 FROM watches w WHERE w.shipment_id = s.id)`);

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
  sender_address: '',
  receiving_address: 'Recipient: Ummay Abbas\nBuilding: Grand Address\nApartment: 3902, Creek Harbour, Tower 1\nCity/Country: Dubai/UAE'
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
// A shipment carries one or more watches. Each watch keeps its own number for life; the shipment
// has one number for the whole box. The watch columns on `shipments` mirror the first watch so
// that a shipment row still reads on its own.
const EMPTY_WATCH = { watch: '', reference: '', serial: '', watch_date: '', value: null, insurance: '', accessories: [] };

function insertWatch(shipmentId, w, pos) {
  db.prepare(`INSERT INTO watches(shipment_id, watch_no, watch, reference, serial, watch_date, value, insurance, accessories, pos, created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
    shipmentId, nextNumber('watch'), w.watch, w.reference || '', w.serial || '', w.watch_date || '',
    w.value ?? null, w.insurance || '', JSON.stringify(w.accessories || []), pos, now());
}

function updateWatch(id, w, pos) {
  db.prepare(`UPDATE watches SET watch=?, reference=?, serial=?, watch_date=?, value=?, insurance=?, accessories=?, pos=? WHERE id=?`)
    .run(w.watch, w.reference || '', w.serial || '', w.watch_date || '', w.value ?? null, w.insurance || '',
      JSON.stringify(w.accessories || []), pos, id);
}

// Keeps the shipment row in step with its watches: first watch on the row, declared value the total.
function syncShipmentWatches(shipmentId) {
  const rows = db.prepare('SELECT * FROM watches WHERE shipment_id = ? ORDER BY pos, id').all(shipmentId);
  if (!rows.length) return;
  const total = rows.reduce((a, w) => a + (w.value || 0), 0);
  db.prepare('UPDATE shipments SET watch_no=?, watch=?, reference=?, serial=?, watch_date=?, value=?, insurance=?, accessories=? WHERE id=?')
    .run(rows[0].watch_no, rows[0].watch, rows[0].reference, rows[0].serial, rows[0].watch_date,
      rows.some((w) => w.value !== null) ? total : null, rows[0].insurance, rows[0].accessories, shipmentId);
}

// Applies the watch list from a form: rows with an id are kept (their number never changes),
// rows without one are new, and anything left out is removed from the shipment.
function saveShipmentWatches(shipmentId, watches) {
  const existing = db.prepare('SELECT id FROM watches WHERE shipment_id = ?').all(shipmentId).map((w) => w.id);
  const kept = new Set();
  watches.forEach((w, i) => {
    if (w.id && existing.includes(w.id)) { updateWatch(w.id, w, i); kept.add(w.id); }
    else insertWatch(shipmentId, w, i);
  });
  for (const id of existing) if (!kept.has(id)) db.prepare('DELETE FROM watches WHERE id = ?').run(id);
  syncShipmentWatches(shipmentId);
}

function createShipment(d, byName, at) {
  return tx(() => {
    const client = getUser(d.client_id);
    const collectedAt = d.collected_at || at || now();
    // A caller may still pass a single watch as flat fields; it becomes the shipment's one watch.
    const watches = (d.watches && d.watches.length ? d.watches : [{
      watch: d.watch, reference: d.reference, serial: d.serial, watch_date: d.watch_date,
      value: d.value, insurance: d.insurance, accessories: d.accessories || []
    }]);
    const info = db.prepare(`INSERT INTO shipments
      (shipment_no, watch_no, client_id, watch, reference, serial, watch_date, value, insurance, accessories,
       origin, destination, addr_name, addr_lines, addr_phone, addr_note, collected_at, status, eta_note, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      nextNumber('shipment'), 'pending', client.id, watches[0].watch, '', '', '',
      null, '', '[]',
      d.origin || '', d.destination || '',
      d.addr_name || client.name, d.addr_lines || client.address, d.addr_phone || client.phone, d.addr_note || '',
      collectedAt, 'Collected', d.eta_note || '', now());
    const id = Number(info.lastInsertRowid);
    watches.forEach((w, i) => insertWatch(id, w, i));
    syncShipmentWatches(id);
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
  (SELECT COUNT(*) FROM photos p WHERE p.shipment_id = s.id) AS photo_count,
  (SELECT COUNT(*) FROM watches w WHERE w.shipment_id = s.id) AS watch_count,
  (SELECT GROUP_CONCAT(x.watch_no, ', ') FROM (SELECT watch_no FROM watches WHERE shipment_id = s.id ORDER BY pos, id) x) AS watch_nos
  FROM shipments s JOIN users u ON u.id = s.client_id`;

// `watch` and `watch_no` on a shipment row are the first watch. These two read well when there are several.
function label(row) {
  const extra = (row.watch_count || 1) - 1;
  row.watch_label = extra > 0 ? `${row.watch} + ${extra} more` : row.watch;
  row.watch_no_label = extra > 0 ? `${row.watch_no} +${extra}` : row.watch_no;
  return row;
}

function listShipments({ q = '', clientId = null } = {}) {
  const where = [];
  const args = [];
  if (clientId) { where.push('s.client_id = ?'); args.push(clientId); }
  if (q) {
    const like = '%' + q.replace(/[%_]/g, '') + '%';
    where.push(`(s.shipment_no LIKE ? OR u.number LIKE ? OR u.name LIKE ? OR EXISTS
      (SELECT 1 FROM watches w WHERE w.shipment_id = s.id AND
        (w.watch_no LIKE ? OR w.serial LIKE ? OR w.reference LIKE ? OR w.watch LIKE ?)))`);
    args.push(like, like, like, like, like, like, like);
  }
  const sql = SHIP_SELECT + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY s.collected_at DESC, s.id DESC';
  return db.prepare(sql).all(...args).map(label);
}

// Every watch on its own row, for the Watches screen and the CSV export.
function listWatches({ q = '', clientId = null } = {}) {
  const ships = listShipments({ q, clientId });
  const byId = new Map(ships.map((s) => [s.id, s]));
  if (!ships.length) return [];
  const rows = db.prepare(`SELECT * FROM watches WHERE shipment_id IN (${ships.map(() => '?').join(',')}) ORDER BY pos, id`)
    .all(...ships.map((s) => s.id));
  return rows.map((w) => {
    const s = byId.get(w.shipment_id);
    return { ...s, ...w, id: s.id, watch_row_id: w.id, created_at: s.created_at, pos: w.pos };
  }).sort((a, b) => b.collected_at.localeCompare(a.collected_at) || a.pos - b.pos);
}

// Collection requests sent in by clients and not yet handled.
function openRequests(clientId = null) {
  return db.prepare(`SELECT r.*, u.name AS client_name, u.number AS client_no FROM requests r JOIN users u ON u.id = r.client_id
    WHERE r.status = 'open' ${clientId ? 'AND r.client_id = ?' : ''} ORDER BY r.preferred_at`).all(...(clientId ? [clientId] : []))
    .map(readRequest);
}

// A request's watches were plain names at first and are full records now; both read the same way here.
function readRequest(rq) {
  const raw = parseAcc(rq.watches);
  rq.watch_items = (raw.length ? raw : [rq.watch].filter(Boolean))
    .map((w) => (typeof w === 'string' ? { watch: w, reference: '', serial: '', watch_date: '', value: null } : w))
    .filter((w) => w.watch);
  rq.watch_list = rq.watch_items.map((w) => w.watch);
  rq.watch_label = rq.watch_list.length > 1 ? `${rq.watch_list[0]} + ${rq.watch_list.length - 1} more` : (rq.watch_list[0] || rq.watch);
  rq.declared = rq.total_value !== null && rq.total_value !== undefined
    ? rq.total_value
    : (rq.watch_items.some((w) => w.value !== null) ? rq.watch_items.reduce((a, w) => a + (Number(w.value) || 0), 0) : null);
  rq.photos = db.prepare('SELECT * FROM request_photos WHERE request_id = ? ORDER BY pos, id').all(rq.id);
  // The structured delivery address, as the printed label will read.
  rq.delivery_lines = [rq.d_line1, rq.d_line2, [rq.d_post, rq.d_city].filter(Boolean).join(' '), rq.d_country].filter(Boolean);
  return rq;
}

// Every request a client has sent, newest first, whatever became of it.
function requestsFor({ clientId = null, status = null } = {}) {
  const where = [];
  const args = [];
  if (clientId) { where.push('r.client_id = ?'); args.push(clientId); }
  if (status) { where.push('r.status = ?'); args.push(status); }
  return db.prepare(`SELECT r.*, u.name AS client_name, u.number AS client_no FROM requests r JOIN users u ON u.id = r.client_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY r.created_at DESC, r.id DESC`).all(...args).map(readRequest);
}

function getRequest(id) {
  const rq = db.prepare('SELECT r.*, u.name AS client_name, u.number AS client_no FROM requests r JOIN users u ON u.id = r.client_id WHERE r.id = ?').get(id);
  return rq ? readRequest(rq) : null;
}

function parseAcc(text) {
  try { const a = JSON.parse(text); return Array.isArray(a) ? a : []; } catch { return []; }
}

function watchesOf(shipmentId) {
  return db.prepare('SELECT * FROM watches WHERE shipment_id = ? ORDER BY pos, id').all(shipmentId)
    .map((w) => ({ ...w, accessories: parseAcc(w.accessories) }));
}

function shipmentDetail(id) {
  const sh = db.prepare(SHIP_SELECT + ' WHERE s.id = ?').get(id);
  if (!sh) return null;
  label(sh);
  const events = db.prepare('SELECT * FROM events WHERE shipment_id = ? ORDER BY created_at DESC, id DESC').all(id);
  const closed = F.isClosed(sh.status);
  const t = (e) => new Date(e.created_at).getTime();
  events.forEach((e, i) => {
    if (i === 0) e.dur = closed ? '' : 'here ' + F.dur(Date.now() - t(e));
    else e.dur = F.dur(t(events[i - 1]) - t(e));
  });
  const end = closed && events[0] ? t(events[0]) : Date.now();
  const watches = watchesOf(id);
  const byWatch = new Map(watches.map((w) => [w.id, w]));
  return {
    sh, events, watches, accessories: watches.length ? watches[0].accessories : parseAcc(sh.accessories),
    totalValue: watches.some((w) => w.value !== null) ? watches.reduce((a, w) => a + (w.value || 0), 0) : null,
    elapsed: F.dur(end - new Date(sh.collected_at).getTime()),
    photos: db.prepare('SELECT * FROM photos WHERE shipment_id = ? ORDER BY id').all(id)
      .map((p) => ({ ...p, watch_no: p.watch_id && byWatch.has(p.watch_id) ? byWatch.get(p.watch_id).watch_no : '' })),
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
  createShipment, addEvent, undoLastEvent, listShipments, listWatches, openRequests, requestsFor, getRequest, shipmentDetail, wallet,
  saveShipmentWatches, syncShipmentWatches, watchesOf, parseAcc, label, EMPTY_WATCH
};
