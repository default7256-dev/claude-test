'use strict';
/* Premium features: formula builder, practice sheet, formula checker, all lessons.
   Served only to active subscribers by server.js (GET /api/premium.js). */
(function () {
  const C = window.EE_CORE, E = window.ExcelEasy, P = window.EE_PREMIUM;
  const { $, $$, esc, toast, copy, showTab, store } = C;
  const D = { BUILDER: P.BUILDER, SAMPLE: P.SAMPLE, CHALLENGES: P.CHALLENGES };

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


  $('#chk').addEventListener('input', (e) => {
    const r = E.checkFormula(e.target.value);
    $('#chkout').innerHTML = e.target.value.trim()
      ? r.tips.map((t) => `<div class="tipbox ${r.ok ? '' : 'bad'}">${r.ok ? '✅' : '⚠️'} ${esc(t)}</div>`).join('')
      : '';
  });
  /* full lesson list replaces the locked stubs */
  C.data.LESSONS = P.LESSONS;
  C.renderLessons();
  C.tryInSheet = tryInSheet;
  C.premiumReady = true;
})();
