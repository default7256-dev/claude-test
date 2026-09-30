'use strict';
/*
 * Builds a self-contained, click-through demo of Excel Easy (no server, no Stripe).
 * Payments, billing and emails are simulated in the page so anyone can try the full flow.
 *   node scripts/build-demo.js [outDir]      (default: dist/demo)
 * Output: index.html (+ terms.html, privacy.html, styles.css, favicon.svg for the footer links).
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.resolve(process.argv[2] || path.join(root, 'dist', 'demo'));
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const noScriptClose = (js) => js.replace(/<\/script/gi, '<\\/script');

const index = read('public/index.html');
let body = index.slice(index.indexOf('<body>') + 6, index.indexOf('</body>'));
body = body.replace(/<script[^>]*><\/script>\s*/g, '');

// The real site loads Premium from the server; the demo runs the same code from the page.
let app = read('public/app.js');
const loader = "const sc = document.createElement('script'); sc.src = '/api/premium.js';\n      sc.onload = resolve; sc.onerror = () => reject(new Error('Could not load Premium features'));\n      document.head.appendChild(sc);";
if (!app.includes(loader)) throw new Error('build-demo: premium loader not found in public/app.js');
app = app.replace(loader, 'window.__EE_LOAD_PREMIUM(); resolve();');

const premium = ['premium/engine.js', 'premium/data.js', 'premium/app.js'].map(read).join('\n;\n');

const demoCss = `
.demo-bar{background:var(--hl);border-bottom:1px solid var(--line);font-size:.82rem}
.demo-bar .wrap{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap;padding-block:8px}
.demo-bar p{margin:0;min-width:0}
.demo-bar .acts{display:flex;gap:6px;flex-wrap:wrap}
.demo-card{border:1px solid var(--line);border-radius:10px;padding:12px;margin:10px 0;background:var(--accent)}
.demo-email{white-space:pre-wrap;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.8rem;background:var(--accent);border-radius:8px;padding:12px;max-height:50vh;overflow:auto}
.demo-fake{display:grid;gap:8px;margin:10px 0}
.demo-fake span{display:block;border:2px solid var(--line);border-radius:8px;padding:10px 12px;color:var(--muted);font-family:ui-monospace,Menlo,monospace}
`;

const demoHtml = `
<div class="demo-bar" role="note">
  <div class="wrap">
    <p><b>Demo mode.</b> Payments, billing and emails are simulated. No card is charged and nothing is sent.</p>
    <div class="acts">
      <button type="button" class="ghost" id="demoEmailBtn">See the trial reminder email</button>
      <button type="button" class="ghost" id="demoResetBtn">Reset demo</button>
    </div>
  </div>
</div>`;

const demoDialogs = `
<dialog id="demoCheckout" aria-labelledby="dch">
  <h3 id="dch">Checkout (demo)</h3>
  <p class="muted">On the real site this is Stripe’s secure checkout page.</p>
  <div class="demo-card"><b id="demoPlanName">Monthly</b><br><span id="demoPlanLine"></span></div>
  <div class="demo-fake" aria-hidden="true"><span>Email: you@example.com</span><span>Card: 4242 4242 4242 4242</span></div>
  <div class="dlgbtns"><button type="button" class="ghost" id="demoCheckoutCancel">Back to the site</button><button type="button" class="primary" id="demoCheckoutGo">Start free trial</button></div>
</dialog>
<dialog id="demoBilling" aria-labelledby="dbh">
  <h3 id="dbh">Manage subscription (demo)</h3>
  <p class="muted">On the real site this is Stripe’s billing page, where people cancel, change their card and download invoices.</p>
  <div class="demo-card" id="demoBillingLine"></div>
  <div class="dlgbtns"><button type="button" class="ghost" id="demoBillingClose">Close</button><button type="button" class="primary" id="demoBillingCancel">Cancel subscription</button></div>
</dialog>
<dialog id="demoEmail" aria-labelledby="deh">
  <h3 id="deh">Trial reminder email</h3>
  <p class="muted">Sent automatically 2 days before a free trial ends.</p>
  <div class="demo-email" id="demoEmailText"></div>
  <div class="dlgbtns"><button type="button" class="ghost" id="demoEmailClose">Close</button></div>
</dialog>`;

const shim = `
(function () {
  var mem = {};
  var ls = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return mem[k] == null ? null : mem[k]; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { mem[k] = v; } },
  };
  var plans = { trialDays: 7, monthly: 500, yearly: 5000, reminderDays: 2 };
  var state = { premium: ls.get('ee:demo-premium') === '1', plan: ls.get('ee:demo-plan') || 'monthly' };
  var pending = 'monthly';
  var save = function () { ls.set('ee:demo-premium', state.premium ? '1' : '0'); ls.set('ee:demo-plan', state.plan); };
  var gbp = function (p) { return '£' + (p / 100).toFixed(2); };
  var planText = function (plan) { return plan === 'yearly' ? gbp(plans.yearly) + ' per year' : gbp(plans.monthly) + ' per month'; };
  var trialEnd = function () { var d = new Date(Date.now() + plans.trialDays * 864e5); return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).replace(',', ''); };
  var reply = function (obj, status) { return Promise.resolve(new Response(JSON.stringify(obj), { status: status || 200, headers: { 'Content-Type': 'application/json' } })); };
  var realFetch = window.fetch.bind(window);
  window.fetch = function (url, opts) {
    var u = String(url);
    if (u.indexOf('/api/') !== 0) return realFetch(url, opts);
    var body = {}; try { body = JSON.parse((opts && opts.body) || '{}'); } catch (e) {}
    if (u === '/api/me') return reply({ premium: state.premium });
    if (u === '/api/plans') return reply(plans);
    if (u === '/api/checkout') { pending = body.plan === 'yearly' ? 'yearly' : 'monthly'; setTimeout(openCheckout, 0); return reply({ url: '#demo-checkout' }); }
    if (u === '/api/login') return reply({ ok: true });
    if (u === '/api/portal') { setTimeout(openBilling, 0); return reply({ url: '#demo-billing' }); }
    if (u === '/api/logout') { state.premium = false; save(); return reply({ ok: true }); }
    return reply({ error: 'Not found' }, 404);
  };
  function $(id) { return document.getElementById(id); }
  function core() { return window.EE_CORE; }
  function openCheckout() {
    var pd = $('planDlg'); if (pd && pd.open) pd.close();
    $('demoPlanName').textContent = pending === 'yearly' ? 'Excel Easy Premium, yearly' : 'Excel Easy Premium, monthly';
    $('demoPlanLine').textContent = plans.trialDays + ' days free, then ' + planText(pending) + '. You’d get a reminder email 2 days before the trial ends.';
    $('demoCheckout').showModal();
  }
  function openBilling() {
    $('demoBillingLine').textContent = 'Free trial of the ' + state.plan + ' plan. Ends ' + trialEnd() + ', then ' + planText(state.plan) + '.';
    $('demoBilling').showModal();
  }
  function emailText() {
    var interval = state.plan === 'yearly' ? 'year' : 'month';
    return 'Subject: Your Excel Easy free trial ends on ' + trialEnd() + '\\n\\nHello,\\n\\nJust a reminder: your free Excel Easy Premium trial ends on ' + trialEnd() + '.\\n\\nIf you do nothing, your ' + state.plan + ' plan will start then and your card will be charged ' + gbp(state.plan === 'yearly' ? plans.yearly : plans.monthly) + ' per ' + interval + ', renewing every ' + interval + ' until you cancel.\\n\\nHappy with Excel Easy? You don’t need to do anything.\\n\\nDon’t want to continue? Cancel before your trial ends and you won’t pay anything:\\nhttps://your-site/api/manage?token=…\\n\\n(That link opens your secure Stripe billing page. You can also sign in on the site and choose “Manage subscription”.)\\n\\nThanks for trying Excel Easy!';
  }
  function hashHome() { try { history.replaceState(null, '', location.pathname); } catch (e) {} }
  document.addEventListener('DOMContentLoaded', function () {
    $('demoCheckoutGo').addEventListener('click', async function () {
      state.premium = true; state.plan = pending; save();
      $('demoCheckout').close(); hashHome();
      await core().refreshAccount();
      core().showTab('practice');
      core().toast('🎉 Welcome to Premium! Everything is unlocked.');
    });
    $('demoCheckoutCancel').addEventListener('click', function () { $('demoCheckout').close(); hashHome(); core().toast('Checkout cancelled. Nothing was charged.'); });
    $('demoBillingClose').addEventListener('click', function () { $('demoBilling').close(); hashHome(); });
    $('demoBillingCancel').addEventListener('click', function () { state.premium = false; save(); location.reload(); });
    $('demoEmailBtn').addEventListener('click', function () { $('demoEmailText').textContent = emailText(); $('demoEmail').showModal(); });
    $('demoEmailClose').addEventListener('click', function () { $('demoEmail').close(); });
    $('demoResetBtn').addEventListener('click', function () {
      try { Object.keys(localStorage).filter(function (k) { return k.indexOf('ee:') === 0; }).forEach(function (k) { localStorage.removeItem(k); }); } catch (e) {}
      mem = {}; location.reload();
    });
  });
})();
`;

const premiumWrapped = `(function () {
  var loaded = false;
  window.__EE_LOAD_PREMIUM = function () {
    if (loaded) return; loaded = true;
${noScriptClose(premium)}
  };
})();`;

const page = `<title>Excel Easy</title>
<meta name="description" content="Excel explained in plain English (demo).">
<style>
${read('public/styles.css')}
${demoCss}
</style>
${demoHtml}
${body.trim()}
${demoDialogs}
<script>${noScriptClose(shim)}</script>
<script>${noScriptClose(read('public/data.js'))}</script>
<script>${premiumWrapped}</script>
<script>${noScriptClose(app)}</script>
`;

fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'index.html'), page);
for (const f of ['terms.html', 'privacy.html', 'styles.css', 'favicon.svg']) fs.copyFileSync(path.join(root, 'public', f), path.join(out, f));
console.log(`Demo written to ${path.relative(process.cwd(), out) || out} (${Math.round(page.length / 1024)} KB)`);
