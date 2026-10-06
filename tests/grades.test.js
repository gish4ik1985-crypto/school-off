import test from 'node:test';
import assert from 'node:assert/strict';
import { validEnds, normalizeEnds, DEFAULT_ENDS, schoolYearOf, yearLabel, periodRange, periodSummary, setFinal, yearsWithData } from '../js/grades.js';

let n = 0;
const uid = () => `f${++n}`;
const mk = (over = {}) => ({
  children: [{ id: 'c1' }],
  subjects: [{ id: 'm', name: 'Математика' }, { id: 'r', name: 'Русский язык' }],
  tasks: [],
  grades: [],
  remarks: [],
  schedule: [],
  finals: [],
  ...over,
});

test('schoolYearOf и yearLabel', () => {
  assert.equal(schoolYearOf('2026-09-01'), 2026);
  assert.equal(schoolYearOf('2026-12-31'), 2026);
  assert.equal(schoolYearOf('2027-01-01'), 2026);
  assert.equal(schoolYearOf('2027-08-31'), 2026);
  assert.equal(yearLabel(2026), '2026/27');
  assert.equal(yearLabel(2099), '2099/00');
});

test('validEnds: допустимые и недопустимые границы четвертей', () => {
  assert.ok(validEnds(DEFAULT_ENDS));
  assert.ok(validEnds(['10-27', '12-28', '03-23', '05-25']));
  assert.ok(!validEnds(['12-31', '10-31', '03-31', '05-31'])); // не по порядку
  assert.ok(!validEnds(['10-31', '12-31', '03-31', '09-01'])); // последняя четверть заканчивается после начала года
  assert.ok(!validEnds(['10-31', '12-31', '02-30', '05-31'])); // несуществующая дата
  assert.ok(!validEnds(['10-31', '12-31', '03-31']));
  assert.ok(!validEnds(null));
  assert.deepEqual(normalizeEnds(['bad']), DEFAULT_ENDS);
});

test('periodRange: четверти идут подряд через границу года', () => {
  const r = (id) => periodRange(2026, id, DEFAULT_ENDS);
  assert.deepEqual(r('q1'), { from: '2026-09-01', to: '2026-10-31' });
  assert.deepEqual(r('q2'), { from: '2026-11-01', to: '2026-12-31' });
  assert.deepEqual(r('q3'), { from: '2027-01-01', to: '2027-03-31' });
  assert.deepEqual(r('q4'), { from: '2027-04-01', to: '2027-05-31' });
  assert.deepEqual(r('year'), { from: '2026-09-01', to: '2027-08-31' });
  // 29 февраля в невисокосный год сдвигается на 28-е
  assert.equal(periodRange(2026, 'q3', ['10-31', '12-31', '02-29', '05-31']).to, '2027-02-28');
});

test('periodSummary: средние, итоговые, значение периода и итоговая строка', () => {
  const g = (subjectId, date, value) => ({ childId: 'c1', subjectId, date, value });
  const st = mk({
    grades: [
      g('m', '2026-09-10', 5), g('m', '2026-10-05', 4), // 1 четверть: ср. 4,5
      g('m', '2026-11-12', 3), // 2 четверть
      g('r', '2026-09-20', 5),
      g('m', '2025-10-01', 2), // прошлый год — в сводку 2026/27 не попадает
      { childId: 'other', subjectId: 'm', date: '2026-09-10', value: 1 },
    ],
    finals: [
      { id: 'a', childId: 'c1', subjectId: 'm', year: 2026, period: 'q1', value: 4 },
      { id: 'b', childId: 'c1', subjectId: 'm', year: 2025, period: 'q1', value: 3 },
    ],
  });
  const s = periodSummary(st, 'c1', 2026, DEFAULT_ENDS);
  const m = s.rows[0].cells;
  assert.equal(m.q1.avg, 4.5);
  assert.equal(m.q1.count, 2);
  assert.equal(m.q1.final, 4);
  assert.equal(m.q1.value, 4); // итоговая важнее среднего
  assert.equal(m.q2.value, 3); // итоговой нет — берём средний
  assert.equal(m.q3.value, null);
  assert.equal(m.year.count, 3);
  assert.equal(s.rows[1].cells.q1.value, 5);
  assert.equal(s.totals.q1, 4.5); // (4 + 5) / 2
  assert.equal(s.totals.q3, null);
});

test('setFinal: создаёт, обновляет, удаляет, проверяет', () => {
  const st = mk();
  const cell = { childId: 'c1', subjectId: 'm', year: 2024, period: 'q2' };
  assert.equal(setFinal(st, { ...cell, value: '4' }, uid).final.value, 4);
  assert.equal(setFinal(st, { ...cell, value: '5' }, uid).final.value, 5);
  assert.equal(st.finals.length, 1);
  assert.ok(setFinal(st, { ...cell, value: '7' }, uid).blocked);
  assert.ok(setFinal(st, { ...cell, period: 'q9', value: '4' }, uid).blocked);
  assert.equal(st.finals[0].value, 5);
  setFinal(st, { ...cell, period: 'year', value: '4' }, uid); // другой период — отдельная запись
  assert.equal(st.finals.length, 2);
  assert.deepEqual(setFinal(st, { ...cell, value: '' }, uid), { final: null });
  assert.equal(st.finals.length, 1);
});

test('yearsWithData: текущий год и годы с данными по возрастанию', () => {
  const st = mk({
    grades: [{ childId: 'c1', subjectId: 'm', date: '2025-03-01', value: 5 }, { childId: 'other', subjectId: 'm', date: '2020-03-01', value: 5 }],
    finals: [{ childId: 'c1', year: 2023, period: 'year', subjectId: 'm', value: 4 }],
  });
  assert.deepEqual(yearsWithData(st, 'c1', 2026), [2023, 2024, 2026]);
});
