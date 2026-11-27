// Sign in / out, first-run setup, and "my account".
const express = require('express');
const D = require('../db');
const { db } = D;
const A = require('../auth');
const P = require('../password');

const r = express.Router();
const s = (v) => (typeof v === 'string' ? v.trim() : '');

// Slows down password guessing: 10 failed attempts per address per 15 minutes.
const attempts = new Map();
function blocked(ip) {
  const a = attempts.get(ip);
  if (!a || Date.now() - a.since > 15 * 60000) return false;
  return a.count >= 10;
}
function failed(ip) {
  const a = attempts.get(ip);
  if (!a || Date.now() - a.since > 15 * 60000) attempts.set(ip, { count: 1, since: Date.now() });
  else a.count++;
}

r.get('/', (req, res) => {
  if (!D.userCount()) return res.redirect('/setup');
  res.redirect(req.user ? A.homeFor(req.user) : '/login');
});

// First run only: create the owner admin account.
r.get('/setup', (req, res) => {
  if (D.userCount()) return res.redirect('/login');
  res.render('setup', { title: 'Set up', error: null, v: {} });
});
r.post('/setup', (req, res) => {
  if (D.userCount()) return res.redirect('/login');
  const v = { name: s(req.body.name), email: s(req.body.email), company: s(req.body.company) };
  const pw = String(req.body.password || '');
  let error = null;
  if (!v.name || !/^\S+@\S+\.\S+$/.test(v.email)) error = 'Enter your name and a valid email.';
  else if (pw.length < 8) error = 'Choose a password of at least 8 characters.';
  else if (pw !== req.body.password2) error = 'The two passwords do not match.';
  if (error) return res.status(400).render('setup', { title: 'Set up', error, v });
  if (v.company) D.setSetting('company_name', v.company);
  const user = D.createUser({ role: 'admin', name: v.name, email: v.email, password: pw });
  A.createSession(req, res, user, false);
  res.redirect('/admin');
});

r.get('/login', (req, res) => {
  if (!D.userCount()) return res.redirect('/setup');
  if (req.user) return res.redirect(A.homeFor(req.user));
  res.render('login', { title: 'Sign in', error: null, email: '' });
});
r.post('/login', (req, res) => {
  const email = s(req.body.email);
  const fail = (msg, code = 401) => res.status(code).render('login', { title: 'Sign in', error: msg, email });
  if (blocked(req.ip)) return fail('Too many attempts. Please wait 15 minutes and try again.', 429);
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !P.checkPw(String(req.body.password || ''), user.pw_hash)) {
    failed(req.ip);
    return fail('Email or password is not correct.');
  }
  if (user.status !== 'active') return fail('This account is suspended. Please contact us.', 403);
  A.createSession(req, res, user, req.body.remember === 'on');
  res.redirect(user.must_change ? '/account' : A.homeFor(user));
});
r.post('/logout', (req, res) => {
  A.destroySession(req, res);
  res.redirect('/login');
});

// My account: change password, see and end my own sessions.
function accountView(req, res, error = null, status = 200) {
  const sessions = db.prepare('SELECT id, device, created_at, last_seen FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY last_seen DESC')
    .all(req.user.id, D.now());
  res.status(status).render('account', { title: 'My account', nav: 'account', error, sessions, currentSession: req.sessionId });
}
r.get('/account', A.requireUser, (req, res) => accountView(req, res));
r.post('/account/password', A.requireUser, (req, res) => {
  const current = String(req.body.current || '');
  const pw = String(req.body.password || '');
  if (!P.checkPw(current, req.user.pw_hash)) return accountView(req, res, 'Your current password is not correct.', 400);
  if (pw.length < 8) return accountView(req, res, 'Choose a new password of at least 8 characters.', 400);
  if (pw !== req.body.password2) return accountView(req, res, 'The two new passwords do not match.', 400);
  if (pw === current) return accountView(req, res, 'The new password must be different from the current one.', 400);
  db.prepare('UPDATE users SET pw_hash = ?, must_change = 0 WHERE id = ?').run(P.hashPw(pw), req.user.id);
  // Changing the password signs out every other device.
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND id <> ?').run(req.user.id, req.sessionId);
  res.flash('Password changed. Other devices were signed out.');
  res.redirect(A.homeFor(req.user));
});
r.post('/account/sessions/:id/end', A.requireUser, (req, res) => {
  db.prepare('DELETE FROM sessions WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  if (req.params.id === req.sessionId) return res.redirect('/login');
  res.flash('Session ended.');
  res.redirect('/account');
});

module.exports = r;
