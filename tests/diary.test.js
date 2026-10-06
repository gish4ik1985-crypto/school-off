import test from 'node:test';
import assert from 'node:assert/strict';
import { diaryWeek, saveHomework, saveGrade, setLessonSubject, weekDates } from '../js/diary.js';

let n = 0;
const uid = () => `id${++n}`;
const mk = () => ({
  children: [{ id: 'c1' }],
  subjects: [{ id: 'm', name: 'Математика' }, { id: 'r', name: 'Русский язык' }, { id: 'o', name: 'Окружающий мир' }],
  tasks: [],
  grades: [],
  remarks: [],
  schedule: [
    { id: 'l1', childId: 'c1', day: 1, num: 1, subjectId: 'm' },
    { id: 'l2', childId: 'c1', day: 1, num: 2, subjectId: 'r' },
    { id: 'l3', childId: 'c1', day: 1, num: 3, subjectId: 'm' }, // второй урок математики
    { id: 'l4', childId: 'other', day: 1, num: 1, subjectId: 'o' },
  ],
});
const MON = '2026-10-05';

test('weekDates: пн–пт и с субботой', () => {
  assert.deepEqual(weekDates(MON, false), ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09']);
  assert.equal(weekDates(MON, true).length, 6);
});

test('saveHomework: создаёт, обновляет, удаляет', () => {
  const st = mk();
  const cell = { childId: 'c1', subjectId: 'm', date: MON };
  const created = saveHomework(st, { ...cell, text: '  стр. 5 №1 ' }, uid, '2026-10-05T10:00:00Z');
  assert.equal(created.task.text, 'стр. 5 №1');
  assert.equal(created.task.due, MON);
  assert.equal(created.task.status, 'todo');
  assert.equal(st.tasks.length, 1);
  const upd = saveHomework(st, { ...cell, text: 'стр. 6' }, uid);
  assert.equal(st.tasks.length, 1);
  assert.equal(upd.task.id, created.task.id);
  assert.equal(st.tasks[0].text, 'стр. 6');
  assert.deepEqual(saveHomework(st, { ...cell, text: '   ' }, uid), { task: null });
  assert.equal(st.tasks.length, 0);
  assert.deepEqual(saveHomework(st, { ...cell, text: '' }, uid), { task: null }); // пустое по пустому — без ошибок
});

test('saveHomework: задание с фото не удаляется молча', () => {
  const st = mk();
  st.tasks.push({ id: 't', childId: 'c1', subjectId: 'm', due: MON, text: 'x', status: 'todo', photoIds: ['p1'] });
  const r = saveHomework(st, { childId: 'c1', subjectId: 'm', date: MON, text: '' }, uid);
  assert.ok(r.blocked);
  assert.equal(st.tasks.length, 1);
});

test('saveGrade: создаёт, обновляет, удаляет, проверяет диапазон', () => {
  const st = mk();
  const cell = { childId: 'c1', subjectId: 'm', date: MON };
  assert.equal(saveGrade(st, { ...cell, value: '5' }, uid).grade.value, 5);
  assert.equal(saveGrade(st, { ...cell, value: '4' }, uid).grade.value, 4);
  assert.equal(st.grades.length, 1);
  assert.ok(saveGrade(st, { ...cell, value: '9' }, uid).blocked);
  assert.equal(st.grades[0].value, 4);
  assert.deepEqual(saveGrade(st, { ...cell, value: '' }, uid), { grade: null });
  assert.equal(st.grades.length, 0);
});

test('setLessonSubject: ставит, меняет, очищает', () => {
  const st = mk();
  setLessonSubject(st, { childId: 'c1', day: 2, num: 1, subjectId: 'o' }, uid);
  assert.equal(st.schedule.filter((l) => l.day === 2).length, 1);
  setLessonSubject(st, { childId: 'c1', day: 2, num: 1, subjectId: 'r' }, uid);
  assert.equal(st.schedule.filter((l) => l.day === 2)[0].subjectId, 'r');
  setLessonSubject(st, { childId: 'c1', day: 2, num: 1, subjectId: '' }, uid);
  assert.equal(st.schedule.filter((l) => l.day === 2).length, 0);
  setLessonSubject(st, { childId: 'c1', day: 4, num: 1, subjectId: '' }, uid); // очистка пустой клетки не падает
  assert.equal(st.schedule.find((l) => l.childId === 'other').subjectId, 'o'); // чужое расписание не тронуто
});

test('diaryWeek: строки уроков, задания в ячейках, лишние задания и замечания', () => {
  const st = mk();
  st.tasks.push(
    { id: 't1', childId: 'c1', subjectId: 'm', due: MON, text: 'a', status: 'todo' },
    { id: 't2', childId: 'c1', subjectId: 'm', due: MON, text: 'b', status: 'todo' },
    { id: 't3', childId: 'c1', subjectId: 'o', due: MON, text: 'вне расписания дня', status: 'todo' },
    { id: 't4', childId: 'other', subjectId: 'm', due: MON, text: 'чужое', status: 'todo' },
  );
  st.grades.push({ id: 'g1', childId: 'c1', subjectId: 'm', date: MON, value: 5 });
  st.remarks.push({ id: 'r1', childId: 'c1', date: MON, type: 'negative', text: 'x' });
  const [mon, tue] = diaryWeek(st, 'c1', MON);
  assert.equal(mon.name, 'Понедельник');
  assert.deepEqual(mon.rows.map((r) => r.subject), ['Математика', 'Русский язык', 'Математика']);
  assert.equal(mon.rows[0].tasks.length, 2); // у первой математики оба задания
  assert.equal(mon.rows[0].grades[0].value, 5);
  assert.equal(mon.rows[2].tasks.length, 0); // у второй математики — пусто
  assert.equal(mon.rows[2].first, false);
  assert.deepEqual(mon.extraTasks.map((t) => t.id), ['t3']);
  assert.equal(mon.remarks.length, 1);
  assert.equal(tue.rows.length, 0);
});
