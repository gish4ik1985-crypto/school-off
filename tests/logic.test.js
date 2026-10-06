import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../js/logic.js';

const today = '2026-10-06';
const mk = (over = {}) => ({
  children: [{ id: 'c1' }],
  subjects: [{ id: 'm', name: 'Математика' }, { id: 'r', name: 'Русский язык' }],
  tasks: [],
  grades: [],
  remarks: [],
  schedule: [],
  ...over,
});

test('addDays и формат дат', () => {
  assert.equal(L.addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(L.addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(L.formatDate('2026-10-06'), '06.10');
  assert.equal(L.formatDateLong('2026-10-06'), 'вт 06.10');
});

test('plural', () => {
  assert.equal(L.plural(1, ['задание', 'задания', 'заданий']), 'задание');
  assert.equal(L.plural(3, ['задание', 'задания', 'заданий']), 'задания');
  assert.equal(L.plural(5, ['задание', 'задания', 'заданий']), 'заданий');
  assert.equal(L.plural(11, ['задание', 'задания', 'заданий']), 'заданий');
  assert.equal(L.plural(21, ['задание', 'задания', 'заданий']), 'задание');
});

test('taskStatus', () => {
  assert.equal(L.taskStatus({ status: 'todo', due: '2026-10-05' }, today), 'overdue');
  assert.equal(L.taskStatus({ status: 'todo', due: today }, today), 'today');
  assert.equal(L.taskStatus({ status: 'todo', due: '2026-10-07' }, today), 'upcoming');
  assert.equal(L.taskStatus({ status: 'done', due: '2026-10-01' }, today), 'done');
  assert.equal(L.taskStatus({ status: 'checked', due: '2026-10-01' }, today), 'checked');
});

test('subjectStats: средний балл и тренд', () => {
  const grades = [5, 5, 5, 3, 3, 3].map((value, i) => ({ subjectId: 'm', value, date: `2026-09-0${i + 1}` }));
  const [st] = L.subjectStats(grades, mk().subjects);
  assert.equal(st.avg, 4);
  assert.equal(st.trend, -2);
  assert.equal(L.trend(grades.slice(0, 3)), null);
});

test('attention: просрочка, проверка, низкие оценки, замечания', () => {
  const state = mk({
    tasks: [
      { childId: 'c1', status: 'todo', due: '2026-10-01' },
      { childId: 'c1', status: 'done', due: '2026-10-05' },
    ],
    grades: [{ childId: 'c1', subjectId: 'm', value: 2, date: '2026-10-04' }],
    remarks: [
      { childId: 'c1', type: 'negative', date: '2026-10-02' },
      { childId: 'c1', type: 'negative', date: '2026-10-03' },
      { childId: 'c1', type: 'positive', date: '2026-10-03' },
    ],
  });
  const items = L.attention(state, 'c1', today);
  assert.deepEqual(
    items.map((i) => i.level),
    ['high', 'high', 'high', 'info'],
  );
  assert.match(items.find((i) => i.tab === 'grades').text, /Математика 2 \(04\.10\)/);
  assert.match(items.find((i) => i.tab === 'remarks').text, /: 2$/);
});

test('attention: ничего подозрительного', () => {
  const state = mk({ grades: [{ childId: 'c1', subjectId: 'm', value: 5, date: '2026-10-04' }] });
  assert.deepEqual(L.attention(state, 'c1', today), []);
});

test('attention: чужие данные не попадают', () => {
  const state = mk({ tasks: [{ childId: 'other', status: 'todo', due: '2026-10-01' }] });
  assert.deepEqual(L.attention(state, 'c1', today), []);
});

test('dow и расписание', () => {
  assert.equal(L.dow('2026-10-06'), 2); // вторник
  assert.equal(L.dow('2026-10-11'), 7); // воскресенье
  const state = mk({
    schedule: [
      { childId: 'c1', day: 3, num: 2, subjectId: 'r' },
      { childId: 'c1', day: 3, num: 1, subjectId: 'm' },
      { childId: 'c1', day: 5, num: 1, subjectId: 'm' },
      { childId: 'other', day: 2, num: 1, subjectId: 'm' },
    ],
  });
  assert.deepEqual(L.lessonsOn(state, 'c1', '2026-10-07').map((l) => l.subjectId), ['m', 'r']);
  assert.equal(L.nextLessonDate(state, 'c1', 'm', today), '2026-10-07');
  assert.equal(L.nextLessonDate(state, 'c1', 'm', '2026-10-07'), '2026-10-09');
  assert.equal(L.nextLessonDate(state, 'c1', 'x', today), null);
});
