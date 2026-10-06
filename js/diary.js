// Недельный «дневник»: разворот недели, как в бумажном дневнике. Для каждого дня — строки уроков из расписания,
// в каждой строке: предмет, домашнее задание (на этот урок) и оценка. Чистая логика, без DOM.
import { addDays, dow, DAY_NAMES } from './logic.js';

export function weekDates(from, withSaturday) {
  return Array.from({ length: withSaturday ? 6 : 5 }, (_, i) => addDays(from, i));
}

const sameCell = (x, childId, subjectId, date, key) => x.childId === childId && x.subjectId === subjectId && x[key] === date;

// Данные разворота недели для ребёнка.
export function diaryWeek(state, childId, from, withSaturday = false) {
  const sn = (id) => state.subjects.find((s) => s.id === id)?.name ?? '—';
  const days = weekDates(from, withSaturday).map((date) => {
    const lessons = state.schedule.filter((l) => l.childId === childId && l.day === dow(date)).sort((a, b) => a.num - b.num);
    const seen = new Set(); // два урока одного предмета в день: задание и оценка показываются у первого
    const rows = lessons.map((lesson) => {
      const first = !seen.has(lesson.subjectId);
      seen.add(lesson.subjectId);
      return {
        lesson,
        subject: sn(lesson.subjectId),
        tasks: first ? state.tasks.filter((t) => sameCell(t, childId, lesson.subjectId, date, 'due')) : [],
        grades: first ? state.grades.filter((g) => sameCell(g, childId, lesson.subjectId, date, 'date')) : [],
        first,
      };
    });
    const scheduled = new Set(lessons.map((l) => l.subjectId));
    return {
      date,
      day: dow(date),
      name: DAY_NAMES[dow(date)],
      rows,
      // задания на этот день по предметам, которых нет в расписании дня
      extraTasks: state.tasks.filter((t) => t.childId === childId && t.due === date && !scheduled.has(t.subjectId)),
      remarks: state.remarks.filter((r) => r.childId === childId && r.date === date),
    };
  });
  return days;
}

// Записать домашнее задание в ячейку (предмет + день). Пустой текст удаляет задание.
// Возвращает { task } или { blocked: 'причина' }.
export function saveHomework(state, { childId, subjectId, date, text }, uid, now = new Date().toISOString()) {
  const value = String(text ?? '').trim();
  const first = state.tasks.find((t) => sameCell(t, childId, subjectId, date, 'due'));
  if (!value) {
    if (!first) return { task: null };
    if (first.photoIds?.length) return { blocked: 'У задания есть фото — удалите его на вкладке «Задания».' };
    state.tasks = state.tasks.filter((t) => t !== first);
    return { task: null };
  }
  if (first) {
    first.text = value;
    return { task: first };
  }
  const task = { id: uid(), childId, subjectId, text: value, due: date, status: 'todo', note: '', photoIds: [], createdAt: now };
  state.tasks.push(task);
  return { task };
}

// Оценка за урок: '' удаляет, число 1–5 создаёт или обновляет.
export function saveGrade(state, { childId, subjectId, date, value }, uid, now = new Date().toISOString()) {
  const first = state.grades.find((g) => sameCell(g, childId, subjectId, date, 'date'));
  if (value === '' || value === null || value === undefined) {
    if (!first) return { grade: null };
    if (first.photoIds?.length) return { blocked: 'У оценки есть фото — удалите её на вкладке «Оценки».' };
    state.grades = state.grades.filter((g) => g !== first);
    return { grade: null };
  }
  const v = Number(value);
  if (!Number.isInteger(v) || v < 1 || v > 5) return { blocked: 'Оценка — число от 1 до 5.' };
  if (first) {
    first.value = v;
    return { grade: first };
  }
  const grade = { id: uid(), childId, subjectId, value: v, kind: 'Классная работа', date, comment: '', photoIds: [], createdAt: now };
  state.grades.push(grade);
  return { grade };
}

// Поставить предмет в клетку расписания (день недели + номер урока); пустой subjectId освобождает клетку.
export function setLessonSubject(state, { childId, day, num, subjectId }, uid) {
  const idx = state.schedule.findIndex((l) => l.childId === childId && l.day === day && l.num === num);
  if (!subjectId) {
    if (idx >= 0) state.schedule.splice(idx, 1);
    return null;
  }
  if (idx >= 0) {
    state.schedule[idx].subjectId = subjectId;
    return state.schedule[idx];
  }
  const lesson = { id: uid(), childId, day, num, subjectId };
  state.schedule.push(lesson);
  return lesson;
}
