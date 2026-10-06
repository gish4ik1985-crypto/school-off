// Еженедельная сводка для родителя: чистая логика без DOM.
import { addDays, dow, formatDate, average, round1, subjectStats, plural } from './logic.js';

const byDate = (a, b) => (a.date === b.date ? 0 : a.date < b.date ? -1 : 1);
const inRange = (d, a, b) => d >= a && d <= b;
const count = (n, forms) => `${n} ${plural(n, forms)}`;
const TASK_FORMS = ['задание', 'задания', 'заданий'];

export function weekStart(iso) {
  return addDays(iso, -(dow(iso) - 1));
}

const clip = (s, n = 90) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// Предметы, которые стоит подтянуть, за период [from, to]: причины и «темы» (подсказки из заданий, комментариев, замечаний).
export function focusSubjects(state, childId, from, to, today) {
  const sn = (id) => state.subjects.find((s) => s.id === id)?.name ?? 'Без предмета';
  const mine = (list) => state[list].filter((x) => x.childId === childId);
  const missed = mine('tasks').filter((t) => inRange(t.due, from, to) && t.status === 'todo' && t.due < today);
  const allGrades = mine('grades');
  const low = allGrades.filter((g) => inRange(g.date, from, to) && g.value <= 3);
  const negative = mine('remarks').filter((r) => r.type === 'negative' && inRange(r.date, from, to));

  const acc = new Map();
  const add = (sid, reason, topic) => {
    if (!sid) return;
    const e = acc.get(sid) ?? { reasons: [], topics: [] };
    if (reason) e.reasons.push(reason);
    if (topic && !e.topics.includes(topic)) e.topics.push(topic);
    acc.set(sid, e);
  };
  const bySubject = (arr) => arr.reduce((m, x) => m.set(x.subjectId, [...(m.get(x.subjectId) ?? []), x]), new Map());

  for (const [sid, arr] of bySubject(missed)) {
    add(sid, `не сдано заданий: ${arr.length}`);
    for (const t of arr) add(sid, null, clip(t.text));
  }
  for (const [sid, arr] of bySubject(low)) {
    add(sid, `оценки ${arr.map((g) => g.value).join(', ')}`);
    for (const g of arr) if (g.comment) add(sid, null, clip(g.comment));
  }
  for (const [sid, arr] of bySubject(negative)) {
    add(sid, arr.length > 1 ? `замечаний: ${arr.length}` : 'замечание');
  }
  for (const st of subjectStats(allGrades.filter((g) => g.date <= to), state.subjects)) {
    if (st.count >= 3 && st.avg < 3.5) add(st.subject.id, `средний балл ${st.avg}`);
    else if (st.trend !== null && st.trend <= -0.5) add(st.subject.id, 'оценки снижаются');
  }
  return [...acc.entries()]
    .map(([sid, e]) => ({ subjectId: sid, subject: sn(sid), reasons: e.reasons, topics: e.topics }))
    .sort((a, b) => b.reasons.length - a.reasons.length);
}

// Что подтянуть прямо сейчас: последние две недели
export function weakSubjects(state, childId, today) {
  return focusSubjects(state, childId, addDays(today, -14), today, today);
}

// Сводка за неделю [from, from+6] (пн–вс). today нужен, чтобы отличить «просрочено» от «ещё впереди».
export function weeklySummary(state, childId, from, today) {
  const to = addDays(from, 6);
  const sn = (id) => state.subjects.find((s) => s.id === id)?.name ?? 'Без предмета';
  const mine = (list) => state[list].filter((x) => x.childId === childId);

  const tasks = mine('tasks').filter((t) => inRange(t.due, from, to));
  const finished = tasks.filter((t) => t.status === 'done' || t.status === 'checked');
  const missed = tasks.filter((t) => t.status === 'todo' && t.due < today);
  const open = tasks.filter((t) => t.status === 'todo' && t.due >= today);
  const toCheck = tasks.filter((t) => t.status === 'done');

  const allGrades = mine('grades');
  const grades = allGrades.filter((g) => inRange(g.date, from, to)).sort(byDate);
  const prev = allGrades.filter((g) => inRange(g.date, addDays(from, -7), addDays(from, -1)));
  const avg = round1(average(grades.map((g) => g.value)));
  const prevAvg = round1(average(prev.map((g) => g.value)));

  const remarks = mine('remarks').filter((r) => inRange(r.date, from, to));
  const negative = remarks.filter((r) => r.type === 'negative');
  const positive = remarks.filter((r) => r.type === 'positive');

  const focus = focusSubjects(state, childId, from, to, today);

  const nextFrom = addDays(from, 7);
  const next = mine('tasks').filter((t) => t.status === 'todo' && inRange(t.due, nextFrom, addDays(nextFrom, 6))).length;

  const empty = !tasks.length && !grades.length && !remarks.length;
  const tips = [];
  if (missed.length) tips.push(`Закрыть долги (${missed.length}): ${[...new Set(missed.map((t) => sn(t.subjectId)))].join(', ')}`);
  if (toCheck.length) tips.push(`Проверить сделанное: ${count(toCheck.length, TASK_FORMS)}`);
  for (const f of focus.slice(0, 2)) tips.push(`Уделить внимание: ${f.subject} (${f.reasons.join('; ')})`);
  if (negative.length >= 2) tips.push(`Спокойно поговорить о поведении — замечаний за неделю: ${negative.length}`);
  if (next) tips.push(`На следующей неделе к сдаче: ${count(next, TASK_FORMS)}`);
  if (empty) tips.push('За эту неделю нет записей — проверьте, всё ли внесено в приложение');
  else if (!focus.length && !missed.length) tips.unshift('Неделя прошла хорошо — отметьте успехи ребёнка 🎉');

  return {
    from,
    to,
    empty,
    tasks: {
      total: tasks.length,
      finished: finished.length,
      open: open.length,
      missed: missed.map((t) => ({ subject: sn(t.subjectId), text: t.text, due: t.due })),
    },
    grades: {
      list: grades.map((g) => ({ subject: sn(g.subjectId), value: g.value, kind: g.kind, date: g.date })),
      avg,
      prevAvg,
      low: grades.filter((g) => g.value <= 3).length,
      fives: grades.filter((g) => g.value === 5).length,
    },
    remarks: {
      negative: negative.map((r) => ({ text: r.text, date: r.date, subject: r.subjectId ? sn(r.subjectId) : null })),
      positive: positive.map((r) => ({ text: r.text, date: r.date, subject: r.subjectId ? sn(r.subjectId) : null })),
    },
    focus,
    next,
    tips,
  };
}

// Текст сводки для отправки в мессенджер
export function summaryText(sum, childName) {
  const lines = [`Сводка за неделю ${formatDate(sum.from)}–${formatDate(sum.to)}: ${childName}`, ''];
  lines.push(
    `Задания: сделано ${sum.tasks.finished} из ${sum.tasks.total}${sum.tasks.missed.length ? `, не сдано ${sum.tasks.missed.length}` : ''}`,
  );
  if (sum.grades.list.length) {
    const was = sum.grades.prevAvg === null ? '' : ` (на прошлой неделе ${sum.grades.prevAvg})`;
    lines.push(`Оценки: ${sum.grades.list.map((g) => `${g.subject} ${g.value}`).join(', ')}. Средний балл ${sum.grades.avg}${was}`);
  } else {
    lines.push('Оценки: нет');
  }
  if (sum.remarks.negative.length || sum.remarks.positive.length) {
    lines.push(`Замечаний: ${sum.remarks.negative.length}, похвал: ${sum.remarks.positive.length}`);
    for (const r of sum.remarks.negative) lines.push(`  – ${formatDate(r.date)} ${r.text}`);
  }
  if (sum.tips.length) {
    lines.push('', 'На что обратить внимание:');
    for (const t of sum.tips) lines.push(`• ${t}`);
  }
  return lines.join('\n');
}
