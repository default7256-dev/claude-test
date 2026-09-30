'use strict';
(function () {
  const E = window.ExcelEasy, D = window.EE_DATA;
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
    $('#lessons').innerHTML = D.LESSONS.map((l, i) => `
      <details class="lesson ${doneSet.has(l.id) ? 'done' : ''}" id="lesson-${l.id}">
        <summary><span class="num">${doneSet.has(l.id) ? '✓' : i + 1}</span>${esc(l.title)}<span class="mins">${l.mins} min</span></summary>
        <div class="body">
          <p>${l.intro}</p>
          <ol>${l.steps.map((s) => `<li>${s}</li>`).join('')}</ol>
          ${l.practice ? `<p class="tip">🧪 ${esc(l.practice)} ${l.example ? `<button class="ghost" data-try="${esc(l.example)}">Try it →</button>` : ''}</p>` : ''}
          <label class="doneRow"><input type="checkbox" data-done="${l.id}" ${doneSet.has(l.id) ? 'checked' : ''}> I’ve finished this lesson</label>
        </div>
      </details>`).join('');
    $('#progress').textContent = `${doneSet.size} of ${D.LESSONS.length} done`;
  }
  $('#lessons').addEventListener('change', (e) => {
    const id = e.target.dataset.done; if (!id) return;
    e.target.checked ? doneSet.add(id) : doneSet.delete(id);
    store.set('done', [...doneSet]);
    const open = $$('details.lesson[open]').map((d) => d.id);
    renderLessons();
    open.forEach((i) => { const d = document.getElementById(i); if (d) d.open = true; });
    if (doneSet.size === D.LESSONS.length) toast('🎉 You finished every lesson!');
  });
  renderLessons();

  /* ---------- Formula builder ---------- */
  const bsel = $('#bsel');
  bsel.innerHTML = D.BUILDER.map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join('');
  let current = D.BUILDER[0];
  function renderBuilder() {
    current = D.BUILDER.find((b) => b.id === bsel.value) || D.BUILDER[0];
    $('#bblurb').textContent = current.blurb;
    $('#bfields').innerHTML = current.fields.map((f) => {
      const hint = f.hint ? `<p class="hint" id="h-${f.k}">${esc(f.hint)}</p>` : '';
      const input = f.type === 'select'
        ? `<select data-k="${f.k}" aria-describedby="h-${f.k}">${f.options.map(([v, l]) => `<option value="${esc(v)}" ${v === f.def ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`
        : `<input type="text" data-k="${f.k}" value="${esc(f.def)}" aria-describedby="h-${f.k}" autocomplete="off" spellcheck="false">`;
      return `<label>${esc(f.label)}</label>${hint}${input}`;
    }).join('');
    updateBuilder();
  }
  function updateBuilder() {
    const vals = {};
    $$('#bfields [data-k]').forEach((el) => { vals[el.dataset.k] = el.value; });
    const f = current.make(vals);
    $('#bformula').textContent = f;
    let ex;
    try { ex = E.explain(f); } catch (e) { ex = e.friendly || 'Check the boxes above.'; }
    $('#bexplain').textContent = '💬 ' + ex;
    $('#bafter').textContent = current.after || '';
  }
  bsel.addEventListener('change', renderBuilder);
  $('#bfields').addEventListener('input', updateBuilder);
  $('#bcopy').addEventListener('click', () => copy($('#bformula').textContent));
  $('#btry').addEventListener('click', () => tryInSheet($('#bformula').textContent));
  renderBuilder();

  /* ---------- Practice sheet ---------- */
  const COLS = 8, ROWS = 12;
  const sheet = new E.Sheet(COLS, ROWS);
  const loadSample = () => { sheet.clear(); Object.entries(D.SAMPLE).forEach(([k, v]) => sheet.set(k, v)); };
  const saved = store.get('sheet', null);
  if (saved) { try { sheet.restore(saved); } catch (e) { loadSample(); } } else loadSample();
  let sel = 'A1';
  const undoStack = [];
  const pushHistory = () => { undoStack.push(sheet.snapshot()); if (undoStack.length > 50) undoStack.shift(); };

  function buildGrid() {
    let h = '<thead><tr><th class="rh"></th>';
    for (let c = 1; c <= COLS; c++) h += `<th scope="col">${E.numToCol(c)}</th>`;
    h += '</tr></thead><tbody>';
    for (let r = 1; r <= ROWS; r++) {
      h += `<tr><th class="rh" scope="row">${r}</th>`;
      for (let c = 1; c <= COLS; c++) { const ref = E.numToCol(c) + r; h += `<td data-ref="${ref}"><input data-ref="${ref}" aria-label="Cell ${ref}" autocomplete="off" spellcheck="false"></td>`; }
      h += '</tr>';
    }
    $('#grid').innerHTML = h + '</tbody>';
  }
  function paint() {
    $$('#grid input').forEach((inp) => {
      const ref = inp.dataset.ref;
      const v = sheet.value(ref);
      const isErr = v instanceof E.XlError;
      if (document.activeElement !== inp) inp.value = isErr ? v.code : E.formatValue(v);
      inp.classList.toggle('num', typeof v === 'number');
      inp.classList.toggle('err', isErr);
      inp.parentElement.classList.toggle('sel', ref === sel);
    });
    $('#namebox').textContent = sel;
    if (document.activeElement !== $('#fbar')) $('#fbar').value = sheet.getRaw(sel);
    renderInfo(); renderChallenges();
    store.set('sheet', sheet.snapshot());
  }
  function renderInfo() {
    const raw = sheet.getRaw(sel), box = $('#cellinfo'), v = sheet.value(sel);
    box.classList.remove('bad');
    if (!raw) { box.innerHTML = `<b>${sel}</b> is empty. Type something, or start a formula with <code>=</code>.`; return; }
    if (!raw.startsWith('=')) { box.innerHTML = `<b>${sel}</b> holds ${typeof v === 'number' ? 'the number' : 'the text'} <code>${esc(raw)}</code>. It’s not a formula, so it never changes by itself.`; return; }
    let ex = '';
    try { ex = E.explain(raw); } catch (e) { ex = ''; }
    if (v instanceof E.XlError) {
      box.classList.add('bad');
      box.innerHTML = `<b class="err">${esc(v.code === 'SYNTAX' ? 'The formula isn’t finished correctly' : v.code)}</b><br>${esc(v.friendly)}`;
    } else box.innerHTML = `<b>${sel}</b> shows <b>${esc(E.formatValue(v) || '(nothing)')}</b>.<br>${esc(ex)}`;
  }
  function renderChallenges() {
    $('#challenges').innerHTML = D.CHALLENGES.map((c) => { let ok = false; try { ok = c.check(sheet); } catch (e) { /* not done yet */ } return `<li class="${ok ? 'ok' : ''}"><span aria-hidden="true">${ok ? '✅' : '⬜'}</span><span>${esc(c.text)}${ok ? ' <b>Done!</b>' : ''}</span></li>`; }).join('');
  }
  function select(ref, focus) {
    sel = ref; const inp = $(`#grid input[data-ref="${ref}"]`);
    if (focus && inp) inp.focus();
    paint();
  }
  function move(dc, dr) {
    const p = E.parseRef(sel);
    const c = Math.min(COLS, Math.max(1, p.c + dc)), r = Math.min(ROWS, Math.max(1, p.r + dr));
    select(E.numToCol(c) + r, true);
  }
  function commit(ref, text) {
    if (text === sheet.getRaw(ref)) return;
    pushHistory(); sheet.set(ref, text.trim()); paint();
  }
  const grid = $('#grid');
  buildGrid();
  grid.addEventListener('focusin', (e) => { const i = e.target.closest('input'); if (!i) return; sel = i.dataset.ref; i.value = sheet.getRaw(sel); i.select(); paint(); });
  grid.addEventListener('focusout', (e) => { const i = e.target.closest('input'); if (!i) return; commit(i.dataset.ref, i.value); i.value = ''; paint(); });
  grid.addEventListener('input', (e) => { if (e.target.dataset.ref === sel) $('#fbar').value = e.target.value; });
  grid.addEventListener('keydown', (e) => {
    const i = e.target.closest('input'); if (!i) return;
    const k = e.key;
    if (k === 'Enter') { e.preventDefault(); commit(i.dataset.ref, i.value); move(0, e.shiftKey ? -1 : 1); }
    else if (k === 'ArrowDown') { e.preventDefault(); commit(i.dataset.ref, i.value); move(0, 1); }
    else if (k === 'ArrowUp') { e.preventDefault(); commit(i.dataset.ref, i.value); move(0, -1); }
    else if (k === 'Escape') { i.value = sheet.getRaw(i.dataset.ref); i.select(); }
    else if (k === 'Delete' && i.selectionStart === 0 && i.selectionEnd === i.value.length) { e.preventDefault(); i.value = ''; commit(i.dataset.ref, ''); }
  });
  const fbar = $('#fbar');
  fbar.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commit(sel, fbar.value); select(sel, true); } });
  fbar.addEventListener('blur', () => commit(sel, fbar.value));
  $('#undo').addEventListener('click', () => { if (!undoStack.length) return toast('Nothing to undo'); sheet.restore(undoStack.pop()); paint(); });
  $('#reset').addEventListener('click', () => { pushHistory(); loadSample(); paint(); toast('Example restored (Undo brings your work back)'); });
  $('#clear').addEventListener('click', () => { pushHistory(); sheet.clear(); paint(); toast('Cleared (Undo brings it back)'); });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !$('#tab-practice').hidden && document.activeElement && document.activeElement.closest('#grid')) {
      if (undoStack.length) { e.preventDefault(); sheet.restore(undoStack.pop()); paint(); }
    }
  });
  function tryInSheet(formula) {
    showTab('practice');
    pushHistory();
    // put the formula in a sensible empty spot so the example data is not overwritten
    let target = ['F2', 'F3', 'F4', 'F5', 'F6', 'G2', 'G3', 'G4'].find((r) => !sheet.getRaw(r)) || 'H12';
    sheet.set(target, formula); sel = target; paint();
    toast(`Placed in cell ${target}. Click it to see what it does.`);
    const inp = $(`#grid input[data-ref="${target}"]`); if (inp) inp.focus();
  }
  paint();

  /* ---------- Fix a problem ---------- */
  $('#chk').addEventListener('input', (e) => {
    const r = E.checkFormula(e.target.value);
    $('#chkout').innerHTML = e.target.value.trim()
      ? r.tips.map((t) => `<div class="tipbox ${r.ok ? '' : 'bad'}">${r.ok ? '✅' : '⚠️'} ${esc(t)}</div>`).join('')
      : '';
  });
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

  showTab((location.hash || '#home').slice(1), false);
})();
