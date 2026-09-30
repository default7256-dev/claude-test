'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { createApp, sign } = require('../server.js');

function fakeStripe() {
  const s = {
    customers: { cus_sub: { id: 'cus_sub', email: 'paid@example.com' }, cus_old: { id: 'cus_old', email: 'lapsed@example.com' } },
    subs: { cus_sub: [{ status: 'active' }], cus_old: [{ status: 'canceled' }] },
    sessions: { cs_good: { status: 'complete', payment_status: 'paid', customer: 'cus_sub' }, cs_unpaid: { status: 'open', payment_status: 'unpaid', customer: 'cus_sub' } },
    created: [], portal: [], calls: 0,
  };
  return Object.assign(s, {
    customers_: {
      list: async ({ email }) => ({ data: Object.values(s.customers).filter((c) => c.email === email) }),
    },
  });
}
async function start(stripeState, sent = [], config = {}) {
  const st = stripeState;
  const stripe = {
    customers: st.customers_,
    subscriptions: {
      list: async (p) => {
        if (p.status === 'trialing') {
          const all = st.trialing || [];
          const from = p.starting_after ? all.findIndex((x) => x.id === p.starting_after) + 1 : 0;
          const page = all.slice(from, from + 2); // tiny pages to exercise pagination
          return { data: page, has_more: from + 2 < all.length };
        }
        st.calls++; return { data: st.subs[p.customer] || [] };
      },
      update: async (id, p) => { const sub = st.trialing.find((x) => x.id === id); sub.metadata = Object.assign({}, sub.metadata, p.metadata); (st.updates = st.updates || []).push(id); return sub; },
    },
    checkout: { sessions: {
      create: async (p) => { st.created.push(p); return { url: 'https://checkout.stripe.test/pay' }; },
      retrieve: async (id) => { if (!st.sessions[id]) throw new Error('no such session'); return st.sessions[id]; },
    } },
    billingPortal: {
      configurations: { create: async (p) => { st.portalConfigs = (st.portalConfigs || 0) + 1; st.portalConf = p; return { id: 'bpc_1' }; } },
      sessions: { create: async (p) => { st.portal.push(p); return { url: 'https://billing.stripe.test/p' }; } },
    },
  };
  const secret = 'x'.repeat(40);
  const app = createApp({ stripe, sendEmail: async (m) => sent.push(m), config: Object.assign({ secret, baseUrl: 'http://localhost' }, config) });
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}`;
  return { base, server, secret, app, close: () => new Promise((r) => server.close(r)) };
}
const req = (base, p, o = {}) => fetch(base + p, Object.assign({ redirect: 'manual' }, o));
const cookieOf = (r) => (r.headers.get('set-cookie') || '').split(';')[0];

test('free site is public; premium code is never in public files', async () => {
  const t = await start(fakeStripe());
  try {
    const home = await req(t.base, '/');
    assert.equal(home.status, 200);
    const html = await home.text();
    assert.match(html, /Excel Easy/);
    assert.match(home.headers.get('content-security-policy'), /script-src 'self'/);
    for (const p of ['/engine.js', '/premium/engine.js', '/premium/app.js', '/premium/data.js', '/../server.js', '/%2e%2e/server.js', '/server.js', '/package.json']) {
      assert.equal((await req(t.base, p)).status, 404, p + ' should be 404');
    }
    const appjs = await (await req(t.base, '/app.js')).text();
    assert.ok(!appjs.includes('EE_PREMIUM = '), 'premium data must not be in the public app');
    const data = await (await req(t.base, '/data.js')).text();
    assert.ok(!/BUILDER/.test(data) && !/Grand total/.test(data));
  } finally { await t.close(); }
});

test('premium.js requires an active subscription', async () => {
  const st = fakeStripe(); const t = await start(st);
  try {
    assert.equal((await req(t.base, '/api/premium.js')).status, 401);
    const forged = 'ee_session=' + sign('wrong-secret-wrong-secret-wrong-secret', { typ: 'session', cid: 'cus_sub', exp: Date.now() + 1e6 });
    assert.equal((await req(t.base, '/api/premium.js', { headers: { cookie: forged } })).status, 401);
    const expired = 'ee_session=' + sign(t.secret, { typ: 'session', cid: 'cus_sub', exp: Date.now() - 1 });
    assert.equal((await req(t.base, '/api/premium.js', { headers: { cookie: expired } })).status, 401);
    const lapsed = 'ee_session=' + sign(t.secret, { typ: 'session', cid: 'cus_old', exp: Date.now() + 1e6 });
    assert.equal((await req(t.base, '/api/premium.js', { headers: { cookie: lapsed } })).status, 401);
    const loginTok = 'ee_session=' + sign(t.secret, { typ: 'login', cid: 'cus_sub', exp: Date.now() + 1e6 });
    assert.equal((await req(t.base, '/api/premium.js', { headers: { cookie: loginTok } })).status, 401, 'a login token is not a session');
    const good = 'ee_session=' + sign(t.secret, { typ: 'session', cid: 'cus_sub', exp: Date.now() + 1e6 });
    const r = await req(t.base, '/api/premium.js', { headers: { cookie: good } });
    assert.equal(r.status, 200);
    const js = await r.text();
    assert.match(js, /EE_PREMIUM/); assert.match(js, /ExcelEasy/); assert.match(js, /EE_CORE/);
    assert.match(r.headers.get('cache-control'), /no-store/);
    const me = await (await req(t.base, '/api/me', { headers: { cookie: good } })).json();
    assert.equal(me.premium, true);
    assert.equal((await (await req(t.base, '/api/me')).json()).premium, false);
  } finally { await t.close(); }
});

test('checkout: monthly and yearly plans with a free trial', async () => {
  const st = fakeStripe(); const t = await start(st);
  try {
    const r = await req(t.base, '/api/checkout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).url, 'https://checkout.stripe.test/pay');
    const p = st.created[0];
    assert.equal(p.mode, 'subscription');
    assert.equal(p.line_items[0].price_data.currency, 'gbp');
    assert.equal(p.line_items[0].price_data.unit_amount, 500);
    assert.equal(p.line_items[0].price_data.recurring.interval, 'month');
    assert.match(p.success_url, /session_id=\{CHECKOUT_SESSION_ID\}/);
    assert.equal(p.subscription_data.trial_period_days, 7);
    const y = await req(t.base, '/api/checkout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ plan: 'yearly' }) });
    assert.equal(y.status, 200);
    const yp = st.created[1].line_items[0].price_data;
    assert.deepEqual([yp.currency, yp.unit_amount, yp.recurring.interval], ['gbp', 5000, 'year']);
    await req(t.base, '/api/checkout', { method: 'POST', body: JSON.stringify({ plan: 'lifetime-free' }) });
    assert.equal(st.created[2].line_items[0].price_data.recurring.interval, 'month', 'unknown plans fall back to monthly');
    const plans = await (await req(t.base, '/api/plans')).json();
    assert.deepEqual(plans, { trialDays: 7, monthly: 500, yearly: 5000, reminderDays: 2 });
    const evil = await req(t.base, '/api/checkout', { method: 'POST', headers: { origin: 'https://evil.example' }, body: '{}' });
    assert.equal(evil.status, 403);
  } finally { await t.close(); }
});

test('returning from checkout signs you in only when paid', async () => {
  const t = await start(fakeStripe());
  try {
    const ok = await req(t.base, '/api/checkout/complete?session_id=cs_good');
    assert.equal(ok.status, 303); assert.match(ok.headers.get('location'), /welcome=1/);
    const c = cookieOf(ok); assert.match(c, /^ee_session=/);
    assert.match(ok.headers.get('set-cookie'), /HttpOnly/);
    assert.equal((await req(t.base, '/api/premium.js', { headers: { cookie: c } })).status, 200);
    const bad = await req(t.base, '/api/checkout/complete?session_id=cs_unpaid');
    assert.ok(!bad.headers.get('set-cookie')); assert.match(bad.headers.get('location'), /cancelled/);
    const junk = await req(t.base, '/api/checkout/complete?session_id=../../x');
    assert.ok(!junk.headers.get('set-cookie'));
    const unknown = await req(t.base, '/api/checkout/complete?session_id=cs_nope');
    assert.ok(!unknown.headers.get('set-cookie'));
  } finally { await t.close(); }
});

test('magic-link login: emails subscribers only, same answer for everyone', async () => {
  const sent = []; const t = await start(fakeStripe(), sent);
  try {
    const post = (email) => req(t.base, '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) });
    const a = await post('Paid@Example.com'); const b = await post('lapsed@example.com'); const c = await post('nobody@example.com');
    assert.deepEqual([a.status, b.status, c.status], [200, 200, 200]);
    assert.deepEqual(await a.json(), await c.json());
    assert.equal(sent.length, 1); assert.equal(sent[0].to, 'paid@example.com');
    sent[0].link = sent[0].text.match(/https?:\/\/\S+/)[0];
    assert.equal((await post('not-an-email')).status, 400);
    const v = await req(t.base, new URL(sent[0].link).pathname + new URL(sent[0].link).search);
    assert.equal(v.status, 303); const cookie = cookieOf(v); assert.match(cookie, /^ee_session=/);
    assert.equal((await req(t.base, '/api/premium.js', { headers: { cookie: cookie } })).status, 200);
    const badTok = await req(t.base, '/api/login/verify?token=abc.def');
    assert.match(badTok.headers.get('location'), /signin=failed/); assert.ok(!badTok.headers.get('set-cookie'));
    const sessionAsLink = sign(t.secret, { typ: 'session', cid: 'cus_sub', exp: Date.now() + 1e6 });
    assert.match((await req(t.base, '/api/login/verify?token=' + encodeURIComponent(sessionAsLink))).headers.get('location'), /failed/);
  } finally { await t.close(); }
});

test('login is rate limited', async () => {
  const t = await start(fakeStripe());
  try {
    let last;
    for (let i = 0; i < 7; i++) last = await req(t.base, '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'a@b.co' }) });
    assert.equal(last.status, 429);
  } finally { await t.close(); }
});

test('cancelled subscribers lose access once the cache expires; portal & logout work', async () => {
  const st = fakeStripe(); const t = await start(st);
  try {
    const c = 'ee_session=' + sign(t.secret, { typ: 'session', cid: 'cus_sub', exp: Date.now() + 1e6 });
    assert.equal((await req(t.base, '/api/premium.js', { headers: { cookie: c } })).status, 200);
    const calls = st.calls;
    await req(t.base, '/api/premium.js', { headers: { cookie: c } });
    assert.equal(st.calls, calls, 'second check uses the cache');
    assert.equal((await req(t.base, '/api/portal', { method: 'POST', body: '{}' })).status, 401);
    const p = await req(t.base, '/api/portal', { method: 'POST', headers: { cookie: c }, body: '{}' });
    assert.equal((await p.json()).url, 'https://billing.stripe.test/p'); assert.equal(st.portal[0].customer, 'cus_sub');
    assert.equal(st.portal[0].configuration, 'bpc_1');
    assert.equal(st.portalConf.features.subscription_cancel.enabled, true);
    await req(t.base, '/api/portal', { method: 'POST', headers: { cookie: c }, body: '{}' });
    assert.equal(st.portalConfigs, 1, 'portal configuration is created once and reused');
    const out = await req(t.base, '/api/logout', { method: 'POST', body: '{}' });
    assert.match(out.headers.get('set-cookie'), /Max-Age=0/);
  } finally { await t.close(); }
});

test('trial can be switched off and prices changed by config', async () => {
  const st = fakeStripe(); const t = await start(st, [], { trialDays: 0, monthlyPence: 600, yearlyPence: 6000 });
  try {
    await req(t.base, '/api/checkout', { method: 'POST', body: '{}' });
    assert.equal(st.created[0].subscription_data.trial_period_days, undefined);
    assert.equal(st.created[0].line_items[0].price_data.unit_amount, 600);
    assert.deepEqual(await (await req(t.base, '/api/plans')).json(), { trialDays: 0, monthly: 600, yearly: 6000, reminderDays: 2 });
  } finally { await t.close(); }
});

test('trialing subscribers get Premium; trial checkout (no payment yet) signs in', async () => {
  const st = fakeStripe();
  st.subs.cus_trial = [{ status: 'trialing' }];
  st.sessions.cs_trial = { status: 'complete', payment_status: 'no_payment_required', customer: 'cus_trial' };
  const t = await start(st);
  try {
    const r = await req(t.base, '/api/checkout/complete?session_id=cs_trial');
    const c = cookieOf(r); assert.match(c, /^ee_session=/);
    assert.equal((await req(t.base, '/api/premium.js', { headers: { cookie: c } })).status, 200);
  } finally { await t.close(); }
});

test('trial reminders: emailed once, ~2 days before, with price, date and cancel link', async () => {
  const st = fakeStripe(); const sent = [];
  const now = Date.UTC(2026, 9, 1, 9, 0, 0); const nowS = now / 1000; const day = 86400;
  const cust = (email) => ({ id: 'cus_' + email.split('@')[0], email });
  const price = (amount, interval) => ({ data: [{ price: { unit_amount: amount, recurring: { interval } } }] });
  st.trialing = [
    { id: 'sub_due_m', customer: cust('m@example.com'), trial_end: nowS + 1.5 * day, items: price(500, 'month'), metadata: {} },
    { id: 'sub_due_y', customer: cust('y@example.com'), trial_end: nowS + 2 * day, items: price(5000, 'year'), metadata: { plan: 'yearly' } },
    { id: 'sub_later', customer: cust('later@example.com'), trial_end: nowS + 5 * day, items: price(500, 'month'), metadata: {} },
    { id: 'sub_cancelled', customer: cust('c@example.com'), trial_end: nowS + day, cancel_at_period_end: true, items: price(500, 'month'), metadata: {} },
    { id: 'sub_done', customer: cust('d@example.com'), trial_end: nowS + day, items: price(500, 'month'), metadata: { trial_reminder_sent: 'x' } },
  ];
  const t = await start(st, sent, { baseUrl: 'http://localhost' });
  try {
    const r1 = await t.app.runTrialReminders(now);
    assert.equal(r1.sent, 2); assert.equal(r1.failed, 0);
    assert.deepEqual(sent.map((m) => m.to).sort(), ['m@example.com', 'y@example.com']);
    const m = sent.find((x) => x.to === 'm@example.com');
    assert.match(m.subject, /trial ends on Friday 2 October 2026/);
    assert.match(m.text, /£5\.00 per month/);
    assert.match(sent.find((x) => x.to === 'y@example.com').text, /yearly plan .* £50\.00 per year/);
    assert.match(m.text, /\/api\/manage\?token=/);
    const r2 = await t.app.runTrialReminders(now + 3600e3);
    assert.equal(r2.sent, 0, 'never sent twice'); assert.equal(sent.length, 2);
    // the later trial gets its reminder once it is within the window
    await t.app.runTrialReminders(now + 3.5 * day * 1000);
    assert.equal(sent.length, 3); assert.equal(sent[2].to, 'later@example.com');
  } finally { await t.close(); }
});

test('trial reminders: a failed email is retried on the next run', async () => {
  const st = fakeStripe(); let fail = true; const sent = [];
  const nowS = Math.floor(Date.now() / 1000);
  st.trialing = [{ id: 'sub_1', customer: { id: 'cus_1', email: 'a@example.com' }, trial_end: nowS + 86400, items: { data: [] }, metadata: {} }];
  const http2 = require('http');
  const { createApp } = require('../server.js');
  const app = createApp({ stripe: { subscriptions: { list: async () => ({ data: st.trialing, has_more: false }), update: async (id, p) => { st.trialing[0].metadata = p.metadata; } } }, sendEmail: async (msg) => { if (fail) throw new Error('smtp down'); sent.push(msg); }, config: { secret: 'k'.repeat(40) } });
  const r1 = await app.runTrialReminders();
  assert.equal(r1.failed, 1); assert.equal(st.trialing[0].metadata.trial_reminder_sent, undefined);
  fail = false;
  assert.equal((await app.runTrialReminders()).sent, 1);
  assert.match(sent[0].text, /£5\.00 per month/, 'falls back to configured monthly price');
  assert.ok(http2);
});

test('one-click manage link opens the billing portal; other tokens do not', async () => {
  const st = fakeStripe(); const t = await start(st);
  try {
    const tok = sign(t.secret, { typ: 'manage', cid: 'cus_sub', exp: Date.now() + 1e6 });
    const r = await req(t.base, '/api/manage?token=' + encodeURIComponent(tok));
    assert.equal(r.status, 303); assert.equal(r.headers.get('location'), 'https://billing.stripe.test/p');
    assert.equal(st.portal[0].customer, 'cus_sub');
    const session = sign(t.secret, { typ: 'session', cid: 'cus_sub', exp: Date.now() + 1e6 });
    assert.match((await req(t.base, '/api/manage?token=' + encodeURIComponent(session))).headers.get('location'), /signin=failed/);
    const expired = sign(t.secret, { typ: 'manage', cid: 'cus_sub', exp: Date.now() - 1 });
    assert.match((await req(t.base, '/api/manage?token=' + encodeURIComponent(expired))).headers.get('location'), /signin=failed/);
    assert.equal(st.portal.length, 1);
  } finally { await t.close(); }
});

test('reminders can be switched off', async () => {
  const { createApp } = require('../server.js');
  let listed = false;
  const app = createApp({ stripe: { subscriptions: { list: async () => { listed = true; return { data: [] }; } } }, sendEmail: async () => {}, config: { secret: 'k'.repeat(40), reminderDays: 0 } });
  assert.deepEqual(await app.runTrialReminders(), { sent: 0, skipped: 0, failed: 0 });
  assert.equal(listed, false);
});
