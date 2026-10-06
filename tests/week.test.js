import test from 'node:test';
import assert from 'node:assert/strict';
import { weekStart, weeklySummary, summaryText } from '../js/week.js';

const today = '2026-10-08'; // четверг
const mk = (over = {}) => ({
  children: [{ id: 'c1' }],
  subjects: [{ id: 'm', name: 'Математика' }, { id: 'r', name: 'Русский язык' }],
  tasks: [],
  grades: [],
  remarks: [],
  schedule: [],
  ...over,
});

test('weekStart: понедельник недели', () => {
  assert.equal(weekStart('2026-10-06'), '2026-10-05');
  assert.equal(weekStart('2026-10-05'), '2026-10-05');
  assert.equal(weekStart('2026-10-11'), '2026-10-05');
});

test('weeklySummary: задания, оценки, фокус, советы', () => {
  const state = mk({
    tasks: [
      { childId: 'c1', subjectId: 'm', status: 'todo', due: '2026-10-05', text: 'a' },
      { childId: 'c1', subjectId: 'r', status: 'checked', due: '2026-10-06', text: 'b' },
      { childId: 'c1', subjectId: 'r', status: 'done', due: '2026-10-07', text: 'c' },
      { childId: 'c1', subjectId: 'm', status: 'todo', due: '2026-10-12', text: 'next' },
      { childId: 'other', subjectId: 'm', status: 'todo', due: '2026-10-05', text: 'x' },
    ],
    grades: [
      { childId: 'c1', subjectId: 'm', value: 2, date: '2026-10-06' },
      { childId: 'c1', subjectId: 'r', value: 5, date: '2026-10-06' },
      { childId: 'c1', subjectId: 'r', value: 4, date: '2026-09-30' },
    ],
    remarks: [
      { childId: 'c1', type: 'negative', date: '2026-10-05', text: 'шумел', subjectId: 'm' },
      { childId: 'c1', type: 'positive', date: '2026-10-06', text: 'помог' },
    ],
  });
  const s = weeklySummary(state, 'c1', '2026-10-05', today);
  assert.equal(s.tasks.total, 3);
  assert.equal(s.tasks.finished, 2);
  assert.equal(s.tasks.missed.length, 1);
  assert.equal(s.grades.avg, 3.5);
  assert.equal(s.grades.prevAvg, 4);
  assert.equal(s.grades.low, 1);
  assert.equal(s.remarks.negative.length, 1);
  assert.equal(s.remarks.positive.length, 1);
  assert.equal(s.focus[0].subject, 'Математика');
  assert.deepEqual(s.focus[0].reasons, ['не сдано заданий: 1', 'оценки 2', 'замечание']);
  assert.equal(s.next, 1);
  assert.ok(s.tips.some((t) => t.startsWith('Закрыть долги (1): Математика')));
  assert.ok(s.tips.some((t) => t.startsWith('Проверить сделанное: 1 задание')));
  assert.match(summaryText(s, 'Миша'), /Сводка за неделю 05\.10–11\.10: Миша/);
});

test('weeklySummary: пустая и благополучная неделя', () => {
  const empty = weeklySummary(mk(), 'c1', '2026-10-05', today);
  assert.equal(empty.empty, true);
  assert.match(empty.tips[0], /нет записей/);
  const good = weeklySummary(mk({ grades: [{ childId: 'c1', subjectId: 'm', value: 5, date: '2026-10-06' }] }), 'c1', '2026-10-05', today);
  assert.equal(good.focus.length, 0);
  assert.match(good.tips[0], /хорошо/);
});

test('weeklySummary: ещё не наступившие задания недели не считаются долгом', () => {
  const state = mk({ tasks: [{ childId: 'c1', subjectId: 'm', status: 'todo', due: '2026-10-09', text: 'fri' }] });
  const s = weeklySummary(state, 'c1', '2026-10-05', today);
  assert.equal(s.tasks.missed.length, 0);
  assert.equal(s.tasks.open, 1);
});
