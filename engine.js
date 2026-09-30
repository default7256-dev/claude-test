'use strict';
/*
 * Excel Easy formula engine.
 * A small, dependency-free spreadsheet formula parser/evaluator that gives
 * beginner-friendly explanations instead of cryptic error codes.
 */
(function (root) {
  class XlError extends Error {
    constructor(code, friendly) {
      super(friendly);
      this.code = code;
      this.friendly = friendly;
    }
  }

  class Range {
    constructor(data) {
      this.data = data; // 2D array of values
    }
    flat() {
      return [].concat(...this.data);
    }
  }

  const colToNum = (s) => {
    let n = 0;
    for (const ch of s.toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64;
    return n;
  };
  const numToCol = (n) => {
    let s = '';
    while (n > 0) {
      const m = (n - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  };
  const REF_RE = /^\$?([A-Za-z]{1,3})\$?(\d+)$/;
  const parseRef = (s) => {
    const m = REF_RE.exec(s);
    return m ? { c: colToNum(m[1]), r: +m[2] } : null;
  };
  const refName = (c, r) => numToCol(c) + r;

  /* ---------------- Tokenizer ---------------- */
  function tokenize(src) {
    src = src.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
    const t = [];
    let i = 0;
    while (i < src.length) {
      const ch = src[i];
      if (/\s/.test(ch)) { i++; continue; }
      if (ch === '"') {
        let j = i + 1, s = '';
        while (j < src.length) {
          if (src[j] === '"') {
            if (src[j + 1] === '"') { s += '"'; j += 2; continue; }
            break;
          }
          s += src[j++];
        }
        if (j >= src.length) {
          throw new XlError('SYNTAX', 'A piece of text is missing its closing quote ("). Text inside a formula must start and end with double quotes, like "hello".');
        }
        t.push({ type: 'str', value: s });
        i = j + 1;
        continue;
      }
      const rest = src.slice(i);
      const num = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(rest);
      if (num && /[\d.]/.test(ch)) {
        t.push({ type: 'num', value: parseFloat(num[0]) });
        i += num[0].length;
        continue;
      }
      const id = /^[A-Za-z_$][A-Za-z0-9_.$]*/.exec(rest);
      if (id) { t.push({ type: 'id', value: id[0] }); i += id[0].length; continue; }
      const two = src.slice(i, i + 2);
      if (two === '<>' || two === '<=' || two === '>=') { t.push({ type: 'op', value: two }); i += 2; continue; }
      if ('+-*/^&=<>%'.includes(ch)) { t.push({ type: 'op', value: ch }); i++; continue; }
      if (ch === '(') { t.push({ type: 'lp' }); i++; continue; }
      if (ch === ')') { t.push({ type: 'rp' }); i++; continue; }
      if (ch === ',') { t.push({ type: 'comma' }); i++; continue; }
      if (ch === ':') { t.push({ type: 'colon' }); i++; continue; }
      if (ch === ';') {
        throw new XlError('SYNTAX', 'Use a comma (,) to separate items in a formula, not a semicolon (;). (Some countries use semicolons, but the practice sheet uses commas.)');
      }
      throw new XlError('SYNTAX', `I don't understand the character "${ch}" in this formula. Formulas use numbers, cell names like A1, and symbols like + - * /.`);
    }
    return t;
  }

  /* ---------------- Parser ---------------- */
  function parseFormula(text) {
    let src = text.trim();
    if (src.startsWith('=')) src = src.slice(1);
    if (!src.trim()) throw new XlError('SYNTAX', 'There is nothing after the "=" sign. Type what you want to calculate, like =1+2 or =SUM(A1:A5).');
    const toks = tokenize(src);
    let p = 0;
    const peek = () => toks[p];
    const next = () => toks[p++];
    const isOp = (v) => peek() && peek().type === 'op' && (Array.isArray(v) ? v.includes(peek().value) : peek().value === v);

    function expr() {
      let l = concat();
      while (isOp(['=', '<>', '<', '>', '<=', '>='])) {
        const op = next().value;
        l = { type: 'bin', op, l, r: concat() };
      }
      return l;
    }
    function concat() {
      let l = additive();
      while (isOp('&')) { next(); l = { type: 'bin', op: '&', l, r: additive() }; }
      return l;
    }
    function additive() {
      let l = term();
      while (isOp(['+', '-'])) { const op = next().value; l = { type: 'bin', op, l, r: term() }; }
      return l;
    }
    function term() {
      let l = power();
      while (isOp(['*', '/'])) { const op = next().value; l = { type: 'bin', op, l, r: power() }; }
      return l;
    }
    function power() {
      let l = unary();
      while (isOp('^')) { next(); l = { type: 'bin', op: '^', l, r: unary() }; }
      return l;
    }
    function unary() {
      if (isOp('-')) { next(); return { type: 'neg', x: unary() }; }
      if (isOp('+')) { next(); return unary(); }
      let x = primary();
      while (isOp('%')) { next(); x = { type: 'pct', x }; }
      return x;
    }
    function primary() {
      const t = next();
      if (!t) throw new XlError('SYNTAX', 'The formula ends too early. Something is missing after the last symbol (for example, a number or cell name after a "+").');
      if (t.type === 'num') return { type: 'num', value: t.value };
      if (t.type === 'str') return { type: 'str', value: t.value };
      if (t.type === 'lp') {
        const e = expr();
        if (!peek() || peek().type !== 'rp') throw new XlError('SYNTAX', 'A bracket "(" was opened but never closed. Every "(" needs a matching ")".');
        next();
        return e;
      }
      if (t.type === 'id') {
        if (peek() && peek().type === 'lp') {
          next();
          const args = [];
          if (peek() && peek().type === 'rp') { next(); return { type: 'call', name: t.value.toUpperCase(), args }; }
          for (;;) {
            if (peek() && (peek().type === 'comma' || peek().type === 'rp')) args.push({ type: 'blank' });
            else args.push(expr());
            if (!peek()) throw new XlError('SYNTAX', `The bracket after ${t.value.toUpperCase()}( was never closed. Add a ")" at the end.`);
            if (peek().type === 'comma') { next(); continue; }
            if (peek().type === 'rp') { next(); break; }
            throw new XlError('SYNTAX', `Something is out of place inside ${t.value.toUpperCase()}(...). Items inside the brackets should be separated by commas.`);
          }
          return { type: 'call', name: t.value.toUpperCase(), args };
        }
        const up = t.value.toUpperCase();
        if (up === 'TRUE') return { type: 'bool', value: true };
        if (up === 'FALSE') return { type: 'bool', value: false };
        const a = parseRef(t.value);
        if (a) {
          if (peek() && peek().type === 'colon') {
            next();
            const t2 = next();
            const b = t2 && t2.type === 'id' ? parseRef(t2.value) : null;
            if (!b) throw new XlError('SYNTAX', `After the ":" I expected a cell name, like ${t.value}:B5.`);
            return { type: 'range', a: { c: Math.min(a.c, b.c), r: Math.min(a.r, b.r) }, b: { c: Math.max(a.c, b.c), r: Math.max(a.r, b.r) } };
          }
          return { type: 'ref', c: a.c, r: a.r };
        }
        return { type: 'name', name: t.value };
      }
      throw new XlError('SYNTAX', `Unexpected "${t.type === 'op' ? t.value : t.type === 'rp' ? ')' : t.type === 'comma' ? ',' : ':'}" here. Check for a missing number or cell name before it.`);
    }

    const ast = expr();
    if (p < toks.length) {
      const t = toks[p];
      if (t.type === 'rp') throw new XlError('SYNTAX', 'There is a closing bracket ")" without a matching opening "(".');
      throw new XlError('SYNTAX', 'Something is out of place near the end of the formula. Did you forget an operator like + or * between two items?');
    }
    return ast;
  }

  /* ---------------- Evaluation ---------------- */
  function scalar(v) {
    if (v instanceof Range) {
      if (v.data.length === 1 && v.data[0].length === 1) return v.data[0][0];
      throw new XlError('#VALUE!', 'A whole group of cells was used where a single value was expected. Pick one cell, or wrap the group in a function like SUM().');
    }
    return v;
  }
  function toNum(v) {
    v = scalar(v);
    if (v === null || v === undefined || v === '') return 0;
    if (typeof v === 'number') return v;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (typeof v === 'string') {
      const s = v.trim();
      if (s !== '' && !isNaN(Number(s))) return Number(s);
      throw new XlError('#VALUE!', `The formula tried to do maths with the text "${v}". Maths only works with numbers.`);
    }
    return 0;
  }
  function toText(v) {
    v = scalar(v);
    if (v === null || v === undefined) return '';
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
    return String(v);
  }
  function toBool(v) {
    v = scalar(v);
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    if (typeof v === 'string') {
      if (v.toUpperCase() === 'TRUE') return true;
      if (v.toUpperCase() === 'FALSE') return false;
    }
    if (v === null) return false;
    throw new XlError('#VALUE!', `"${v}" is not a TRUE/FALSE answer.`);
  }
  function compare(a, b) {
    a = scalar(a); b = scalar(b);
    if (a === null) a = typeof b === 'string' ? '' : 0;
    if (b === null) b = typeof a === 'string' ? '' : 0;
    if (typeof a === 'string' && typeof b === 'string') {
      const x = a.toLowerCase(), y = b.toLowerCase();
      return x < y ? -1 : x > y ? 1 : 0;
    }
    if (typeof a === 'string') return 1; // text sorts after numbers in Excel
    if (typeof b === 'string') return -1;
    a = Number(a); b = Number(b);
    return a < b ? -1 : a > b ? 1 : 0;
  }
  function matchesCriteria(val, crit) {
    crit = scalar(crit);
    let op = '=', target = crit;
    if (typeof crit === 'string') {
      const m = /^(<>|<=|>=|=|<|>)(.*)$/.exec(crit);
      if (m) { op = m[1]; target = m[2]; }
      if (target !== '' && !isNaN(Number(target))) target = Number(target);
    }
    if (val === null) val = '';
    if (typeof target === 'number' && typeof val !== 'number') {
      if (op === '=') return false;
      if (op === '<>') return true;
      return false;
    }
    if (typeof target === 'string' && typeof val === 'number') return op === '<>';
    const c = compare(val, target);
    switch (op) {
      case '=': return c === 0;
      case '<>': return c !== 0;
      case '<': return c < 0;
      case '>': return c > 0;
      case '<=': return c <= 0;
      default: return c >= 0;
    }
  }
  function nums(vals) {
    const out = [];
    for (const v of vals) {
      if (v instanceof Range) { for (const x of v.flat()) if (typeof x === 'number') out.push(x); }
      else if (v !== null && v !== undefined) out.push(toNum(v));
    }
    return out;
  }
  const needArgs = (name, args, min, max, hint) => {
    if (args.length < min || args.length > max) {
      throw new XlError('#VALUE!', `${name} needs ${min === max ? min : `${min}${max === Infinity ? ' or more' : ' to ' + max}`} item${max === 1 ? '' : 's'} inside its brackets${hint ? ': ' + hint : ''}. You gave ${args.length}.`);
    }
  };

  const FUNCS = {
    SUM: (a, ev) => nums(a.map(ev)).reduce((x, y) => x + y, 0),
    AVERAGE: (a, ev) => {
      const n = nums(a.map(ev));
      if (!n.length) throw new XlError('#DIV/0!', 'AVERAGE found no numbers to average. Check that the cells you picked contain numbers, not text.');
      return n.reduce((x, y) => x + y, 0) / n.length;
    },
    MIN: (a, ev) => { const n = nums(a.map(ev)); return n.length ? Math.min(...n) : 0; },
    MAX: (a, ev) => { const n = nums(a.map(ev)); return n.length ? Math.max(...n) : 0; },
    PRODUCT: (a, ev) => nums(a.map(ev)).reduce((x, y) => x * y, 1),
    COUNT: (a, ev) => nums(a.map(ev)).length,
    COUNTA: (a, ev) => a.map(ev).reduce((n, v) => n + (v instanceof Range ? v.flat().filter((x) => x !== null && x !== '').length : (v === null ? 0 : 1)), 0),
    ROUND: (a, ev) => {
      needArgs('ROUND', a, 2, 2, 'the number, then how many decimal places');
      const n = toNum(ev(a[0])), d = toNum(ev(a[1]));
      const f = Math.pow(10, d);
      return Math.sign(n) * Math.round(Math.abs(n) * f + 1e-9) / f;
    },
    ABS: (a, ev) => { needArgs('ABS', a, 1, 1); return Math.abs(toNum(ev(a[0]))); },
    IF: (a, ev) => {
      needArgs('IF', a, 2, 3, 'a test, what to show if it is true, what to show if not');
      const test = toBool(ev(a[0]));
      if (test) return a[1].type === 'blank' ? 0 : scalar(ev(a[1]));
      if (a.length < 3) return false;
      return a[2].type === 'blank' ? 0 : scalar(ev(a[2]));
    },
    IFERROR: (a, ev) => {
      needArgs('IFERROR', a, 2, 2, 'the formula, then what to show if it has an error');
      try { return scalar(ev(a[0])); } catch (e) { if (e instanceof XlError) return scalar(ev(a[1])); throw e; }
    },
    AND: (a, ev) => a.every((x) => toBool(ev(x))),
    OR: (a, ev) => a.some((x) => toBool(ev(x))),
    NOT: (a, ev) => { needArgs('NOT', a, 1, 1); return !toBool(ev(a[0])); },
    SUMIF: (a, ev) => {
      needArgs('SUMIF', a, 2, 3, 'the cells to check, the rule, and (optionally) the cells to add up');
      const r = ev(a[0]), crit = ev(a[1]);
      const sumR = a[2] ? ev(a[2]) : r;
      if (!(r instanceof Range)) throw new XlError('#VALUE!', 'SUMIF needs a group of cells (like A1:A10) as its first item.');
      const rf = r.flat(), sf = sumR.flat();
      let t = 0;
      rf.forEach((v, i) => { if (matchesCriteria(v, crit) && typeof sf[i] === 'number') t += sf[i]; });
      return t;
    },
    COUNTIF: (a, ev) => {
      needArgs('COUNTIF', a, 2, 2, 'the cells to check, then the rule');
      const r = ev(a[0]), crit = ev(a[1]);
      if (!(r instanceof Range)) throw new XlError('#VALUE!', 'COUNTIF needs a group of cells (like A1:A10) as its first item.');
      return r.flat().filter((v) => matchesCriteria(v, crit)).length;
    },
    AVERAGEIF: (a, ev) => {
      needArgs('AVERAGEIF', a, 2, 3, 'the cells to check, the rule, and (optionally) the cells to average');
      const r = ev(a[0]), crit = ev(a[1]);
      const avgR = a[2] ? ev(a[2]) : r;
      const rf = r.flat(), sf = avgR.flat();
      const hits = [];
      rf.forEach((v, i) => { if (matchesCriteria(v, crit) && typeof sf[i] === 'number') hits.push(sf[i]); });
      if (!hits.length) throw new XlError('#DIV/0!', 'No cells matched your rule, so there is nothing to average.');
      return hits.reduce((x, y) => x + y, 0) / hits.length;
    },
    VLOOKUP: (a, ev) => {
      needArgs('VLOOKUP', a, 3, 4, 'what to find, the table, the column number, and FALSE for an exact match');
      const key = scalar(ev(a[0])), table = ev(a[1]), col = toNum(ev(a[2]));
      if (!(table instanceof Range)) throw new XlError('#VALUE!', 'VLOOKUP needs a table of cells (like A2:C10) as its second item.');
      if (col < 1 || col > table.data[0].length) throw new XlError('#REF!', `The column number ${col} is outside your table, which has ${table.data[0].length} column(s).`);
      const exactOnly = a[3] ? !toBool(ev(a[3])) : false;
      if (exactOnly) {
        for (const row of table.data) if (row[0] !== null && typeof row[0] === typeof key && compare(row[0], key) === 0) return row[col - 1];
      } else {
        let hit = null;
        for (const row of table.data) if (row[0] !== null && typeof row[0] === typeof key && compare(row[0], key) <= 0) hit = row;
        if (hit) return hit[col - 1];
      }
      throw new XlError('#N/A', `Could not find "${toText(key)}" in the first column of the table. Check the spelling and look for extra spaces. (Tip: end the formula with ,FALSE to ask for an exact match.)`);
    },
    UPPER: (a, ev) => { needArgs('UPPER', a, 1, 1); return toText(ev(a[0])).toUpperCase(); },
    LOWER: (a, ev) => { needArgs('LOWER', a, 1, 1); return toText(ev(a[0])).toLowerCase(); },
    PROPER: (a, ev) => { needArgs('PROPER', a, 1, 1); return toText(ev(a[0])).toLowerCase().replace(/(^|[^a-z])([a-z])/g, (m, p, c) => p + c.toUpperCase()); },
    LEN: (a, ev) => { needArgs('LEN', a, 1, 1); return toText(ev(a[0])).length; },
    TRIM: (a, ev) => { needArgs('TRIM', a, 1, 1); return toText(ev(a[0])).trim().replace(/\s+/g, ' '); },
    CONCAT: (a, ev) => a.map((x) => { const v = ev(x); return v instanceof Range ? v.flat().map(toText).join('') : toText(v); }).join(''),
    TODAY: (a) => { needArgs('TODAY', a, 0, 0); const d = new Date(); return d.toISOString().slice(0, 10); },
  };
  FUNCS.CONCATENATE = FUNCS.CONCAT;

  function evaluate(n, ctx) {
    switch (n.type) {
      case 'num': case 'str': case 'bool': return n.value;
      case 'blank': return null;
      case 'ref': return ctx.cell(n.c, n.r);
      case 'range': return ctx.range(n.a, n.b);
      case 'neg': return -toNum(evaluate(n.x, ctx));
      case 'pct': return toNum(evaluate(n.x, ctx)) / 100;
      case 'name': throw new XlError('#NAME?', `Excel doesn't recognise "${n.name}". If it's a function, check the spelling; if it's text, put it in "double quotes"; if it's a cell, it looks like A1 (letter then number).`);
      case 'bin': {
        const l = evaluate(n.l, ctx), r = evaluate(n.r, ctx);
        switch (n.op) {
          case '+': return toNum(l) + toNum(r);
          case '-': return toNum(l) - toNum(r);
          case '*': return toNum(l) * toNum(r);
          case '/': {
            const d = toNum(r);
            if (d === 0) throw new XlError('#DIV/0!', 'The formula divides by zero (or by an empty cell). Nothing can be divided by zero — check the number or cell after the "/".');
            return toNum(l) / d;
          }
          case '^': return Math.pow(toNum(l), toNum(r));
          case '&': return toText(l) + toText(r);
          case '=': return compare(l, r) === 0;
          case '<>': return compare(l, r) !== 0;
          case '<': return compare(l, r) < 0;
          case '>': return compare(l, r) > 0;
          case '<=': return compare(l, r) <= 0;
          case '>=': return compare(l, r) >= 0;
        }
        break;
      }
      case 'call': {
        const fn = FUNCS[n.name];
        if (!fn) throw new XlError('#NAME?', `Excel doesn't know a function called ${n.name}. Check the spelling (e.g. SUM, AVERAGE, IF).`);
        return fn(n.args, (x) => evaluate(x, ctx));
      }
    }
    throw new XlError('#VALUE!', 'Something in this formula could not be worked out.');
  }

  /* ---------------- Plain-English description ---------------- */
  const FN_TEXT = {
    SUM: (a) => `adds up all the numbers in ${a.join(' and ')}`,
    AVERAGE: (a) => `finds the average of ${a.join(' and ')}`,
    MIN: (a) => `finds the smallest number in ${a.join(' and ')}`,
    MAX: (a) => `finds the largest number in ${a.join(' and ')}`,
    COUNT: (a) => `counts how many cells in ${a.join(' and ')} contain numbers`,
    COUNTA: (a) => `counts how many cells in ${a.join(' and ')} are not empty`,
    PRODUCT: (a) => `multiplies together ${a.join(' and ')}`,
    ROUND: (a) => `rounds ${a[0]} to ${a[1]} decimal place(s)`,
    ABS: (a) => `turns ${a[0]} into a positive number`,
    IF: (a) => `checks whether ${a[0]}. If yes, it shows ${a[1]}${a[2] ? '; if not, it shows ' + a[2] : ''}`,
    IFERROR: (a) => `tries ${a[0]}, and shows ${a[1]} instead if that goes wrong`,
    AND: (a) => `is TRUE only when all of these are true: ${a.join('; ')}`,
    OR: (a) => `is TRUE when at least one of these is true: ${a.join('; ')}`,
    NOT: (a) => `flips TRUE/FALSE for ${a[0]}`,
    SUMIF: (a) => `adds up ${a[2] || a[0]} but only where ${a[0]} matches ${a[1]}`,
    COUNTIF: (a) => `counts the cells in ${a[0]} that match ${a[1]}`,
    AVERAGEIF: (a) => `averages ${a[2] || a[0]} but only where ${a[0]} matches ${a[1]}`,
    VLOOKUP: (a) => `looks for ${a[0]} down the first column of ${a[1]}, then gives back the value from column ${a[2]}`,
    UPPER: (a) => `turns ${a[0]} into CAPITAL LETTERS`,
    LOWER: (a) => `turns ${a[0]} into lowercase letters`,
    PROPER: (a) => `gives ${a[0]} a Capital Letter On Each Word`,
    LEN: (a) => `counts the characters in ${a[0]}`,
    TRIM: (a) => `removes extra spaces from ${a[0]}`,
    CONCAT: (a) => `joins together ${a.join(', ')}`,
    TODAY: () => "shows today's date",
  };
  FN_TEXT.CONCATENATE = FN_TEXT.CONCAT;
  const OP_WORD = { '+': 'plus', '-': 'minus', '*': 'times', '/': 'divided by', '^': 'to the power of', '&': 'joined to', '=': 'equals', '<>': 'is different from', '<': 'is less than', '>': 'is more than', '<=': 'is at most', '>=': 'is at least' };
  function describe(n) {
    switch (n.type) {
      case 'num': return String(n.value);
      case 'str': return `the text "${n.value}"`;
      case 'bool': return n.value ? 'TRUE' : 'FALSE';
      case 'blank': return 'nothing';
      case 'ref': return `the value in ${refName(n.c, n.r)}`;
      case 'range': return `the cells ${refName(n.a.c, n.a.r)} to ${refName(n.b.c, n.b.r)}`;
      case 'neg': return `minus ${describe(n.x)}`;
      case 'pct': return `${describe(n.x)} percent`;
      case 'name': return `"${n.name}" (not recognised)`;
      case 'bin': return `${describe(n.l)} ${OP_WORD[n.op]} ${describe(n.r)}`;
      case 'call': {
        const f = FN_TEXT[n.name];
        if (!f) return `${n.name} (not a function I know)`;
        return f(n.args.map(describe));
      }
    }
    return '';
  }
  function explain(text) {
    const ast = parseFormula(text);
    const s = describe(ast);
    return 'This ' + (ast.type === 'call' ? s.replace(/^/, '') : 'works out ' + s) + '.';
  }

  /* ---------------- Friendly formula checker ---------------- */
  function walk(n, fn) {
    fn(n);
    if (n.args) n.args.forEach((x) => walk(x, fn));
    ['l', 'r', 'x'].forEach((k) => { if (n[k]) walk(n[k], fn); });
  }
  function checkFormula(text) {
    const tips = [];
    const raw = text.trim();
    if (!raw) return { ok: false, tips: ['Type or paste a formula above and I will check it for you.'] };
    if (!raw.startsWith('=')) tips.push('Every formula must start with an equals sign (=). Without it, Excel treats what you typed as plain text. Type = first.');
    if (/[“”‘’]/.test(raw)) tips.push('Your formula has "curly" quote marks (often from copying out of Word or email). Excel needs straight quotes ". Retype the quotes.');
    if (/;/.test(raw)) tips.push('You used a semicolon (;). Most versions of Excel want a comma (,) between items. (Some European settings use semicolons — if commas fail, try semicolons.)');
    const opens = (raw.match(/\(/g) || []).length, closes = (raw.match(/\)/g) || []).length;
    if (opens > closes) tips.push(`You have ${opens - closes} more "(" than ")". Add ${opens - closes} closing bracket(s) ")" at the end.`);
    if (closes > opens) tips.push(`You have ${closes - opens} more ")" than "(". Remove the extra closing bracket(s).`);
    if (/\s=\s*$|[+\-*/^&]\s*$/.test(raw)) tips.push('The formula ends with a symbol like + or *. Something should come after it (a number or a cell name).');
    if (/\b[A-Za-z]+\d+\s*[A-Za-z]+\d+\b/.test(raw.replace(/"[^"]*"/g, ''))) tips.push('Two cell names sit side by side with nothing between them. Put an operator (+ - * /) or a comma between them.');
    let ast = null;
    try { ast = parseFormula(raw); } catch (e) { if (e instanceof XlError) { if (opens === closes && (!tips.length || e.code === 'SYNTAX')) tips.push(e.friendly); else if (opens === closes) { /* already explained above */ } } else throw e; }
    if (ast) {
      walk(ast, (n) => {
        if (n.type === 'call' && !FUNCS[n.name]) tips.push(`"${n.name}" is not a function this checker knows. Excel has hundreds of functions, so it may be fine in Excel — but double-check the spelling.`);
        if (n.type === 'name') tips.push(`"${n.name}" isn't a cell name, number, or function. If it should be text, put it in double quotes like "${n.name}".`);
        if (n.type === 'bin' && n.op === '/' && n.r.type === 'num' && n.r.value === 0) tips.push('You are dividing by 0, which always gives #DIV/0!.');
      });
    }
    const ok = tips.length === 0;
    if (ok) tips.push('Looks good! ' + explain(raw));
    return { ok, tips };
  }

  /* ---------------- Sheet ---------------- */
  class Sheet {
    constructor(cols, rows) {
      this.cols = cols; this.rows = rows;
      this.raw = {}; this.cache = new Map(); this.asts = new Map(); this.stack = new Set();
    }
    set(ref, text) {
      text = text == null ? '' : String(text);
      if (text === '') delete this.raw[ref]; else this.raw[ref] = text;
      this.cache.clear(); this.asts.delete(ref);
    }
    getRaw(ref) { return this.raw[ref] || ''; }
    clear() { this.raw = {}; this.cache.clear(); this.asts.clear(); }
    snapshot() { return JSON.stringify(this.raw); }
    restore(s) { this.raw = JSON.parse(s); this.cache.clear(); this.asts.clear(); }
    valueAt(c, r) {
      if (c < 1 || r < 1 || c > this.cols || r > this.rows) {
        throw new XlError('#REF!', `The formula points at a cell that doesn't exist on this sheet (the sheet goes from A1 to ${refName(this.cols, this.rows)}).`);
      }
      const ref = refName(c, r);
      if (this.cache.has(ref)) return this.cache.get(ref);
      const raw = this.raw[ref];
      let v;
      if (raw === undefined) v = null;
      else if (raw.startsWith('=')) {
        if (this.stack.has(ref)) return new XlError('#CIRC!', `${ref} refers to itself (directly or through other cells), which creates a loop. Change the formula so it doesn't use its own cell.`);
        this.stack.add(ref);
        try {
          let ast = this.asts.get(ref);
          if (!ast) { ast = parseFormula(raw); this.asts.set(ref, ast); }
          v = scalarOut(evaluate(ast, this.ctx()));
        } catch (e) {
          if (e instanceof XlError) v = e;
          else v = new XlError('#VALUE!', 'Something in this formula could not be worked out.');
        } finally { this.stack.delete(ref); }
      } else if (raw.trim() !== '' && !isNaN(Number(raw))) v = Number(raw);
      else v = raw;
      this.cache.set(ref, v);
      return v;
    }
    ctx() {
      const self = this;
      const get = (c, r) => { const v = self.valueAt(c, r); if (v instanceof XlError) throw v; return v; };
      return {
        cell: get,
        range(a, b) {
          const data = [];
          for (let r = a.r; r <= b.r; r++) { const row = []; for (let c = a.c; c <= b.c; c++) row.push(get(c, r)); data.push(row); }
          return new Range(data);
        },
      };
    }
    value(ref) { const p = parseRef(ref); return this.valueAt(p.c, p.r); }
  }
  function scalarOut(v) { return v instanceof Range ? scalar(v) : v; }

  function formatValue(v) {
    if (v instanceof XlError) return v.code;
    if (v === null || v === undefined) return '';
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
    if (typeof v === 'number') {
      if (!isFinite(v)) return '#NUM!';
      return String(+v.toPrecision(12));
    }
    return String(v);
  }

  const api = { Sheet, XlError, parseFormula, describe, explain, checkFormula, formatValue, numToCol, colToNum, parseRef, refName, FUNCS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ExcelEasy = api;
})(typeof window !== 'undefined' ? window : globalThis);
