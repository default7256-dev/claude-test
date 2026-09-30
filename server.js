'use strict';
/*
 * Excel Easy web server.
 *  - serves the free site from ./public
 *  - sells a £5/month subscription through Stripe Checkout
 *  - serves the Premium code/content (./premium) ONLY to active subscribers
 *  - passwordless sign-in for returning subscribers (emailed one-time link)
 * Stripe is the single source of truth for who is subscribed: no database needed.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' };
const COOKIE = 'ee_session';
const SESSION_DAYS = 30;
const LOGIN_MINUTES = 15;
const PREMIUM_FILES = ['engine.js', 'data.js', 'app.js']; // order matters

const b64u = (b) => Buffer.from(b).toString('base64url');
function sign(secret, payload) {
  const body = b64u(JSON.stringify(payload));
  const mac = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return body + '.' + mac;
}
function verify(secret, token) {
  if (typeof token !== 'string') return null;
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  const expect = crypto.createHmac('sha256', secret).update(body).digest();
  let given; try { given = Buffer.from(mac, 'base64url'); } catch (e) { return null; }
  if (given.length !== expect.length || !crypto.timingSafeEqual(given, expect)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    return p.exp && p.exp > Date.now() ? p : null;
  } catch (e) { return null; }
}

function createApp(opts) {
  const { stripe, sendEmail } = opts;
  const cfg = Object.assign({ publicDir: path.join(__dirname, 'public'), premiumDir: path.join(__dirname, 'premium'), priceId: '', tax: false, baseUrl: 'http://localhost:3000' }, opts.config);
  if (!cfg.secret) throw new Error('config.secret is required');
  const secure = cfg.baseUrl.startsWith('https://');
  const subCache = new Map(); // customerId -> { ok, at }
  const hits = new Map();     // ip -> [timestamps] (login rate limit)
  let premiumBundle = null;

  const isActive = (s) => s.status === 'active' || s.status === 'trialing';
  async function hasActiveSub(customerId) {
    const c = subCache.get(customerId);
    if (c && Date.now() - c.at < 5 * 60 * 1000) return c.ok;
    const subs = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 20 });
    const ok = subs.data.some(isActive);
    subCache.set(customerId, { ok, at: Date.now() });
    return ok;
  }
  async function findSubscriberByEmail(email) {
    const custs = await stripe.customers.list({ email, limit: 10 });
    for (const c of custs.data) if (await hasActiveSub(c.id)) return c;
    return null;
  }

  const parseCookies = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map((x) => x.trim().split('=')).filter((x) => x[0]).map(([k, ...v]) => [k, v.join('=')]));
  const sessionFrom = (req) => verify(cfg.secret, parseCookies(req)[COOKIE]);
  const setSession = (res, customerId) => {
    const tok = sign(cfg.secret, { typ: 'session', cid: customerId, exp: Date.now() + SESSION_DAYS * 864e5 });
    res.setHeader('Set-Cookie', `${COOKIE}=${tok}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure ? '; Secure' : ''}`);
  };
  const clearSession = (res) => res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`);

  function baseHeaders(res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'self' https://checkout.stripe.com https://billing.stripe.com; frame-ancestors 'none'; base-uri 'none'");
    if (secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  }
  const json = (res, code, obj) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(obj)); };
  const redirect = (res, url) => { res.statusCode = 303; res.setHeader('Location', url); res.end(); };
  function readBody(req) {
    return new Promise((resolve, reject) => {
      let n = 0; const chunks = [];
      req.on('data', (c) => { n += c.length; if (n > 10000) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
      req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}); } catch (e) { reject(new Error('bad json')); } });
      req.on('error', reject);
    });
  }
  const sameOrigin = (req) => {
    const o = req.headers.origin;
    return !o || o === new URL(cfg.baseUrl).origin || o === `http://${req.headers.host}` || o === `https://${req.headers.host}`;
  };

  function serveStatic(req, res, pathname) {
    if (pathname === '/') pathname = '/index.html';
    const file = path.normalize(path.join(cfg.publicDir, decodeURIComponent(pathname)));
    if (!file.startsWith(cfg.publicDir + path.sep)) { res.statusCode = 404; return res.end('Not found'); }
    fs.readFile(file, (err, data) => {
      if (err) { res.statusCode = 404; res.setHeader('Content-Type', 'text/plain'); return res.end('Not found'); }
      res.setHeader('Content-Type', MIME[path.extname(file)] || 'application/octet-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.end(data);
    });
  }
  function getPremiumBundle() {
    if (!premiumBundle) premiumBundle = PREMIUM_FILES.map((f) => fs.readFileSync(path.join(cfg.premiumDir, f), 'utf8')).join('\n;\n');
    return premiumBundle;
  }

  async function handleApi(req, res, url) {
    const route = req.method + ' ' + url.pathname;
    if (req.method === 'POST' && !sameOrigin(req)) return json(res, 403, { error: 'Bad origin' });

    if (route === 'GET /api/me') {
      const s = sessionFrom(req);
      let premium = false;
      if (s && s.typ === 'session') { try { premium = await hasActiveSub(s.cid); } catch (e) { premium = false; } }
      if (s && !premium) clearSession(res);
      return json(res, 200, { premium });
    }

    if (route === 'GET /api/premium.js') {
      const s = sessionFrom(req);
      let ok = false;
      if (s && s.typ === 'session') { try { ok = await hasActiveSub(s.cid); } catch (e) { ok = false; } }
      if (!ok) return json(res, 401, { error: 'Premium subscription required' });
      res.statusCode = 200; res.setHeader('Content-Type', MIME['.js']); res.setHeader('Cache-Control', 'private, no-store');
      return res.end(getPremiumBundle());
    }

    if (route === 'POST /api/checkout') {
      const params = {
        mode: 'subscription',
        line_items: [cfg.priceId
          ? { price: cfg.priceId, quantity: 1 }
          : { quantity: 1, price_data: { currency: 'gbp', unit_amount: 500, recurring: { interval: 'month' }, product_data: { name: 'Excel Easy Premium', description: 'All lessons, formula builder, practice sheet and formula checker' } } }],
        success_url: `${cfg.baseUrl}/api/checkout/complete?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${cfg.baseUrl}/?cancelled=1#home`,
        allow_promotion_codes: true,
        billing_address_collection: 'required',
      };
      if (cfg.tax) params.automatic_tax = { enabled: true };
      try {
        const session = await stripe.checkout.sessions.create(params);
        return json(res, 200, { url: session.url });
      } catch (e) { console.error('checkout error:', e.message); return json(res, 502, { error: 'Checkout is unavailable right now. Please try again shortly.' }); }
    }

    if (route === 'GET /api/checkout/complete') {
      const id = url.searchParams.get('session_id') || '';
      if (!/^cs_[A-Za-z0-9_]+$/.test(id)) return redirect(res, '/');
      try {
        const session = await stripe.checkout.sessions.retrieve(id);
        const paid = session.status === 'complete' && (session.payment_status === 'paid' || session.payment_status === 'no_payment_required');
        const cid = typeof session.customer === 'string' ? session.customer : session.customer && session.customer.id;
        if (paid && cid) {
          subCache.delete(cid);
          setSession(res, cid);
          return redirect(res, '/?welcome=1#practice');
        }
      } catch (e) { console.error('checkout complete error:', e.message); }
      return redirect(res, '/?cancelled=1#home');
    }

    if (route === 'POST /api/login') {
      const ip = req.socket.remoteAddress || 'x';
      const now = Date.now();
      const recent = (hits.get(ip) || []).filter((t) => now - t < 15 * 60 * 1000);
      if (recent.length >= 5) return json(res, 429, { error: 'Too many attempts. Please wait a few minutes and try again.' });
      recent.push(now); hits.set(ip, recent);
      let body; try { body = await readBody(req); } catch (e) { return json(res, 400, { error: 'Bad request' }); }
      const email = String(body.email || '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return json(res, 400, { error: 'Please enter a valid email address.' });
      // Same response whether or not the email is subscribed, so it can't be used to probe who is a customer.
      try {
        const cust = await findSubscriberByEmail(email);
        if (cust) {
          const tok = sign(cfg.secret, { typ: 'login', cid: cust.id, exp: Date.now() + LOGIN_MINUTES * 60000 });
          await sendEmail({ to: email, link: `${cfg.baseUrl}/api/login/verify?token=${encodeURIComponent(tok)}` });
        }
      } catch (e) { console.error('login error:', e.message); }
      return json(res, 200, { ok: true });
    }

    if (route === 'GET /api/login/verify') {
      const p = verify(cfg.secret, url.searchParams.get('token'));
      if (p && p.typ === 'login') {
        try {
          if (await hasActiveSub(p.cid)) { setSession(res, p.cid); return redirect(res, '/#home'); }
        } catch (e) { console.error(e.message); }
      }
      return redirect(res, '/?signin=failed#home');
    }

    if (route === 'POST /api/portal') {
      const s = sessionFrom(req);
      if (!s || s.typ !== 'session') return json(res, 401, { error: 'Please sign in first.' });
      try {
        const portal = await stripe.billingPortal.sessions.create({ customer: s.cid, return_url: cfg.baseUrl + '/' });
        return json(res, 200, { url: portal.url });
      } catch (e) { console.error('portal error:', e.message); return json(res, 502, { error: 'Billing page unavailable.' }); }
    }

    if (route === 'POST /api/logout') { clearSession(res); return json(res, 200, { ok: true }); }
    return json(res, 404, { error: 'Not found' });
  }

  return async function handler(req, res) {
    baseHeaders(res);
    try {
      const url = new URL(req.url, cfg.baseUrl);
      if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.statusCode = 405; return res.end('Method not allowed'); }
      if (url.pathname === '/healthz') { res.statusCode = 200; return res.end('ok'); }
      return serveStatic(req, res, url.pathname);
    } catch (e) {
      console.error(e);
      if (!res.headersSent) res.statusCode = 500;
      res.end('Server error');
    }
  };
}

/* Sends the sign-in email through Resend's HTTP API. Without an API key (local development) the link is logged instead. */
function makeEmailSender(env) {
  return async function sendEmail({ to, link }) {
    if (!env.RESEND_API_KEY) { console.log(`[dev] sign-in link for ${to}: ${link}`); return; }
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: env.EMAIL_FROM || 'Excel Easy <onboarding@resend.dev>',
        to: [to],
        subject: 'Your Excel Easy sign-in link',
        text: `Click to sign in to Excel Easy (valid for ${LOGIN_MINUTES} minutes):\n\n${link}\n\nIf you didn't ask for this, you can ignore this email.`,
      }),
    });
    if (!r.ok) throw new Error('email provider error ' + r.status);
  };
}

if (require.main === module) {
  const env = process.env;
  if (!env.STRIPE_SECRET_KEY) { console.error('STRIPE_SECRET_KEY is required. See README.md → "Going live".'); process.exit(1); }
  const baseUrl = (env.BASE_URL || `http://localhost:${env.PORT || 3000}`).replace(/\/$/, '');
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) {
    if (baseUrl.startsWith('https://')) { console.error('SESSION_SECRET (32+ random characters) is required in production.'); process.exit(1); }
    console.warn('SESSION_SECRET not set: using a temporary one (everyone is signed out on restart).');
  }
  const stripe = require('stripe')(env.STRIPE_SECRET_KEY);
  const app = createApp({
    stripe,
    sendEmail: makeEmailSender(env),
    config: { secret: env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'), baseUrl, priceId: env.STRIPE_PRICE_ID || '', tax: env.STRIPE_TAX === '1' },
  });
  const port = Number(env.PORT) || 3000;
  http.createServer(app).listen(port, () => console.log(`Excel Easy running at ${baseUrl} (port ${port})`));
}

module.exports = { createApp, sign, verify };
