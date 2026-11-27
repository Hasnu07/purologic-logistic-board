// Photos and documents are private: staff can open any, a client only those of their own shipments.
const express = require('express');
const path = require('path');
const D = require('../db');
const { db } = D;
const A = require('../auth');

const r = express.Router();
r.use(A.requireUser);

function send(table) {
  return (req, res, next) => {
    const row = db.prepare(`SELECT f.*, s.client_id FROM ${table} f JOIN shipments s ON s.id = f.shipment_id WHERE f.id = ?`).get(req.params.id);
    if (!row || (req.user.role === 'client' && row.client_id !== req.user.id)) return next();
    const headers = { 'Content-Type': row.mime, 'Cache-Control': 'private, max-age=3600' };
    if (table === 'docs') {
      const ext = path.extname(row.filename);
      const safe = row.name.replace(/[^\w .()-]+/g, '_');
      headers['Content-Disposition'] = `${row.mime === 'application/pdf' ? 'inline' : 'attachment'}; filename="${safe}${safe.toLowerCase().endsWith(ext) ? '' : ext}"`;
    }
    res.sendFile(row.filename, { root: D.UPLOADS, headers }, (err) => { if (err && !res.headersSent) next(); });
  };
}
r.get('/photo/:id', send('photos'));
r.get('/doc/:id', send('docs'));

// Pictures attached to a request, before it has become a shipment.
r.get('/reqphoto/:id', (req, res, next) => {
  const row = db.prepare('SELECT p.*, q.client_id FROM request_photos p JOIN requests q ON q.id = p.request_id WHERE p.id = ?').get(req.params.id);
  if (!row || (req.user.role === 'client' && row.client_id !== req.user.id)) return next();
  res.sendFile(row.filename, { root: D.UPLOADS, headers: { 'Content-Type': row.mime, 'Cache-Control': 'private, max-age=3600' } },
    (err) => { if (err && !res.headersSent) next(); });
});

module.exports = r;
