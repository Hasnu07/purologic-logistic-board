// Admin portal. Roles: admin = everything; staff = shipments, watches, updates, files;
// courier = the update portal, plus read-only shipments and watches.
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const D = require('../db');
const { db } = D;
const A = require('../auth');
const F = require('../format');
const P = require('../password');
const B = require('../board');

const r = express.Router();
r.use(A.requireRole('admin', 'staff', 'courier'));
const editor = A.requireRole('admin', 'staff');
const admin = A.requireRole('admin');

const s = (v) => (typeof v === 'string' ? v.trim() : '');
const num = (v) => {
  const t = s(v).replace(/,/g, '');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
};
const list = (v) => (Array.isArray(v) ? v : v ? [v] : []);
const sum = (rows, f) => rows.reduce((a, x) => a + f(x), 0);
const ms = (iso) => new Date(iso).getTime();
const monthStart = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); };
const dayStart = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const monthName = () => new Date().toLocaleString('en-GB', { month: 'long' });

const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'application/pdf': '.pdf' };
function uploader(types) {
  return multer({
    storage: multer.diskStorage({
      destination: D.UPLOADS,
      filename: (req, file, cb) => cb(null, crypto.randomBytes(16).toString('hex') + EXT[file.mimetype])
    }),
    limits: { fileSize: 15 * 1024 * 1024, files: 12 },
    fileFilter: (req, file, cb) => cb(null, types.includes(file.mimetype))
  });
}
const photoUpload = uploader(['image/jpeg', 'image/png', 'image/webp']);
const docUpload = uploader(Object.keys(EXT));
const removeFile = (filename) => fs.unlink(path.join(D.UPLOADS, path.basename(filename)), () => {});

const getShipment = (req) => db.prepare('SELECT * FROM shipments WHERE id = ?').get(Number(req.params.id));

// What needs attention, in words, for the cards on the right of several screens.
function attentionCards(rows) {
  return rows.filter(F.needsAttention).map((x) => (x.status === 'Customs hold'
    ? { tone: 'note-coral', title: `${x.shipment_no} on customs hold`, sub: `${x.watch}${x.destination ? ', ' + x.destination : ''}.`, link: `/admin/shipments/${x.id}`, action: 'Post an update' }
    : { tone: 'note-amber', title: `${x.shipment_no} has no shipment cost`, sub: `${x.watch}, ${x.status.toLowerCase()} since ${F.fmtDay(x.collected_at)}. The client cannot see a total yet.`, link: `/admin/costs#s${x.id}`, action: 'Enter the cost' }));
}

// The bell in the header shows a dot when something needs attention.
r.use((req, res, next) => {
  res.locals.alerts = req.user.role === 'courier' ? 0 : db.prepare(
    "SELECT COUNT(*) n FROM shipments WHERE status NOT IN ('Delivered','Returned to sender') AND (status = 'Customs hold' OR cost IS NULL)").get().n;
  next();
});

// ---------- overview ----------
r.get('/', (req, res) => {
  const tab = ['active', 'delivered', 'history'].includes(req.query.tab) ? req.query.tab : 'active';
  const all = D.listShipments();
  const active = all.filter((x) => !F.isClosed(x.status));
  const delivered = all.filter((x) => x.status === 'Delivered' && x.delivered_at);
  const month = monthStart();
  const requests = D.openRequests();
  const moving = active.filter((x) => F.isMoving(x.status));
  const routeCount = {};
  for (const x of moving) routeCount[F.route(x)] = (routeCount[F.route(x)] || 0) + 1;
  const routes = Object.entries(routeCount).sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([name, n]) => ({ name, n, pct: Math.round((n / moving.length) * 100) }));
  const transit = delivered.map((x) => ms(x.delivered_at) - ms(x.collected_at));
  const oldest = active.slice().sort((a, b) => a.collected_at.localeCompare(b.collected_at))[0];
  const holds = active.filter((x) => x.status === 'Customs hold').length;
  const noCost = active.filter((x) => x.cost === null).length;
  const shown = tab === 'active' ? active : tab === 'delivered' ? delivered : all;
  res.render('admin/dashboard', {
    title: 'Overview', nav: 'overview', tab, rows: shown.slice(0, 6), totalShown: shown.length, requests,
    listTitle: tab === 'active' ? 'Active shipments' : tab === 'delivered' ? 'Delivered' : 'All shipments',
    kpi: {
      billed: sum(all.filter((x) => x.cost !== null && new Date(x.collected_at) >= month), (x) => x.cost),
      month: monthName(), attention: active.filter(F.needsAttention).length, holds, noCost,
      moving: moving.length, routes, active: active.length,
      deliveredMonth: delivered.filter((x) => new Date(x.delivered_at) >= month).length,
      avg: transit.length ? F.dur(sum(transit, (x) => x) / transit.length) : '—',
      oldest, oldestDur: oldest ? F.dur(Date.now() - ms(oldest.collected_at)) : ''
    },
    spark: B.spark(all), cal: B.calendar(all, requests, req.query.m), todayItems: B.today(null, requests, '/admin')
  });
});

// ---------- shipments list ----------
function filterShipments(query) {
  const q = s(query.q);
  let rows = D.listShipments({ q });
  const courier = s(query.courier), route = s(query.route), from = s(query.from), to = s(query.to);
  if (courier) rows = rows.filter((x) => x.courier === courier);
  if (route) rows = rows.filter((x) => F.route(x) === route);
  if (/^\d{4}-\d{2}-\d{2}$/.test(from)) rows = rows.filter((x) => F.toLocalInput(x.collected_at).slice(0, 10) >= from);
  if (/^\d{4}-\d{2}-\d{2}$/.test(to)) rows = rows.filter((x) => F.toLocalInput(x.collected_at).slice(0, 10) <= to);
  const tabs = {
    active: rows.filter((x) => !F.isClosed(x.status)), delivered: rows.filter((x) => x.status === 'Delivered'),
    history: rows, attention: rows.filter(F.needsAttention)
  };
  const tab = tabs[query.tab] ? query.tab : 'active';
  return { q, courier, route, from, to, tabs, tab, rows: tabs[tab] };
}

r.get('/shipments', (req, res) => {
  const f = filterShipments(req.query);
  const all = D.listShipments();
  const active = all.filter((x) => !F.isClosed(x.status));
  const qs = new URLSearchParams(Object.entries({ q: f.q, courier: f.courier, route: f.route, from: f.from, to: f.to }).filter(([, v]) => v)).toString();
  res.render('admin/shipments', {
    title: 'Shipments', nav: 'shipments', ...f, qs,
    couriers: [...new Set(all.map((x) => x.courier).filter(Boolean))].sort(),
    routes: [...new Set(all.map((x) => F.route(x)).filter((x) => x !== '—'))].sort(),
    collectedToday: all.filter((x) => new Date(x.collected_at) >= dayStart()).length,
    outForDelivery: active.filter((x) => x.status === 'Out for delivery').length,
    cards: attentionCards(active).slice(0, 3)
  });
});

r.get('/shipments.csv', editor, (req, res) => {
  const f = filterShipments(req.query);
  const withCost = req.user.role === 'admin';
  const esc = (v) => {
    let t = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@]/.test(t)) t = "'" + t; // keeps spreadsheet apps from reading text as a formula
    return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
  };
  const head = ['Shipment', 'Watch no.', 'Watch', 'Reference', 'Serial', 'Client no.', 'Client', 'Collected', 'From', 'To', 'Status', 'Courier', 'AWB', 'Delivered'];
  if (withCost) head.push('Cost', 'Paid from');
  const lines = [head.join(',')];
  for (const x of f.rows) {
    const row = [x.shipment_no, x.watch_no, x.watch, x.reference, x.serial, x.client_no, x.client_name, F.toLocalInput(x.collected_at).replace('T', ' '),
      x.origin, x.destination, x.status, x.courier, x.awb, x.delivered_at ? F.toLocalInput(x.delivered_at).replace('T', ' ') : ''];
    if (withCost) row.push(x.cost, x.paid_from);
    lines.push(row.map(esc).join(','));
  }
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="shipments-${f.tab}.csv"` });
  res.send('﻿' + lines.join('\r\n'));
});

// ---------- create / edit ----------
function readShipmentForm(body) {
  const std = list(body.acc);
  const accessories = F.STD_ACCESSORIES.map((label) => ({ label, ok: std.includes(label) }));
  for (const extra of s(body.acc_other).split(',').map((x) => x.trim()).filter(Boolean)) accessories.push({ label: extra, ok: true });
  const collected = s(body.collected_at) ? new Date(s(body.collected_at)) : new Date();
  return {
    client_id: Number(body.client_id) || 0,
    watch: s(body.watch), reference: s(body.reference), serial: s(body.serial), watch_date: s(body.watch_date),
    value: num(body.value), insurance: s(body.insurance), accessories,
    origin: s(body.origin), destination: s(body.destination),
    addr_name: s(body.addr_name), addr_lines: s(body.addr_lines), addr_phone: s(body.addr_phone), addr_note: s(body.addr_note),
    collected_at: Number.isNaN(collected.getTime()) ? D.now() : collected.toISOString(),
    collected_from: s(body.collected_from), eta_note: s(body.eta_note),
    courier: s(body.courier), awb: s(body.awb), cost: num(body.cost),
    paid_from: F.PAID_FROM.includes(body.paid_from) ? body.paid_from : '', request_id: Number(body.request_id) || 0
  };
}
function validateShipment(v) {
  const client = v.client_id && D.getUser(v.client_id);
  if (!client || client.role !== 'client') return 'Choose the client this watch belongs to.';
  if (!v.watch) return 'Enter the watch (brand and model).';
  if (Number.isNaN(v.value)) return 'Declared value must be a number.';
  if (Number.isNaN(v.cost)) return 'Shipment cost must be a number.';
  return null;
}
function shipmentForm(res, { sh, v, error }, status = 200) {
  const clients = db.prepare("SELECT id, name, number, city FROM users WHERE role = 'client' ORDER BY name").all();
  res.status(status).render('admin/shipment_form', { title: sh ? 'Edit watch' : 'New shipment', nav: 'shipments', sh, v, error, clients, numbering: D.numbering() });
}

r.get('/shipments/new', editor, (req, res) => {
  const v = { accessories: [], client_id: Number(req.query.client) || 0, collected_at: D.now() };
  const rq = Number(req.query.request) && db.prepare("SELECT * FROM requests WHERE id = ? AND status = 'open'").get(Number(req.query.request));
  if (rq) Object.assign(v, { client_id: rq.client_id, watch: rq.watch, collected_at: rq.preferred_at, collected_from: rq.address.split('\n')[0], request_id: rq.id });
  shipmentForm(res, { sh: null, v, error: null });
});
r.post('/shipments', editor, (req, res) => {
  const v = readShipmentForm(req.body);
  const error = validateShipment(v);
  if (error) return shipmentForm(res, { sh: null, v, error }, 400);
  const id = D.createShipment(v, req.user.name);
  const cost = req.user.role === 'admin' ? v.cost : null; // only admins set costs
  db.prepare('UPDATE shipments SET courier = ?, awb = ?, cost = ?, paid_from = ? WHERE id = ?').run(v.courier, v.awb, cost, cost === null ? '' : v.paid_from, id);
  if (v.request_id) db.prepare("UPDATE requests SET status = 'done' WHERE id = ? AND client_id = ?").run(v.request_id, v.client_id);
  res.flash('Shipment created. Watch and shipment numbers have been issued.');
  res.redirect(`/admin/shipments/${id}`);
});

r.get('/shipments/:id', (req, res, next) => {
  const d = D.shipmentDetail(Number(req.params.id));
  if (!d) return next();
  res.render('shipment', { title: d.sh.watch, nav: 'shipments', ...d, staffView: true });
});

r.get('/shipments/:id/edit', editor, (req, res, next) => {
  const sh = getShipment(req);
  if (!sh) return next();
  let accessories = [];
  try { accessories = JSON.parse(sh.accessories); } catch { /* keep empty */ }
  shipmentForm(res, { sh, v: { ...sh, accessories }, error: null });
});
r.post('/shipments/:id/edit', editor, (req, res, next) => {
  const sh = getShipment(req);
  if (!sh) return next();
  const v = readShipmentForm(req.body);
  const error = validateShipment(v);
  if (error) return shipmentForm(res, { sh, v, error }, 400);
  D.tx(() => {
    db.prepare(`UPDATE shipments SET client_id=?, watch=?, reference=?, serial=?, watch_date=?, value=?, insurance=?, accessories=?,
      origin=?, destination=?, addr_name=?, addr_lines=?, addr_phone=?, addr_note=?, collected_at=?, eta_note=? WHERE id=?`).run(
      v.client_id, v.watch, v.reference, v.serial, v.watch_date, v.value, v.insurance, JSON.stringify(v.accessories),
      v.origin, v.destination, v.addr_name, v.addr_lines, v.addr_phone, v.addr_note, v.collected_at, v.eta_note, sh.id);
    // Keep the first tracking entry in step with the collection date.
    const first = db.prepare('SELECT id FROM events WHERE shipment_id = ? ORDER BY created_at, id LIMIT 1').get(sh.id);
    if (first) db.prepare('UPDATE events SET created_at = ? WHERE id = ?').run(v.collected_at, first.id);
  });
  res.flash('Watch details saved.');
  res.redirect(`/admin/shipments/${sh.id}`);
});

// ---------- tracking updates ----------
r.post('/shipments/:id/events', (req, res, next) => {
  const sh = getShipment(req);
  if (!sh) return next();
  const status = s(req.body.status);
  const fromPortal = s(req.body.back) === 'update';
  if (!F.STATUSES.includes(status)) {
    res.flash('Choose a status.', 'err');
  } else {
    D.addEvent(sh.id, { status, location: s(req.body.location), note: s(req.body.note), signed_by: s(req.body.signed_by) }, req.user.name);
    res.flash(`Update posted: ${sh.watch_no} is now ${status}. The client can see it.`);
  }
  res.redirect(fromPortal ? '/admin/update' : `/admin/shipments/${sh.id}`);
});
r.post('/shipments/:id/events/undo', editor, (req, res, next) => {
  const sh = getShipment(req);
  if (!sh) return next();
  res.flash(D.undoLastEvent(sh.id) ? 'Last update removed.' : 'There is no update to remove.');
  res.redirect(`/admin/shipments/${sh.id}`);
});

// Phone-sized update portal for couriers and staff on the move.
r.get('/update', (req, res) => {
  const w = s(req.query.w);
  const found = w ? D.listShipments({ q: w })[0] : null;
  const recent = db.prepare(`SELECT e.*, s.watch_no, s.id AS sid FROM events e JOIN shipments s ON s.id = e.shipment_id
    WHERE e.by_name = ? ORDER BY e.created_at DESC, e.id DESC LIMIT 6`).all(req.user.name);
  res.render('admin/update', { title: 'Update portal', nav: 'update', w, found, recent });
});

// ---------- photos and documents ----------
r.post('/shipments/:id/photos', editor, photoUpload.array('photos', 12), (req, res, next) => {
  const sh = getShipment(req);
  const files = req.files || [];
  if (!sh) { files.forEach((f) => removeFile(f.filename)); return next(); }
  for (const f of files) {
    db.prepare('INSERT INTO photos(shipment_id, label, filename, mime, created_at) VALUES(?,?,?,?,?)').run(sh.id, s(req.body.label), f.filename, f.mimetype, D.now());
  }
  res.flash(files.length ? 'Picture added.' : 'No picture added. Use JPG, PNG or WebP images.', files.length ? 'ok' : 'err');
  res.redirect(`/admin/shipments/${sh.id}`);
});
r.post('/photos/:id/delete', editor, (req, res, next) => {
  const p = db.prepare('SELECT * FROM photos WHERE id = ?').get(Number(req.params.id));
  if (!p) return next();
  db.prepare('DELETE FROM photos WHERE id = ?').run(p.id);
  removeFile(p.filename);
  res.flash('Picture removed.');
  res.redirect(`/admin/shipments/${p.shipment_id}`);
});
r.post('/shipments/:id/docs', editor, docUpload.single('doc'), (req, res, next) => {
  const sh = getShipment(req);
  if (!sh) { if (req.file) removeFile(req.file.filename); return next(); }
  if (req.file) {
    const name = s(req.body.name) || path.parse(req.file.originalname).name;
    db.prepare('INSERT INTO docs(shipment_id, name, filename, mime, size, created_at) VALUES(?,?,?,?,?,?)').run(sh.id, name, req.file.filename, req.file.mimetype, req.file.size, D.now());
    res.flash('Document added. The client can download it.');
  } else {
    res.flash('No document added. Use a PDF or an image.', 'err');
  }
  res.redirect(`/admin/shipments/${sh.id}#docs`);
});
r.post('/docs/:id/delete', editor, (req, res, next) => {
  const d = db.prepare('SELECT * FROM docs WHERE id = ?').get(Number(req.params.id));
  if (!d) return next();
  db.prepare('DELETE FROM docs WHERE id = ?').run(d.id);
  removeFile(d.filename);
  res.flash('Document removed.');
  res.redirect(`/admin/shipments/${d.shipment_id}#docs`);
});

r.get('/shipments/:id/print', (req, res, next) => {
  const d = D.shipmentDetail(Number(req.params.id));
  if (!d) return next();
  res.render('print', { title: `Print ${d.sh.shipment_no}`, ...d, first: d.events[d.events.length - 1], auto: req.query.auto === '1' });
});

// ---------- watches ----------
r.get('/watches', (req, res) => {
  const q = s(req.query.q);
  const rows = D.listShipments({ q });
  const tabs = {
    all: rows, withus: rows.filter((x) => ['Collected', 'Packed'].includes(x.status)),
    transit: rows.filter((x) => F.isMoving(x.status)), delivered: rows.filter((x) => F.isClosed(x.status))
  };
  const tab = tabs[req.query.tab] ? req.query.tab : 'all';
  const w = s(req.query.w);
  const watch = w ? D.listShipments({ q: w })[0] : rows[0];
  let detail = null;
  if (watch) {
    const d = D.shipmentDetail(watch.id);
    detail = { photos: d.photos.slice(0, 3), accOk: d.accessories.filter((a) => a.ok).length, accAll: d.accessories.length };
  }
  res.render('admin/watches', { title: 'Watches', nav: 'watches', q, w, tab, tabs, rows: tabs[tab], watch, detail, numbering: D.numbering() });
});

// ---------- clients (admin) ----------
function clientRows() {
  const all = D.listShipments();
  return db.prepare("SELECT * FROM users WHERE role = 'client' ORDER BY id").all().map((u) => {
    const mine = all.filter((x) => x.client_id === u.id);
    return {
      ...u, wallet: D.wallet(u.id),
      active: mine.filter((x) => !F.isClosed(x.status)).length,
      delivered: mine.filter((x) => x.status === 'Delivered').length,
      spent: sum(mine.filter((x) => x.cost !== null), (x) => x.cost),
      state: u.status === 'suspended' ? 'Suspended' : u.last_login ? 'Active' : 'Invited'
    };
  });
}
r.get('/clients', admin, (req, res) => {
  const q = s(req.query.q).toLowerCase();
  const everyone = clientRows();
  const found = everyone.filter((u) => !q || [u.name, u.email, u.number, u.city].some((x) => x.toLowerCase().includes(q)));
  const tabs = { all: found, active: found.filter((u) => u.active > 0), low: found.filter((u) => u.wallet.available < 0) };
  const tab = tabs[req.query.tab] ? req.query.tab : 'all';
  const top = everyone.filter((u) => u.spent > 0).sort((a, b) => b.spent - a.spent).slice(0, 4);
  res.render('admin/clients', {
    title: 'Clients', nav: 'clients', q: s(req.query.q), tab, tabs, rows: tabs[tab], top, topMax: top.length ? top[0].spent : 1,
    low: everyone.filter((u) => u.wallet.available < 0), numbering: D.numbering(),
    kpi: {
      clients: everyone.length, withActive: everyone.filter((u) => u.active > 0).length, moving: sum(everyone, (u) => u.active),
      low: everyone.filter((u) => u.wallet.available < 0).length, spent: sum(everyone, (u) => u.spent), shipments: sum(everyone, (u) => u.active + u.delivered)
    }
  });
});

// ---------- costs (admin) ----------
r.get('/costs', admin, (req, res) => {
  const all = D.listShipments();
  const month = monthStart();
  const billed = all.filter((x) => x.cost !== null && new Date(x.collected_at) >= month);
  const billedSum = sum(billed, (x) => x.cost);
  const walletSum = sum(billed.filter((x) => x.paid_from === 'Wallet'), (x) => x.cost);
  const pick = Number(req.query.s) || null;
  res.render('admin/costs', {
    title: 'Shipment costs', nav: 'costs', month: monthName(), billed: billed.slice(0, 10), billedCount: billed.length, billedSum, walletSum,
    waiting: all.filter((x) => x.cost === null), pick,
    avg: billed.length ? billedSum / billed.length : null,
    options: all.filter((x) => !F.isClosed(x.status) || x.cost === null || x.id === pick).sort((a, b) => (a.cost === null ? 0 : 1) - (b.cost === null ? 0 : 1))
  });
});
r.post('/cost', admin, (req, res) => {
  const sh = db.prepare('SELECT * FROM shipments WHERE id = ?').get(Number(req.body.shipment_id));
  const cost = num(req.body.cost);
  const back = s(req.body.back) === 'shipment' && sh ? `/admin/shipments/${sh.id}` : '/admin/costs';
  if (!sh || cost === null || Number.isNaN(cost)) {
    res.flash('Choose a shipment and enter a valid cost.', 'err');
    return res.redirect(back);
  }
  // The quick-entry rows send only the amount, so courier and AWB stay as they were unless given.
  const keep = (field) => (req.body[field] === undefined ? sh[field] : s(req.body[field]));
  const paid = F.PAID_FROM.includes(req.body.paid_from) ? req.body.paid_from : sh.paid_from;
  db.prepare('UPDATE shipments SET cost = ?, courier = ?, awb = ?, paid_from = ? WHERE id = ?').run(cost, keep('courier'), keep('awb'), paid, sh.id);
  res.flash(`Cost saved: ${sh.shipment_no}, ${F.money(cost, res.locals.cur)}.`);
  res.redirect(back);
});

// ---------- reports ----------
r.get('/reports', editor, (req, res) => {
  const everything = D.listShipments();
  const months = [...new Set(everything.map((x) => F.toLocalInput(x.collected_at).slice(0, 7)))].sort().reverse();
  const period = months.includes(req.query.m) ? req.query.m : 'all';
  const rows = period === 'all' ? everything : everything.filter((x) => F.toLocalInput(x.collected_at).slice(0, 7) === period);
  const ids = new Set(rows.map((x) => x.id));
  const events = db.prepare('SELECT shipment_id, status, created_at FROM events ORDER BY shipment_id, created_at, id').all().filter((e) => ids.has(e.shipment_id));

  const STAGES = [['Collected to packed', ['Collected']], ['Packed to courier', ['Packed']], ['Courier to in transit', ['Handed to courier']],
    ['In transit', ['In transit', 'Customs hold']], ['Out for delivery to delivered', ['Out for delivery']]];
  const total = {}, count = {};
  const held = new Set();
  events.forEach((e, i) => {
    if (e.status === 'Customs hold') held.add(e.shipment_id);
    const nx = events[i + 1];
    if (!nx || nx.shipment_id !== e.shipment_id) return;
    const stage = STAGES.find(([, st]) => st.includes(e.status));
    if (!stage) return;
    total[stage[0]] = (total[stage[0]] || 0) + (ms(nx.created_at) - ms(e.created_at));
    count[stage[0]] = (count[stage[0]] || 0) + 1;
  });
  const stages = STAGES.map(([name]) => ({ name, avg: count[name] ? total[name] / count[name] : 0 }));
  const stageMax = Math.max(...stages.map((x) => x.avg), 1);

  const delivered = rows.filter((x) => x.status === 'Delivered' && x.delivered_at).map((x) => ({ ...x, took: ms(x.delivered_at) - ms(x.collected_at) }));
  const fastest = delivered.slice().sort((a, b) => a.took - b.took)[0];
  const open = everything.filter((x) => !F.isClosed(x.status)).map((x) => {
    const last = db.prepare('SELECT status, location, created_at FROM events WHERE shipment_id = ? ORDER BY created_at DESC, id DESC LIMIT 1').get(x.id);
    return { ...x, stuck: Date.now() - ms(last.created_at), open: Date.now() - ms(x.collected_at), where: last.location };
  });
  const byCourier = {};
  for (const x of rows) {
    const c = byCourier[x.courier || 'Not booked'] ||= { n: 0, took: [], holds: 0, costs: [] };
    c.n++;
    if (held.has(x.id)) c.holds++;
    if (x.cost !== null) c.costs.push(x.cost);
    const d = delivered.find((y) => y.id === x.id);
    if (d) c.took.push(d.took);
  }
  const avgOf = (a) => (a.length ? sum(a, (x) => x) / a.length : null);
  const week = [];
  for (let i = 6; i >= 0; i--) {
    const d = dayStart(); d.setDate(d.getDate() - i);
    const e = new Date(d); e.setDate(e.getDate() + 1);
    week.push({ label: d.toLocaleDateString('en-GB', { weekday: 'short' }), n: everything.filter((x) => new Date(x.collected_at) >= d && new Date(x.collected_at) < e).length, today: i === 0 });
  }
  res.render('admin/reports', {
    title: 'Reports', nav: 'reports', months, period, stages, stageMax, week, weekMax: Math.max(...week.map((x) => x.n), 1),
    kpi: {
      avg: delivered.length ? F.dur(avgOf(delivered.map((x) => x.took))) : '—', deliveredCount: delivered.length, fastest,
      longest: open.slice().sort((a, b) => b.open - a.open)[0], total: rows.length,
      billed: sum(rows.filter((x) => x.cost !== null), (x) => x.cost), holds: rows.filter((x) => held.has(x.id)).length
    },
    couriers: Object.entries(byCourier).map(([name, c]) => ({ name, n: c.n, avg: avgOf(c.took), holds: c.holds, cost: avgOf(c.costs) })).sort((a, b) => b.n - a.n),
    slowest: open.sort((a, b) => b.stuck - a.stuck).slice(0, 3)
  });
});

// ---------- collection requests from clients ----------
r.post('/requests/:id/dismiss', editor, (req, res) => {
  db.prepare("UPDATE requests SET status = 'dismissed' WHERE id = ? AND status = 'open'").run(Number(req.params.id));
  res.flash('Collection request closed.');
  res.redirect('/admin');
});

// ---------- users, sessions, numbering (admin only) ----------
function usersView(req, res, extra = {}, status = 200) {
  const role = ['admin', 'staff', 'courier', 'client'].includes(req.query.role) ? req.query.role : 'all';
  const q = s(req.query.q);
  const everyone = db.prepare(`SELECT u.*, (SELECT COUNT(*) FROM sessions x WHERE x.user_id = u.id AND x.expires_at > ?) AS session_count
    FROM users u ORDER BY CASE u.role WHEN 'admin' THEN 0 WHEN 'staff' THEN 1 WHEN 'courier' THEN 2 ELSE 3 END, u.id`).all(D.now());
  const counts = { all: everyone.length, admin: 0, staff: 0, courier: 0, client: 0 };
  for (const u of everyone) counts[u.role]++;
  const ql = q.toLowerCase();
  const rows = everyone.filter((u) => (role === 'all' || u.role === role) && (!q || [u.name, u.email, u.number].some((x) => x.toLowerCase().includes(ql))));
  const sessions = A.activeSessions();
  res.status(status).render('admin/users', {
    title: 'Users and logins', nav: 'users', role, q, rows, counts, sessions, currentSession: req.sessionId,
    online: new Set(sessions.filter((x) => A.isOnline(x.last_seen)).map((x) => x.user_id)).size,
    numbering: D.numbering(), error: null, v: { role: s(req.query.add) }, ...extra
  });
}
r.get('/users', admin, (req, res) => usersView(req, res));

r.post('/users', admin, (req, res) => {
  const v = { name: s(req.body.name), email: s(req.body.email), role: s(req.body.role), phone: s(req.body.phone), city: s(req.body.city), address: s(req.body.address) };
  let error = null;
  if (!v.name || !/^\S+@\S+\.\S+$/.test(v.email)) error = 'Enter a name and a valid email.';
  else if (!F.ROLE_LABEL[v.role]) error = 'Choose a role.';
  else if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(v.email)) error = 'An account with this email already exists.';
  if (error) return usersView(req, res, { error, v }, 400);
  const temp = P.tempPassword();
  const user = D.createUser({ ...v, password: temp, mustChange: true });
  userView(res, user.id, { temp });
});

function userView(res, id, extra = {}, status = 200) {
  const u = D.getUser(id);
  const topups = u.role === 'client' ? db.prepare('SELECT * FROM topups WHERE client_id = ? ORDER BY id DESC').all(u.id) : [];
  res.status(status).render('admin/user_edit', {
    title: u.name, nav: u.role === 'client' ? 'clients' : 'users', u, topups, wallet: u.role === 'client' ? D.wallet(u.id) : null,
    shipments: u.role === 'client' ? D.listShipments({ clientId: u.id }).slice(0, 8) : [],
    sessions: A.activeSessions().filter((x) => x.user_id === u.id), temp: null, error: null, ...extra
  });
}
const adminCount = () => db.prepare("SELECT COUNT(*) n FROM users WHERE role = 'admin' AND status = 'active'").get().n;

r.get('/users/:id', admin, (req, res, next) => {
  if (!D.getUser(Number(req.params.id))) return next();
  userView(res, Number(req.params.id));
});
r.post('/users/:id', admin, (req, res, next) => {
  const u = D.getUser(Number(req.params.id));
  if (!u) return next();
  const v = { name: s(req.body.name), email: s(req.body.email), phone: s(req.body.phone), city: s(req.body.city), address: s(req.body.address) };
  const status = req.body.status === 'suspended' ? 'suspended' : 'active';
  let error = null;
  if (!v.name || !/^\S+@\S+\.\S+$/.test(v.email)) error = 'Enter a name and a valid email.';
  else if (db.prepare('SELECT 1 FROM users WHERE email = ? AND id <> ?').get(v.email, u.id)) error = 'Another account already uses this email.';
  else if (status === 'suspended' && u.id === req.user.id) error = 'You cannot suspend your own account.';
  else if (status === 'suspended' && u.role === 'admin' && u.status === 'active' && adminCount() <= 1) error = 'At least one active admin is required.';
  if (error) return userView(res, u.id, { error }, 400);
  db.prepare('UPDATE users SET name=?, email=?, phone=?, city=?, address=?, status=? WHERE id=?').run(v.name, v.email, v.phone, v.city, v.address, status, u.id);
  if (status === 'suspended') db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
  res.flash('User saved.');
  res.redirect(`/admin/users/${u.id}`);
});
r.post('/users/:id/reset', admin, (req, res, next) => {
  const u = D.getUser(Number(req.params.id));
  if (!u) return next();
  const temp = P.tempPassword();
  db.prepare('UPDATE users SET pw_hash = ?, must_change = 1 WHERE id = ?').run(P.hashPw(temp), u.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND id <> ?').run(u.id, req.sessionId);
  userView(res, u.id, { temp });
});
r.post('/users/:id/topup', admin, (req, res, next) => {
  const u = D.getUser(Number(req.params.id));
  if (!u || u.role !== 'client') return next();
  const amount = Number(s(req.body.amount).replace(/,/g, ''));
  if (!Number.isFinite(amount) || amount === 0) {
    res.flash('Enter a top-up amount (use a negative amount to correct a mistake).', 'err');
  } else {
    db.prepare('INSERT INTO topups(client_id, amount, note, by_name, created_at) VALUES(?,?,?,?,?)').run(u.id, amount, s(req.body.note), req.user.name, D.now());
    res.flash(`Wallet updated: ${F.money(amount, res.locals.cur)}.`);
  }
  res.redirect(`/admin/users/${u.id}#wallet`);
});

r.post('/sessions/:id/end', admin, (req, res) => {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(req.params.id);
  if (req.params.id === req.sessionId) return res.redirect('/login');
  res.flash('Session ended. That device is signed out.');
  res.redirect(s(req.body.back).startsWith('/admin/users/') ? s(req.body.back) : '/admin/users');
});

r.post('/settings', admin, (req, res) => {
  const prefix = (v, fallback) => s(v).toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 6) || fallback;
  D.setSetting('prefix_client', prefix(req.body.prefix_client, 'CL-'));
  D.setSetting('prefix_watch', prefix(req.body.prefix_watch, 'WT-'));
  D.setSetting('prefix_shipment', prefix(req.body.prefix_shipment, 'SH-'));
  if (F.CURRENCIES.includes(req.body.currency)) D.setSetting('currency', req.body.currency);
  if (s(req.body.company_name)) D.setSetting('company_name', s(req.body.company_name).slice(0, 60));
  D.setSetting('sender_address', s(req.body.sender_address).slice(0, 400));
  res.flash('Settings saved. New prefixes apply to numbers issued from now on.');
  res.redirect('/admin/users#settings');
});

module.exports = r;
