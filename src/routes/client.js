// Client portal: a client only ever sees their own shipments.
const express = require('express');
const D = require('../db');
const { db } = D;
const A = require('../auth');
const F = require('../format');
const B = require('../board');

const r = express.Router();
r.use(A.requireRole('client'));
const s = (v) => (typeof v === 'string' ? v.trim() : '');
const sum = (rows, f) => rows.reduce((a, x) => a + f(x), 0);

const docsFor = (clientId) => db.prepare(`SELECT d.*, s.shipment_no, s.watch, s.id AS sid FROM docs d JOIN shipments s ON s.id = d.shipment_id
  WHERE s.client_id = ? ORDER BY d.id DESC`).all(clientId);

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
    docs: docsFor(req.user.id).slice(0, 4), wallet: D.wallet(req.user.id), spark: B.spark(all),
    cal: B.calendar(all, requests, req.query.m), todayItems: B.today(req.user.id, requests, '/client')
  });
});

r.get('/shipments', (req, res) => {
  const q = s(req.query.q);
  const rows = D.listShipments({ clientId: req.user.id, q });
  const tabs = { active: rows.filter((x) => !F.isClosed(x.status)), delivered: rows.filter((x) => F.isClosed(x.status)), all: rows };
  const tab = tabs[req.query.tab] ? req.query.tab : 'active';
  res.render('client/shipments', { title: 'My shipments', nav: 'shipments', q, tab, tabs, rows: tabs[tab], requests: D.openRequests(req.user.id), error: null, v: {} });
});

r.post('/requests', (req, res) => {
  const watch = s(req.body.watch).slice(0, 120);
  const at = new Date(s(req.body.preferred_at));
  if (!watch || Number.isNaN(at.getTime())) {
    res.flash('Tell us which watch and when to collect it.', 'err');
  } else {
    db.prepare('INSERT INTO requests(client_id, watch, preferred_at, address, note, created_at) VALUES(?,?,?,?,?,?)')
      .run(req.user.id, watch, at.toISOString(), s(req.body.address).slice(0, 300) || req.user.address, s(req.body.note).slice(0, 300), D.now());
    res.flash('Collection requested. We will confirm it and you will see the watch here once it is collected.');
  }
  res.redirect('/client/shipments#request');
});
r.post('/requests/:id/cancel', (req, res) => {
  db.prepare("UPDATE requests SET status = 'dismissed' WHERE id = ? AND client_id = ? AND status = 'open'").run(Number(req.params.id), req.user.id);
  res.flash('Collection request cancelled.');
  res.redirect('/client/shipments#request');
});

r.get('/shipments/:id', (req, res, next) => {
  const d = D.shipmentDetail(Number(req.params.id));
  if (!d || d.sh.client_id !== req.user.id) return next();
  res.render('shipment', { title: d.sh.watch, nav: 'shipments', ...d, staffView: false });
});

r.get('/docs', (req, res) => {
  const groups = [];
  for (const d of docsFor(req.user.id)) {
    let g = groups.find((x) => x.sid === d.sid);
    if (!g) groups.push(g = { sid: d.sid, shipment_no: d.shipment_no, watch: d.watch, docs: [] });
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
    lines.push({ at: sh.delivered_at || sh.collected_at, what: (pending ? 'Pending: shipping, ' : 'Shipping, ') + sh.watch, ref: sh.shipment_no, amount: -sh.cost, pending });
  }
  lines.sort((a, b) => a.at.localeCompare(b.at));
  let running = 0;
  for (const l of lines) { running += l.amount; l.balance = running; }
  const costed = all.filter((x) => x.cost !== null);
  res.render('client/wallet', { title: 'Shipment wallet', nav: 'wallet', lines: lines.reverse(), wallet: D.wallet(req.user.id), spent: sum(costed, (x) => x.cost), count: costed.length });
});

module.exports = r;
