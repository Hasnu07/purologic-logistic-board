// Shared pieces of the overview screens: the month calendar, the "today" list and the small trend line.
const { db } = require('./db');
const F = require('./format');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayKey = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const ym = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

// Month grid. A filled day has a delivery, a dotted day has a collection (or a requested one).
function calendar(shipments, requests, monthParam) {
  const now = new Date();
  const m = /^(\d{4})-(\d{2})$/.exec(monthParam || '');
  const first = m ? new Date(Number(m[1]), Number(m[2]) - 1, 1) : new Date(now.getFullYear(), now.getMonth(), 1);
  const due = new Set();
  const col = new Set();
  for (const s of shipments) {
    col.add(dayKey(new Date(s.collected_at)));
    if (s.delivered_at) due.add(dayKey(new Date(s.delivered_at)));
  }
  for (const r of requests) col.add(dayKey(new Date(r.preferred_at)));
  const days = [];
  const cursor = new Date(first);
  cursor.setDate(1 - first.getDay());
  do {
    for (let i = 0; i < 7; i++) {
      const k = dayKey(cursor);
      days.push({
        n: cursor.getDate(),
        cls: [cursor.getMonth() !== first.getMonth() ? 'other' : '', k === dayKey(now) ? 'today' : '', due.has(k) ? 'due' : '', col.has(k) ? 'col' : ''].filter(Boolean).join(' ')
      });
      cursor.setDate(cursor.getDate() + 1);
    }
  } while (cursor.getMonth() === first.getMonth());
  const isThisMonth = ym(first) === ym(now);
  return {
    days, isThisMonth,
    title: isThisMonth ? `${MONTHS[now.getMonth()]}, ${now.getDate()}` : `${MONTHS[first.getMonth()]} ${first.getFullYear()}`,
    weekday: isThisMonth ? now.toLocaleDateString('en-GB', { weekday: 'long' }) : '',
    prev: ym(new Date(first.getFullYear(), first.getMonth() - 1, 1)),
    next: ym(new Date(first.getFullYear(), first.getMonth() + 1, 1))
  };
}

// Everything that happened today (tracking updates), plus collections requested for today.
function today(clientId, requests, base) {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const end = new Date(start); end.setDate(end.getDate() + 1);
  const rows = db.prepare(`SELECT e.*, s.id AS sid, s.shipment_no, s.watch, s.watch_no,
      (SELECT COUNT(*) FROM watches w WHERE w.shipment_id = s.id) AS watch_count FROM events e JOIN shipments s ON s.id = e.shipment_id
    WHERE e.created_at >= ? AND e.created_at < ? ${clientId ? 'AND s.client_id = ?' : ''} ORDER BY e.created_at DESC LIMIT 12`)
    .all(start.toISOString(), end.toISOString(), ...(clientId ? [clientId] : []));
  const items = rows.map((e) => ({
    at: e.created_at, time: F.fmtTime(e.created_at), tone: F.toneClass(e.status),
    icon: F.stepOf(e.status) === 1 ? 'truck' : e.status === 'Delivered' ? 'check' : F.isMoving(e.status) ? 'briefcase' : 'pin',
    title: `${e.status}: ${e.watch}${e.watch_count > 1 ? ' + ' + (e.watch_count - 1) + ' more' : ''}`, sub: [e.shipment_no, e.location].filter(Boolean).join(', '), href: `${base}/shipments/${e.sid}`
  }));
  for (const r of requests) {
    const at = new Date(r.preferred_at);
    if (at >= start && at < end) {
      items.push({ at: r.preferred_at, time: F.fmtTime(r.preferred_at), tone: 'note note-coral', icon: 'truck', title: `Collection requested: ${r.watch_label || r.watch}`, sub: [r.client_no, r.address.split('\n')[0]].filter(Boolean).join(', '), href: null });
    }
  }
  return items.sort((a, b) => a.at.localeCompare(b.at));
}

// Points for the small trend line: shipping cost per day over the last 14 days.
function spark(shipments) {
  const days = 14;
  const sums = new Array(days).fill(0);
  const start = new Date(); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - (days - 1));
  for (const s of shipments) {
    if (s.cost === null) continue;
    const i = Math.floor((new Date(s.collected_at) - start) / 86400000);
    if (i >= 0 && i < days) sums[i] += s.cost;
  }
  const max = Math.max(...sums, 1);
  return sums.map((v, i) => `${(2 + (i * 136) / (days - 1)).toFixed(1)},${(42 - (v / max) * 34).toFixed(1)}`).join(' ');
}

module.exports = { calendar, today, spark };
