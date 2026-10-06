// Напоминания для родителя. Без сервера пуш-уведомления невозможны, поэтому два способа:
// 1) баннер на главной странице; 2) файл календаря .ics — телефон сам напомнит в нужное время.
import { addDays, dow, plural, taskStatus } from './logic.js';

const TASK_FORMS = ['задание', 'задания', 'заданий'];
const count = (n) => `${n} ${plural(n, TASK_FORMS)}`;

// Список напоминаний по всем детям. level: high | mid | info
export function reminders(state, today) {
  const out = [];
  const tomorrow = addDays(today, 1);
  for (const c of state.children) {
    const tasks = state.tasks.filter((t) => t.childId === c.id);
    const todo = tasks.filter((t) => t.status === 'todo');
    const overdue = todo.filter((t) => t.due < today);
    const dueToday = todo.filter((t) => t.due === today);
    const dueTomorrow = todo.filter((t) => t.due === tomorrow);
    const toCheck = tasks.filter((t) => t.status === 'done');
    const add = (level, text, tab = 'tasks') => out.push({ childId: c.id, child: c.name, level, text, tab });

    if (overdue.length) add('high', `Просрочено: ${count(overdue.length)}`);
    if (dueToday.length) add('mid', `Сдавать сегодня: ${count(dueToday.length)}`);
    if (dueTomorrow.length) add('info', `Завтра сдавать: ${count(dueTomorrow.length)} — лучше сделать сегодня вечером`);
    if (toCheck.length) add('info', `Ждут вашей проверки: ${count(toCheck.length)}`);

    const dates = [
      ...tasks.map((t) => (t.createdAt ?? '').slice(0, 10)),
      ...state.grades.filter((g) => g.childId === c.id).map((g) => g.date),
      ...state.remarks.filter((r) => r.childId === c.id).map((r) => r.date),
    ].filter(Boolean);
    const last = dates.sort().at(-1);
    if (last && last < addDays(today, -3)) add('info', 'Давно не было записей — загляните в дневник', 'overview');
  }
  const order = { high: 0, mid: 1, info: 2 };
  return out.sort((a, b) => order[a.level] - order[b.level]);
}

// ---------- Календарь .ics ----------

const esc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const compact = (iso) => iso.replace(/-/g, '');
const stamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

// Складывание строк по RFC 5545: не более 75 байт в строке, продолжение начинается с пробела.
export function fold(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const parts = [];
  let cur = '';
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > limit) {
      parts.push(cur);
      cur = '';
      bytes = 0;
      limit = 74; // первый символ продолжения — пробел
    }
    cur += ch;
    bytes += n;
  }
  parts.push(cur);
  return parts.join('\r\n ');
}

// evening: { hour, minute } — время вечерней проверки. now — для DTSTAMP (передаётся для тестов).
export function buildICS(state, today, evening = { hour: 19, minute: 0 }, now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//school-off//RU', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Школьный помощник'];
  const ds = stamp(now);
  const subj = (id) => state.subjects.find((s) => s.id === id)?.name ?? '';

  // 1) Каждое несданное задание — событие на день сдачи; напоминание накануне в время вечерней проверки
  const minutesBefore = 24 * 60 - (evening.hour * 60 + evening.minute);
  for (const t of state.tasks.filter((x) => x.status === 'todo' && x.due >= today)) {
    const child = state.children.find((c) => c.id === t.childId);
    if (!child) continue;
    lines.push(
      'BEGIN:VEVENT',
      `UID:task-${t.id}@school-off`,
      `DTSTAMP:${ds}`,
      `DTSTART;VALUE=DATE:${compact(t.due)}`,
      `DTEND;VALUE=DATE:${compact(addDays(t.due, 1))}`,
      `SUMMARY:${esc(`Сдать: ${subj(t.subjectId)} — ${child.name}`)}`,
      `DESCRIPTION:${esc(t.text)}`,
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${esc(`Завтра сдавать: ${subj(t.subjectId)} (${child.name})`)}`,
      `TRIGGER:-PT${minutesBefore}M`,
      'END:VALARM',
      'END:VEVENT',
    );
  }

  // 2) Ежедневная вечерняя проверка уроков (вс–чт: вечером перед школьным днём)
  if (state.children.length) {
    let start = today;
    while (![7, 1, 2, 3, 4].includes(dow(start))) start = addDays(start, 1);
    const names = state.children.map((c) => c.name).join(', ');
    lines.push(
      'BEGIN:VEVENT',
      'UID:evening-check@school-off',
      `DTSTAMP:${ds}`,
      `DTSTART:${compact(start)}T${p(evening.hour)}${p(evening.minute)}00`,
      'DURATION:PT30M',
      'RRULE:FREQ=WEEKLY;BYDAY=SU,MO,TU,WE,TH',
      `SUMMARY:${esc(`Проверить уроки: ${names}`)}`,
      'DESCRIPTION:Посмотреть задания на завтра и собрать портфель',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'DESCRIPTION:Пора проверить уроки',
      'TRIGGER:PT0M',
      'END:VALARM',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(fold).join('\r\n')}\r\n`;
}
