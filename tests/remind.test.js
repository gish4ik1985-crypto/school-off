import test from 'node:test';
import assert from 'node:assert/strict';
import { reminders, buildICS, fold } from '../js/remind.js';

const today = '2026-10-06'; // вторник
const mk = (over = {}) => ({
  children: [{ id: 'c1', name: 'Миша' }],
  subjects: [{ id: 'm', name: 'Математика' }],
  tasks: [],
  grades: [],
  remarks: [],
  schedule: [],
  ...over,
});

test('reminders: просрочка, сегодня, завтра, проверка', () => {
  const state = mk({
    tasks: [
      { id: '1', childId: 'c1', subjectId: 'm', status: 'todo', due: '2026-10-05', text: 'a', createdAt: '2026-10-05T10:00:00Z' },
      { id: '2', childId: 'c1', subjectId: 'm', status: 'todo', due: today, text: 'b', createdAt: '2026-10-05T10:00:00Z' },
      { id: '3', childId: 'c1', subjectId: 'm', status: 'todo', due: '2026-10-07', text: 'c', createdAt: '2026-10-05T10:00:00Z' },
      { id: '4', childId: 'c1', subjectId: 'm', status: 'done', due: '2026-10-07', text: 'd', createdAt: '2026-10-05T10:00:00Z' },
    ],
  });
  const r = reminders(state, today);
  assert.deepEqual(r.map((x) => x.level), ['high', 'mid', 'info', 'info']);
  assert.match(r[0].text, /Просрочено: 1 задание/);
  assert.match(r[2].text, /Завтра сдавать: 1 задание/);
});

test('reminders: давно нет записей', () => {
  const state = mk({ grades: [{ childId: 'c1', subjectId: 'm', value: 5, date: '2026-09-20' }] });
  assert.match(reminders(state, today)[0].text, /Давно не было записей/);
  assert.deepEqual(reminders(mk(), today), []);
});

test('fold: строки не длиннее 75 байт, кириллица не режется посреди символа', () => {
  const long = `SUMMARY:${'Привет мир '.repeat(20)}`;
  const folded = fold(long);
  const enc = new TextEncoder();
  for (const part of folded.split('\r\n')) assert.ok(enc.encode(part).length <= 75, part);
  assert.equal(folded.replace(/\r\n /g, ''), long);
});

test('buildICS: задания, напоминание, вечерняя проверка, экранирование', () => {
  const state = mk({
    tasks: [
      { id: 't1', childId: 'c1', subjectId: 'm', status: 'todo', due: '2026-10-08', text: 'Стр. 5, №1; №2\nвторая строка' },
      { id: 't2', childId: 'c1', subjectId: 'm', status: 'checked', due: '2026-10-08', text: 'готово' },
      { id: 't3', childId: 'c1', subjectId: 'm', status: 'todo', due: '2026-10-01', text: 'старое' },
    ],
  });
  const ics = buildICS(state, today, { hour: 19, minute: 30 }, new Date('2026-10-06T12:00:00Z'));
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  assert.equal((ics.match(/BEGIN:VEVENT/g) ?? []).length, 2); // одно задание + вечерняя проверка
  const unfolded = ics.replace(/\r\n /g, '');
  assert.ok(unfolded.includes('DTSTART;VALUE=DATE:20261008'));
  assert.ok(unfolded.includes('Стр. 5\\, №1\\; №2\\nвторая строка'));
  assert.ok(unfolded.includes('TRIGGER:-PT270M')); // за 4,5 часа до полуночи = 19:30 накануне
  assert.ok(unfolded.includes('DTSTART:20261006T193000')); // вторник — школьный вечер
  assert.ok(unfolded.includes('RRULE:FREQ=WEEKLY;BYDAY=SU,MO,TU,WE,TH'));
  assert.ok(unfolded.includes('DTSTAMP:20261006T120000Z'));
});

test('buildICS: вечерняя проверка стартует в ближайший школьный вечер', () => {
  const ics = buildICS(mk(), '2026-10-09', { hour: 19, minute: 0 }, new Date('2026-10-09T12:00:00Z')); // пятница
  assert.ok(ics.includes('DTSTART:20261011T190000')); // воскресенье
  assert.equal((buildICS({ ...mk(), children: [] }, today).match(/BEGIN:VEVENT/g) ?? []).length, 0);
});
