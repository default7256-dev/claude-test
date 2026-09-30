'use strict';
(function () {
  const D = window.EE_DATA;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const store = {
    get(k, d) { try { const v = localStorage.getItem('ee:' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('ee:' + k, JSON.stringify(v)); } catch (e) { /* storage unavailable: fine */ } },
  };
  let toastTimer;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
  }
  function copy(text) {
    const done = () => toast('Copied! Now paste it into Excel with Ctrl+V');
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, () => fallback());
    else fallback();
    function fallback() {
      const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { toast('Select the formula and press Ctrl+C to copy'); }
      ta.remove();
    }
  }

  /* ---------- Tabs ---------- */
  function showTab(name, updateHash) {
    if (!$('#tab-' + name)) name = 'home';
    $$('.panel').forEach((p) => { p.hidden = p.id !== 'tab-' + name; });
    $$('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
    if (updateHash !== false) history.replaceState(null, '', '#' + name);
    window.scrollTo({ top: 0 });
  }
  $$('.tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  $$('[data-go]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); showTab(a.dataset.go); }));

  /* ---------- Text size ---------- */
  let fs = store.get('fs', 18);
  const applyFs = () => document.documentElement.style.setProperty('--fs', fs + 'px');
  applyFs();
  $('#bigger').addEventListener('click', () => { fs = Math.min(28, fs + 2); store.set('fs', fs); applyFs(); });
  $('#smaller').addEventListener('click', () => { fs = Math.max(14, fs - 2); store.set('fs', fs); applyFs(); });

  /* ---------- Ask: plain-English task finder ---------- */
  const STOP = new Set('i a an the to of in on my me do how can want would like need make it and or is for with some get what'.split(' '));
  const stem = (w) => w.replace(/(ing|ed|es|s)$/, '');
  function score(task, words) {
    const hay = (task.q + ' ' + task.kw).toLowerCase().split(/[^a-z0-9%$#]+/).map(stem);
    const qset = task.q.toLowerCase();
    let s = 0;
    for (const w of words) {
      if (hay.includes(stem(w))) s += 2;
      else if (hay.some((h) => h.length > 3 && (h.startsWith(stem(w)) || stem(w).startsWith(h)) && stem(w).length > 2)) s += 1;
      if (qset.includes(w)) s += 1;
    }
    return s;
  }
  function renderTask(t) {
    const formula = t.formula ? `<div class="formula-row"><code>${esc(t.formula)}</code><button class="ghost" data-copy="${esc(t.formula)}">Copy</button><button class="ghost" data-try="${esc(t.formula)}">Try it →</button></div>` : '';
    return `<article class="answer"><h3>${esc(t.q)}</h3>${formula}<ol>${t.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>${t.tip ? `<div class="tip">💡 ${esc(t.tip)}</div>` : ''}</article>`;
  }
  function renderAnswers() {
    const q = $('#ask').value.trim().toLowerCase();
    const out = $('#answers');
    if (!q) { out.innerHTML = ''; return; }
    const words = q.split(/[^a-z0-9%$#]+/).filter((w) => w && !STOP.has(w));
    const ranked = D.TASKS.map((t) => ({ t, s: score(t, words) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 3);
    out.innerHTML = ranked.length
      ? ranked.map((x) => renderTask(x.t)).join('')
      : `<div class="answer"><h3>Hmm, I’m not sure yet</h3><p>Try different words (for example “total” instead of “sum up”), or pick one of the ideas above. You can also browse the <a href="#learn" data-go="learn">lessons</a>.</p></div>`;
  }
  $('#ask').addEventListener('input', renderAnswers);
  $('#chips').innerHTML = ['Add up a column of numbers', 'Find the average', 'Copy a formula down the whole column', 'Sort my data A to Z', 'Make a chart', 'Undo a mistake', 'Show one thing if true, another if not', 'Look up a value from a table', 'Remove duplicates']
    .map((t) => `<button type="button">${esc(t)}</button>`).join('');
  $('#chips').addEventListener('click', (e) => { if (e.target.tagName === 'BUTTON') { $('#ask').value = e.target.textContent; renderAnswers(); $('#answers').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } });
  document.addEventListener('click', (e) => {
    const c = e.target.closest('[data-copy]'); if (c) copy(c.dataset.copy);
    const t = e.target.closest('[data-try]'); if (t) tryInSheet(t.dataset.try);
    const g = e.target.closest('a[data-go]'); if (g) { e.preventDefault(); showTab(g.dataset.go); }
  });

  /* ---------- Lessons ---------- */
  let doneSet = new Set(store.get('done', []));
  function renderLessons() {
    $('#lessons').innerHTML = D.LESSONS.map((l, i) => {
      if (l.locked) {
        return `<details class="lesson locked" id="lesson-${l.id}"><summary><span class="num">🔒</span>${esc(l.title)}<span class="mins">${l.mins} min · Premium</span></summary>
          <div class="body"><p>This lesson is part of Premium.</p><button class="primary" data-upgrade>Unlock all lessons</button></div></details>`;
      }
      return `
      <details class="lesson ${doneSet.has(l.id) ? 'done' : ''}" id="lesson-${l.id}">
        <summary><span class="num">${doneSet.has(l.id) ? '✓' : i + 1}</span>${esc(l.title)}<span class="mins">${l.mins} min</span></summary>
        <div class="body">
          <p>${l.intro}</p>
          <ol>${l.steps.map((s) => `<li>${s}</li>`).join('')}</ol>
          ${l.practice ? `<p class="tip">🧪 ${esc(l.practice)} ${l.example ? `<button class="ghost" data-try="${esc(l.example)}">Try it →</button>` : ''}</p>` : ''}
          <label class="doneRow"><input type="checkbox" data-done="${l.id}" ${doneSet.has(l.id) ? 'checked' : ''}> I’ve finished this lesson</label>
        </div>
      </details>`;
    }).join('');
    $('#progress').textContent = `${[...doneSet].filter((id) => D.LESSONS.some((l) => l.id === id && !l.locked)).length} of ${D.LESSONS.length} done`;
  }
  $('#lessons').addEventListener('change', (e) => {
    const id = e.target.dataset.done; if (!id) return;
    e.target.checked ? doneSet.add(id) : doneSet.delete(id);
    store.set('done', [...doneSet]);
    const open = $$('details.lesson[open]').map((d) => d.id);
    renderLessons();
    open.forEach((i) => { const d = document.getElementById(i); if (d) d.open = true; });
    if (D.LESSONS.every((l) => doneSet.has(l.id))) toast('🎉 You finished every lesson!');
  });
  renderLessons();

  /* ---------- Error decoder ---------- */
  function renderErrors() {
    const q = $('#errq').value.trim().toLowerCase();
    const list = D.ERRORS.filter((x) => !q || (x.code + ' ' + x.what + ' ' + x.fix).toLowerCase().includes(q));
    $('#errors').innerHTML = list.length ? list.map((x) => `<div class="errcard"><span class="code">${esc(x.code)}</span><p><b>What it means:</b> ${esc(x.what)}</p><p><b>How to fix it:</b> ${esc(x.fix)}</p></div>`).join('') : '<p class="muted">No match. Try another word.</p>';
  }
  $('#errq').addEventListener('input', renderErrors); renderErrors();


  /* ---------- Words & shortcuts ---------- */
  function renderGloss() {
    const q = $('#gq').value.trim().toLowerCase();
    $('#gloss').innerHTML = D.GLOSSARY.filter(([w, d]) => !q || (w + ' ' + d).toLowerCase().includes(q)).map(([w, d]) => `<dt>${esc(w)}</dt><dd>${esc(d)}</dd>`).join('') || '<dd>No match.</dd>';
  }
  $('#gq').addEventListener('input', renderGloss); renderGloss();
  $('#keys').innerHTML = D.SHORTCUTS.map(([k, d]) => `<tr><td><kbd>${esc(k)}</kbd></td><td>${esc(d)}</td></tr>`).join('');

  /* ---------- Premium / accounts ---------- */
  const C = { $, $$, esc, toast, copy, showTab, store, data: D, renderLessons, premiumReady: false, tryInSheet: null };
  window.EE_CORE = C;
  function tryInSheet(formula) {
    if (C.tryInSheet) C.tryInSheet(formula);
    else { toast('The practice sheet is a Premium feature'); showTab('practice'); }
  }
  async function api(path, opts) {
    const r = await fetch(path, Object.assign({ credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } }, opts));
    let body = null; try { body = await r.json(); } catch (e) { /* no body */ }
    return { ok: r.ok, status: r.status, body };
  }
  function loadPremiumScript() {
    return new Promise((resolve, reject) => {
      if (C.premiumReady) return resolve();
      const sc = document.createElement('script'); sc.src = '/api/premium.js';
      sc.onload = resolve; sc.onerror = () => reject(new Error('Could not load Premium features'));
      document.head.appendChild(sc);
    });
  }
  function setPremiumUI(on, email) {
    document.body.classList.toggle('is-premium', on);
    $$('.premium-only').forEach((el) => { el.hidden = !on; });
    $$('.paywall').forEach((el) => { el.hidden = on; });
    $('#acct').innerHTML = on
      ? `<span class="pill">⭐ Premium</span><button class="ghost" id="manage">Manage subscription</button><button class="ghost" id="logout">Sign out</button>`
      : `<button class="ghost" id="signin">Sign in</button><button class="primary small" data-upgrade data-cta>Start free trial</button>`;
    if (typeof applyPlans === 'function') applyPlans();
  }
  async function refreshAccount() {
    const me = await api('/api/me').catch(() => ({ ok: false, body: null }));
    const on = !!(me.ok && me.body && me.body.premium);
    setPremiumUI(on);
    if (on) { try { await loadPremiumScript(); } catch (e) { toast(e.message); } }
    else { C.premiumReady = false; }
  }
  let plans = { trialDays: 7, monthly: 500, yearly: 5000 };
  const gbp = (p) => '£' + (p % 100 ? (p / 100).toFixed(2) : String(p / 100));
  function applyPlans() {
    $$('[data-price]').forEach((el) => { el.textContent = gbp(plans[el.dataset.price]); });
    $$('[data-trial]').forEach((el) => { el.textContent = plans.trialDays; });
    $$('[data-trial-line]').forEach((el) => { el.hidden = !(plans.trialDays > 0); });
    $$('[data-cta]').forEach((el) => { el.textContent = plans.trialDays > 0 ? `Start ${plans.trialDays}-day free trial` : 'Go Premium'; });
    const saving = plans.monthly * 12 - plans.yearly;
    $$('[data-saving]').forEach((el) => { el.hidden = saving <= 0; el.textContent = `Save ${gbp(saving)}`; });
  }
  api('/api/plans').then((r) => { if (r.ok && r.body) { plans = r.body; applyPlans(); } }).catch(() => {});
  async function startCheckout(plan) {
    toast('Taking you to secure checkout…');
    const r = await api('/api/checkout', { method: 'POST', body: JSON.stringify({ plan }) });
    if (r.ok && r.body && r.body.url) location.href = r.body.url;
    else toast((r.body && r.body.error) || 'Sorry, checkout is unavailable right now. Please try again later.');
  }
  document.addEventListener('click', async (e) => {
    if (e.target.closest('[data-upgrade]')) $('#planDlg').showModal();
    const pl = e.target.closest('[data-plan]');
    if (pl) { $$('[data-plan]').forEach((b) => { b.disabled = true; }); await startCheckout(pl.dataset.plan); $$('[data-plan]').forEach((b) => { b.disabled = false; }); }
    if (e.target.closest('#planClose')) $('#planDlg').close();
    if (e.target.closest('#signin, [data-signin]')) { $('#signinDlg').showModal(); $('#semail').focus(); }
    if (e.target.closest('#manage')) {
      const r = await api('/api/portal', { method: 'POST', body: '{}' });
      if (r.ok && r.body.url) location.href = r.body.url; else toast('Could not open billing. Please try again.');
    }
    if (e.target.closest('#logout')) { await api('/api/logout', { method: 'POST', body: '{}' }); location.hash = '#home'; location.reload(); }
  });
  $('#signinForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#ssend'); btn.disabled = true;
    const r = await api('/api/login', { method: 'POST', body: JSON.stringify({ email: $('#semail').value }) });
    btn.disabled = false;
    $('#smsg').textContent = r.ok
      ? 'If that email has an active subscription, a sign-in link is on its way. Check your inbox (and spam). It works for 15 minutes.'
      : ((r.body && r.body.error) || 'Something went wrong. Please try again.');
  });
  $('#scancel').addEventListener('click', () => $('#signinDlg').close());
  const qs = new URLSearchParams(location.search);
  if (qs.get('welcome')) toast('🎉 Welcome to Premium! Everything is unlocked.');
  if (qs.get('signin') === 'failed') toast('That sign-in link has expired. Please request a new one.');
  if (qs.get('welcome') || qs.get('signin') || qs.get('cancelled')) history.replaceState(null, '', location.pathname + location.hash);
  setPremiumUI(false);
  refreshAccount();

  showTab((location.hash || '#home').slice(1), false);
})();
