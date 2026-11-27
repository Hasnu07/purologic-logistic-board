const express = require('express');
const path = require('path');
const D = require('./src/db');
const A = require('./src/auth');
const F = require('./src/format');

const app = express();
if (process.env.TRUST_PROXY) app.set('trust proxy', 1); // set when running behind an HTTPS reverse proxy
app.disable('x-powered-by');
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
Object.assign(app.locals, F);

app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'SAMEORIGIN', 'Referrer-Policy': 'same-origin' });
  next();
});
app.get('/healthz', (req, res) => res.type('text').send('ok')); // used by the host to check the app is up
app.use('/static', express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: false }));

// Forms may only be submitted from this site's own pages.
app.use((req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const source = req.get('origin') || req.get('referer');
  let ok = false;
  try { ok = !!source && new URL(source).host === req.get('host'); } catch { ok = false; }
  if (!ok) return res.status(403).send('Request blocked: it did not come from this site.');
  next();
});

app.use(A.load);

// One-off messages shown on the next page ("Cost saved", "Update posted", ...).
app.use((req, res, next) => {
  res.flash = (text, type = 'ok') => res.cookie('flash', JSON.stringify({ text, type }), { httpOnly: true, sameSite: 'lax', path: '/' });
  res.locals.flash = null;
  const raw = A.parseCookies(req).flash;
  if (raw) {
    try { res.locals.flash = JSON.parse(raw); } catch { /* ignore */ }
    res.clearCookie('flash', { path: '/' });
  }
  res.locals.settings = D.getSettings();
  res.locals.cur = res.locals.settings.currency;
  res.locals.nav = '';
  next();
});

app.use(require('./src/routes/auth'));
app.use('/files', require('./src/routes/files'));
app.use('/admin', require('./src/routes/admin'));
app.use('/client', require('./src/routes/client'));

app.use((req, res) => res.status(404).render('error', { title: 'Not found', message: 'That page does not exist.' }));
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const upload = err && err.name === 'MulterError';
  if (!upload) console.error(err);
  res.status(upload ? 400 : 500).render('error', {
    title: upload ? 'Upload problem' : 'Something went wrong',
    message: upload ? 'The file could not be uploaded (limit 15 MB per file).' : 'The action could not be completed. Please go back and try again.'
  });
});

A.purgeExpired();
setInterval(A.purgeExpired, 3600 * 1000).unref();

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`Logistic Board running at http://localhost:${port}`));
