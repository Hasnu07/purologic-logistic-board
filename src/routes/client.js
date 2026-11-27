// Client portal: a client only ever sees their own shipments.
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const D = require('../db');
const { db } = D;
const A = require('../auth');
const F = require('../format');
const B = require('../board');

const r = express.Router();
r.use(A.requireRole('client'));
const s = (v) => (typeof v === 'string' ? v.trim() : '');
const money = (v) => {
  const t = s(v).replace(/,/g, '');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
};

// One optional picture per watch on the request. They move onto the watches when it becomes a shipment.
const PHOTO_EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const photoUpload = multer({
  storage: multer.diskStorage({
    destination: D.UPLOADS,
    filename: (req, file, cb) => cb(null, crypto.randomBytes(16).toString('hex') + PHOTO_EXT[file.mimetype])
  }),
  limits: { fileSize: 15 * 1024 * 1024, files: 20 },
  fileFilter: (req, file, cb) => cb(null, Object.keys(PHOTO_EXT).includes(file.mimetype))
}).any();
const removeFile = (filename) => fs.unlink(path.join(D.UPLOADS, path.basename(filename)), () => {});
const sum = (rows, f) => rows.reduce((a, x) => a + f(x), 0);

// What the client still has to pay us: every shipping charge their wallet has not covered.
const owedBy = (clientId) => {
  const w = D.wallet(clientId);
  return w.available < 0 ? -w.available : 0;
};

const docsFor = (clientId) => db.prepare(`SELECT d.*, s.shipment_no, s.watch, s.id AS sid,
    (SELECT COUNT(*) FROM watches w WHERE w.shipment_id = s.id) AS watch_count
  FROM docs d JOIN shipments s ON s.id = d.shipment_id
  WHERE s.client_id = ? ORDER BY d.id DESC`).all(clientId).map(D.label);

r.get('/', (req, res) => {
  const all = D.listShipments({ clientId: req.user.id });
  const active = all.filter((x) => !F.isClosed(x.status));
  const delivered = all.filter((x) => x.status === 'Delivered');
  const costed = all.filter((x) => x.cost !== null);
  const requests = D.openRequests(req.user.id);
  // The shipment closest to arriving gets the big tile.
  const nearest = active.slice().sort((a, b) => F.stepOf(b.status) - F.stepOf(a.status))[0];
  res.render('client/dashboard', {
    title: 'Overview', nav: 'overview', active, delivered, costed, total: sum(costed, (x) => x.cost), nearest,
    newest: active.slice().sort((a, b) => b.collected_at.localeCompare(a.collected_at))[0],
    docs: docsFor(req.user.id).slice(0, 4), wallet: D.wallet(req.user.id), owed: owedBy(req.user.id), spark: B.spark(all),
    cal: B.calendar(all, requests, req.query.m), todayItems: B.today(req.user.id, requests, '/client')
  });
});

r.get('/shipments', (req, res) => {
  const q = s(req.query.q);
  const rows = D.listShipments({ clientId: req.user.id, q });
  const tabs = { active: rows.filter((x) => !F.isClosed(x.status)), delivered: rows.filter((x) => F.isClosed(x.status)), all: rows };
  const tab = tabs[req.query.tab] ? req.query.tab : 'active';
  res.render('client/shipments', {
    title: 'My shipments', nav: 'shipments', q, tab, tabs, rows: tabs[tab],
    requests: D.requestsFor({ clientId: req.user.id }), error: null, v: {}
  });
});

function requestForm(res, { v, error }, status = 200) {
  res.status(status).render('client/request', { title: 'New shipment', nav: 'shipments', v, error });
}

r.get('/shipments/new', (req, res) => {
  const u = req.user;
  requestForm(res, {
    error: null,
    v: {
      kind: 'collection', address: u.address, contact_name: u.name, note: '',
      d_name: u.name, d_line1: '', d_line2: '', d_post: '', d_city: u.city || '', d_country: '', d_phone: u.phone || '',
      watches: [{ brand: '', watch: '', reference: '', serial: '', watch_date: '', value: '' }]
    }
  });
});

// Reads the whole request: how it reaches us, where it goes, and every watch on it.
function readRequestForm(body) {
  const watches = [];
  for (let i = 0; i < 50; i++) {
    if (body['watch_' + i] === undefined) continue;
    const w = {
      pos: i, brand: F.BRANDS.includes(body['brand_' + i]) ? body['brand_' + i] : '',
      watch: s(body['watch_' + i]).slice(0, 120), reference: s(body['reference_' + i]).slice(0, 80),
      serial: s(body['serial_' + i]).slice(0, 80), watch_date: s(body['watch_date_' + i]).slice(0, 60),
      value: money(body['value_' + i])
    };
    if (w.watch || w.reference || w.serial || w.watch_date || (w.value !== null && !Number.isNaN(w.value))) watches.push(w);
  }
  return {
    kind: body.kind === 'dropoff' ? 'dropoff' : 'collection',
    address: s(body.address).slice(0, 300), contact_name: s(body.contact_name).slice(0, 120),
    preferred_at: s(body.preferred_at), note: s(body.note).slice(0, 300),
    d_name: s(body.d_name).slice(0, 120), d_line1: s(body.d_line1).slice(0, 160), d_line2: s(body.d_line2).slice(0, 160),
    d_post: s(body.d_post).slice(0, 30), d_city: s(body.d_city).slice(0, 80), d_country: s(body.d_country).slice(0, 80),
    d_phone: s(body.d_phone).slice(0, 40),
    watches
  };
}

function validateRequest(v) {
  if (v.kind === 'collection') {
    if (!v.address) return 'Tell us the address we should collect from.';
    if (!v.contact_name) return 'Tell us who we should ask for at the collection.';
    if (Number.isNaN(new Date(v.preferred_at).getTime()) || !v.preferred_at) return 'Choose the date and time for the collection.';
  }
  if (!v.d_name) return 'The delivery address needs a name or company.';
  if (!v.d_line1) return 'The delivery address needs address line 1.';
  if (!v.d_city) return 'The delivery address needs a city.';
  if (!v.d_country) return 'The delivery address needs a country.';
  if (!v.d_phone) return 'The delivery address needs a phone number.';
  if (!v.watches.length) return 'Add at least one watch to the shipment.';
  for (const w of v.watches) {
    if (!w.watch) return 'Every watch needs its model.';
    if (!w.reference) return `Watch ${w.pos + 1} needs its reference.`;
    if (w.value === null || Number.isNaN(w.value)) return `Watch ${w.pos + 1} needs a declared value.`;
  }
  return null;
}

r.post('/shipments/new', photoUpload, (req, res) => {
  const v = readRequestForm(req.body);
  const files = req.files || [];
  const error = validateRequest(v);
  if (error) { files.forEach((f) => removeFile(f.filename)); return requestForm(res, { v, error }, 400); }
  const total = v.watches.reduce((a, w) => a + w.value, 0);
  const at = v.kind === 'collection' ? new Date(v.preferred_at).toISOString() : D.now();
  const id = D.tx(() => {
    const info = db.prepare(`INSERT INTO requests
      (client_id, watch, watches, kind, contact_name, preferred_at, address, note, total_value,
       d_name, d_line1, d_line2, d_post, d_city, d_country, d_phone, created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      req.user.id, v.watches[0].watch, JSON.stringify(v.watches), v.kind, v.contact_name, at,
      v.kind === 'collection' ? v.address : '', v.note, total,
      v.d_name, v.d_line1, v.d_line2, v.d_post, v.d_city, v.d_country, v.d_phone, D.now());
    const rid = Number(info.lastInsertRowid);
    for (const f of files) {
      const m = /^photo_(\d+)$/.exec(f.fieldname);
      if (!m) { removeFile(f.filename); continue; }
      db.prepare('INSERT INTO request_photos(request_id, pos, filename, mime, created_at) VALUES(?,?,?,?,?)')
        .run(rid, Number(m[1]), f.filename, f.mimetype, D.now());
    }
    return rid;
  });
  res.flash(`Shipment request sent: ${v.watches.length} watch${v.watches.length === 1 ? '' : 'es'}, ${F.money(total, res.locals.cur)} declared. We will confirm it shortly.`);
  res.redirect('/client/shipments?tab=requests#r' + id);
});

r.post('/requests/:id/cancel', (req, res) => {
  db.prepare("UPDATE requests SET status = 'dismissed' WHERE id = ? AND client_id = ? AND status = 'open'").run(Number(req.params.id), req.user.id);
  res.flash('Request cancelled.');
  res.redirect('/client/shipments?tab=requests');
});

r.get('/shipments/:id', (req, res, next) => {
  const d = D.shipmentDetail(Number(req.params.id));
  if (!d || d.sh.client_id !== req.user.id) return next();
  res.render('shipment', { title: d.sh.watch_label, nav: 'shipments', ...d, staffView: false });
});

r.get('/docs', (req, res) => {
  const groups = [];
  for (const d of docsFor(req.user.id)) {
    let g = groups.find((x) => x.sid === d.sid);
    if (!g) groups.push(g = { sid: d.sid, shipment_no: d.shipment_no, watch: d.watch_label, docs: [] });
    g.docs.push(d);
  }
  res.render('client/docs', { title: 'Documents', nav: 'docs', groups });
});

r.get('/wallet', (req, res) => {
  const lines = [];
  for (const t of db.prepare('SELECT * FROM topups WHERE client_id = ?').all(req.user.id)) {
    lines.push({ at: t.created_at, what: 'Top up' + (t.note ? ', ' + t.note : ''), ref: 'Wallet', amount: t.amount, pending: false });
  }
  const all = D.listShipments({ clientId: req.user.id });
  for (const sh of all) {
    if (sh.cost === null || sh.paid_from !== 'Wallet') continue;
    const pending = !F.isClosed(sh.status);
    lines.push({ at: sh.delivered_at || sh.collected_at, what: (pending ? 'Pending: shipping, ' : 'Shipping, ') + sh.watch_label, ref: sh.shipment_no, amount: -sh.cost, pending });
  }
  lines.sort((a, b) => a.at.localeCompare(b.at));
  let running = 0;
  for (const l of lines) { running += l.amount; l.balance = running; }
  const costed = all.filter((x) => x.cost !== null);
  res.render('client/wallet', { title: 'Shipment wallet', nav: 'wallet', lines: lines.reverse(), wallet: D.wallet(req.user.id), spent: sum(costed, (x) => x.cost), count: costed.length });
});

module.exports = r;
