// Display helpers. Everything exported here is available inside the views.

const STATUSES = ['Collected', 'Packed', 'Handed to courier', 'In transit', 'Customs hold', 'Out for delivery', 'Delivered', 'Returned to sender'];
const CLOSED = ['Delivered', 'Returned to sender'];
const isClosed = (status) => CLOSED.includes(status);
const CHIP = {
  'Collected': 'chip-amber', 'Packed': '', 'Handed to courier': 'chip-amber', 'In transit': 'chip-teal',
  'Out for delivery': 'chip-teal', 'Customs hold': 'chip-coral', 'Delivered': 'chip-soft2', 'Returned to sender': 'chip-coral-soft'
};
const chipClass = (status) => ('chip ' + (CHIP[status] || '')).trim();
// Colour of a tracking entry: coral for collection and holds, amber for handovers, teal while moving.
const TONE = { 'Collected': 'note-coral', 'Customs hold': 'note-coral', 'Returned to sender': 'note-coral', 'Handed to courier': 'note-amber', 'Packed': 'note-plain' };
const toneClass = (status) => ('note ' + (TONE[status] || '')).trim();
const MOVING = ['Handed to courier', 'In transit', 'Customs hold', 'Out for delivery'];
const isMoving = (status) => MOVING.includes(status);
const needsAttention = (s) => !isClosed(s.status) && (s.status === 'Customs hold' || s.cost === null);
const STEP = { 'Collected': 1, 'Packed': 2, 'Handed to courier': 3, 'In transit': 3, 'Customs hold': 3, 'Out for delivery': 4, 'Delivered': 5, 'Returned to sender': 5 };
const stepOf = (status) => STEP[status] || 1;
// The stage the update form offers by default after each status.
const NEXT_STATUS = {
  'Collected': 'Packed', 'Packed': 'Handed to courier', 'Handed to courier': 'In transit', 'In transit': 'Out for delivery',
  'Customs hold': 'In transit', 'Out for delivery': 'Delivered'
};

const STD_ACCESSORIES = ['Original box', 'Warranty card', 'Extra links', 'Hang tag', 'Travel pouch', 'Booklets'];
const PAID_FROM = ['Wallet', 'Card', 'Invoice', 'Cash'];
const COURIERS = ['Ferrari Group', "Brink's", 'Malca-Amit', 'DHL Express', 'FedEx'];
const CURRENCIES = ['USD', 'AED', 'EUR', 'GBP', 'CHF', 'HKD'];
const ROLE_LABEL = { admin: 'Admin', staff: 'Staff', courier: 'Courier', client: 'Client' };

function money(n, currency = 'USD') {
  if (n === null || n === undefined || n === '') return '—';
  const whole = Math.abs(n - Math.round(n)) < 0.005;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 }).format(n);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const two = (n) => String(n).padStart(2, '0');
function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
function fmtTime(iso) {
  const d = new Date(iso);
  return `${two(d.getHours())}:${two(d.getMinutes())}`;
}
function fmtDT(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const year = d.getFullYear() === new Date().getFullYear() ? '' : ' ' + d.getFullYear();
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${year} · ${fmtTime(iso)}`;
}
function toLocalInput(iso) {
  const d = iso ? new Date(iso) : new Date();
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}T${two(d.getHours())}:${two(d.getMinutes())}`;
}
function dur(ms) {
  const mins = Math.max(0, Math.round(ms / 60000));
  const d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60), m = mins % 60;
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}
function fileSize(bytes) {
  if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
  return Math.max(1, Math.round(bytes / 1024)) + ' KB';
}
const initials = (name) => String(name).split(/[\s.()]+/).filter(Boolean).map((p) => p[0]).join('').slice(0, 2).toUpperCase();
const route = (s) => [s.origin, s.destination].filter(Boolean).join(' to ') || '—';
const avClass = (id) => 'av ' + ['', 'av-coral', 'av-amber', 'av-teal'][Number(id) % 4];
const fmtDay = (iso) => { const d = new Date(iso); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; };

const ICONS = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  truck: '<path d="M3 7h11v8H3z"/><path d="M14 10h4l3 3v2h-7z"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17" cy="9" r="2.5"/><path d="M16 15.5a5 5 0 0 1 5.5 4.5"/>',
  cost: '<circle cx="12" cy="12" r="9"/><path d="M14.5 9.5a2.5 2.5 0 0 0-5 0c0 2.5 5 1.5 5 4a2.5 2.5 0 0 1-5 0M12 6v1.5M12 16.5V18"/>',
  watch: '<circle cx="12" cy="12" r="6"/><path d="M12 9v3l2 1M9 6.5 9.5 3h5l.5 3.5M9 17.5l.5 3.5h5l.5-3.5"/>',
  print: '<path d="M6 9V3h12v6M6 18H4a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2"/><rect x="6" y="14" width="12" height="7"/>',
  logout: '<path d="M10 17l5-5-5-5M15 12H3M13 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.5"/><path d="m21 16-5-5-8 8"/>',
  doc: '<path d="M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
  wallet: '<path d="M3 7a2 2 0 0 1 2-2h13v4"/><path d="M3 7v11a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1H5a2 2 0 0 1-2-2z"/><circle cx="16.5" cy="14" r="1.25"/>',
  pin: '<path d="M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11z"/><circle cx="12" cy="10" r="2"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  tick: '<path d="M5 12l5 5 9-10"/>',
  cross: '<path d="M6 6l12 12M18 6L6 18"/>',
  arrow: '<path d="M7 17 17 7M9 7h8v8"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  pencil: '<path d="M4 20h4l10-10-4-4L4 16z"/><path d="m13 7 4 4"/>',
  down: '<path d="m6 9 6 6 6-6"/>', left: '<path d="m15 6-6 6 6 6"/>', right: '<path d="m9 6 6 6-6 6"/>',
  briefcase: '<path d="M20 7H4a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1zM8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  download: '<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>',
  scissors: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12"/>'
};
function icon(name, size = 18, stroke = 2) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

// Code 39 barcode. Each character is 9 elements (bar, space, bar, ...), N = narrow, W = wide.
const C39 = {
  '0': 'NNNWWNWNN', '1': 'WNNWNNNNW', '2': 'NNWWNNNNW', '3': 'WNWWNNNNN', '4': 'NNNWWNNNW', '5': 'WNNWWNNNN',
  '6': 'NNWWWNNNN', '7': 'NNNWNNWNW', '8': 'WNNWNNWNN', '9': 'NNWWNNWNN', 'A': 'WNNNNWNNW', 'B': 'NNWNNWNNW',
  'C': 'WNWNNWNNN', 'D': 'NNNNWWNNW', 'E': 'WNNNWWNNN', 'F': 'NNWNWWNNN', 'G': 'NNNNNWWNW', 'H': 'WNNNNWWNN',
  'I': 'NNWNNWWNN', 'J': 'NNNNWWWNN', 'K': 'WNNNNNNWW', 'L': 'NNWNNNNWW', 'M': 'WNWNNNNWN', 'N': 'NNNNWNNWW',
  'O': 'WNNNWNNWN', 'P': 'NNWNWNNWN', 'Q': 'NNNNNNWWW', 'R': 'WNNNNNWWN', 'S': 'NNWNNNWWN', 'T': 'NNNNWNWWN',
  'U': 'WWNNNNNNW', 'V': 'NWWNNNNNW', 'W': 'WWWNNNNNN', 'X': 'NWNNWNNNW', 'Y': 'WWNNWNNNN', 'Z': 'NWWNWNNNN',
  '-': 'NWNNNNWNW', '.': 'WWNNNNWNN', ' ': 'NWWNNNWNN', '*': 'NWNNWNWNN'
};
function code39(text, height = 56) {
  const clean = String(text).toUpperCase().split('').filter((c) => c !== '*' && C39[c]).join('');
  let x = 0;
  let rects = '';
  for (const ch of '*' + clean + '*') {
    const pattern = C39[ch];
    for (let i = 0; i < 9; i++) {
      const w = pattern[i] === 'W' ? 3 : 1;
      if (i % 2 === 0) rects += `<rect x="${x}" y="0" width="${w}" height="${height}"/>`;
      x += w;
    }
    x += 1;
  }
  return `<svg class="barcode" viewBox="0 0 ${x} ${height}" preserveAspectRatio="none" role="img" aria-label="Barcode ${clean}" fill="#111">${rects}</svg>`;
}

module.exports = {
  STATUSES, CLOSED, isClosed, chipClass, toneClass, isMoving, needsAttention, avClass, fmtDay, stepOf, NEXT_STATUS, STD_ACCESSORIES, PAID_FROM, COURIERS, CURRENCIES, ROLE_LABEL,
  money, fmtDate, fmtTime, fmtDT, toLocalInput, dur, fileSize, initials, route, icon, code39
};
