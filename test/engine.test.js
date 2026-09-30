'use strict';
const assert = require('assert');
const E = require('../premium/engine.js');

function sheet(cells) {
  const s = new E.Sheet(8, 20);
  for (const [k, v] of Object.entries(cells)) s.set(k, v);
  return s;
}
const val = (s, ref) => E.formatValue(s.value(ref));

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok -', name); };

t('arithmetic & precedence', () => {
  const s = sheet({ A1: '=1+2*3', A2: '=(1+2)*3', A3: '=2^3', A4: '=-2+5', A5: '=50%', A6: '=0.1+0.2' });
  assert.equal(val(s, 'A1'), '7'); assert.equal(val(s, 'A2'), '9'); assert.equal(val(s, 'A3'), '8');
  assert.equal(val(s, 'A4'), '3'); assert.equal(val(s, 'A5'), '0.5'); assert.equal(val(s, 'A6'), '0.3');
});
t('SUM/AVERAGE/MIN/MAX/COUNT', () => {
  const s = sheet({ A1: '4', A2: '6', A3: 'hello', A4: '10', B1: '=SUM(A1:A4)', B2: '=AVERAGE(A1:A4)', B3: '=MIN(A1:A4)', B4: '=MAX(A1:A4)', B5: '=COUNT(A1:A4)', B6: '=COUNTA(A1:A4)' });
  assert.equal(val(s, 'B1'), '20'); assert.equal(val(s, 'B2'), '6.66666666667');
  assert.equal(val(s, 'B3'), '4'); assert.equal(val(s, 'B4'), '10'); assert.equal(val(s, 'B5'), '3'); assert.equal(val(s, 'B6'), '4');
});
t('IF, AND, OR, IFERROR', () => {
  const s = sheet({ A1: '75', B1: '=IF(A1>=50,"Pass","Fail")', B2: '=IF(AND(A1>10,A1<100),1,0)', B3: '=IFERROR(1/0,"oops")', B4: '=OR(A1<1,A1>70)' });
  assert.equal(val(s, 'B1'), 'Pass'); assert.equal(val(s, 'B2'), '1'); assert.equal(val(s, 'B3'), 'oops'); assert.equal(val(s, 'B4'), 'TRUE');
});
t('SUMIF / COUNTIF / AVERAGEIF', () => {
  const s = sheet({ A1: 'a', A2: 'b', A3: 'a', B1: '1', B2: '2', B3: '3', C1: '=SUMIF(A1:A3,"a",B1:B3)', C2: '=COUNTIF(B1:B3,">1")', C3: '=AVERAGEIF(A1:A3,"a",B1:B3)' });
  assert.equal(val(s, 'C1'), '4'); assert.equal(val(s, 'C2'), '2'); assert.equal(val(s, 'C3'), '2');
});
t('VLOOKUP exact and missing', () => {
  const s = sheet({ A1: 'x', B1: '10', A2: 'y', B2: '20', D1: '=VLOOKUP("y",A1:B2,2,FALSE)', D2: '=VLOOKUP("z",A1:B2,2,FALSE)' });
  assert.equal(val(s, 'D1'), '20'); assert.equal(val(s, 'D2'), '#N/A');
});
t('text functions and &', () => {
  const s = sheet({ A1: '  hello   world ', B1: '=PROPER(TRIM(A1))', B2: '="a"&"b"&1', B3: '=LEN("four")', B4: '=UPPER("x")' });
  assert.equal(val(s, 'B1'), 'Hello World'); assert.equal(val(s, 'B2'), 'ab1'); assert.equal(val(s, 'B3'), '4'); assert.equal(val(s, 'B4'), 'X');
});
t('errors have friendly messages', () => {
  const s = sheet({ A1: '=1/0', A2: '=FOO(1)', A3: '="a"+1', A4: '=A4', A5: '=Z99', A6: '=nonsense', A7: '=1+' });
  assert.equal(val(s, 'A1'), '#DIV/0!'); assert.equal(val(s, 'A2'), '#NAME?'); assert.equal(val(s, 'A3'), '#VALUE!');
  assert.equal(val(s, 'A4'), '#CIRC!'); assert.equal(val(s, 'A5'), '#REF!'); assert.equal(val(s, 'A6'), '#NAME?');
  assert.equal(val(s, 'A7'), 'SYNTAX');
  for (const r of ['A1', 'A2', 'A3', 'A4', 'A5']) assert.ok(s.value(r).friendly.length > 20);
});
t('errors propagate and empty cells are zero', () => {
  const s = sheet({ A1: '=1/0', A2: '=A1+1', A3: '=B9+1' });
  assert.equal(val(s, 'A2'), '#DIV/0!'); assert.equal(val(s, 'A3'), '1');
});
t('numbers stored as text in cells still add', () => {
  const s = sheet({ A1: '5', A2: '=A1*2' });
  assert.equal(val(s, 'A2'), '10');
});
t('describe / explain', () => {
  assert.match(E.explain('=SUM(A1:A5)'), /adds up all the numbers in the cells A1 to A5/);
  assert.match(E.explain('=A1+B1'), /plus/);
  assert.match(E.explain('=IF(A1>5,"Big","Small")'), /checks whether/);
});
t('checker catches common beginner mistakes', () => {
  assert.ok(E.checkFormula('SUM(A1:A3)').tips.some((x) => /equals sign/.test(x)));
  assert.ok(E.checkFormula('=SUM(A1:A3').tips.some((x) => /closing bracket/.test(x)));
  assert.ok(E.checkFormula('=SUM(A1;A2)').tips.some((x) => /semicolon/.test(x)));
  assert.ok(E.checkFormula('=IF(A1>1,“Yes”,“No”)').tips.some((x) => /curly/.test(x)));
  assert.ok(E.checkFormula('=SUMM(A1:A3)').tips.some((x) => /SUMM/.test(x)));
  assert.ok(E.checkFormula('=A1 B1').tips.some((x) => /side by side|out of place/.test(x)));
  assert.equal(E.checkFormula('=SUM(A1:A3)').ok, true);
});
t('formatValue', () => {
  assert.equal(E.formatValue(null), ''); assert.equal(E.formatValue(true), 'TRUE'); assert.equal(E.formatValue(1 / 3), '0.333333333333');
});
console.log(`\n${n} test groups passed`);
