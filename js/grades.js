// Сводка оценок по периодам: четверти и год. Для каждого предмета и периода — итоговая оценка (вводится вручную,
// в том числе за прошлые периоды и годы) и средний балл по текущим оценкам, если они внесены. Без DOM.
import { addDays, average, round1 } from './logic.js';

export const PERIODS = [
  { id: 'q1', name: '1 четверть' },
  { id: 'q2', name: '2 четверть' },
  { id: 'q3', name: '3 четверть' },
  { id: 'q4', name: '4 четверть' },
  { id: 'year', name: 'Год' },
];

// Концы четвертей по умолчанию (месяц-день). Первая четверть начинается 1 сентября, год заканчивается 31 августа.
export const DEFAULT_ENDS = ['10-31', '12-31', '03-31', '05-31'];

const MD = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

// Позиция «месяц-день» внутри учебного года (сентябрь — начало)
const order = (md) => {
  const m = Number(md.slice(0, 2));
  return (m >= 9 ? m : m + 12) * 100 + Number(md.slice(3));
};

export function validEnds(ends) {
  if (!Array.isArray(ends) || ends.length !== 4 || !ends.every((e) => typeof e === 'string' && MD.test(e))) return false;
  // существует ли такой день (29 февраля допускаем)
  if (!ends.every((e) => Number(e.slice(3)) <= new Date(2000, Number(e.slice(0, 2)), 0).getDate())) return false;
  return ends.every((e, i) => i === 0 || order(e) > order(ends[i - 1])) && order(ends[3]) < order('08-31');
}

export const normalizeEnds = (ends) => (validEnds(ends) ? [...ends] : [...DEFAULT_ENDS]);

// Учебный год (по году начала) для даты: сентябрь–декабрь → этот год, январь–август → предыдущий
export function schoolYearOf(iso) {
  const [y, m] = iso.split('-').map(Number);
  return m >= 9 ? y : y - 1;
}

export const yearLabel = (y) => `${y}/${String((y + 1) % 100).padStart(2, '0')}`;

function dateInYear(year, md) {
  const y = Number(md.slice(0, 2)) >= 9 ? year : year + 1;
  return md === '02-29' && !isLeap(y) ? `${y}-02-28` : `${y}-${md}`;
}

export function periodRange(year, id, ends) {
  const e = normalizeEnds(ends);
  const end = (i) => dateInYear(year, e[i]);
  const start = `${year}-09-01`;
  switch (id) {
    case 'q1': return { from: start, to: end(0) };
    case 'q2': return { from: addDays(end(0), 1), to: end(1) };
    case 'q3': return { from: addDays(end(1), 1), to: end(2) };
    case 'q4': return { from: addDays(end(2), 1), to: end(3) };
    default: return { from: start, to: `${year + 1}-08-31` };
  }
}

// Сводка за учебный год: строки по предметам, ячейки по периодам, итоговая строка.
export function periodSummary(state, childId, year, ends) {
  const ranges = Object.fromEntries(PERIODS.map((p) => [p.id, periodRange(year, p.id, ends)]));
  const grades = state.grades.filter((g) => g.childId === childId);
  const finals = state.finals.filter((f) => f.childId === childId && f.year === year);
  const rows = state.subjects.map((subject) => {
    const cells = {};
    for (const p of PERIODS) {
      const { from, to } = ranges[p.id];
      const gs = grades.filter((g) => g.subjectId === subject.id && g.date >= from && g.date <= to);
      const final = finals.find((f) => f.subjectId === subject.id && f.period === p.id)?.value ?? null;
      const avg = round1(average(gs.map((g) => g.value)));
      // «значение периода»: итоговая оценка, а если её нет — средний балл по внесённым оценкам
      cells[p.id] = { final, avg, count: gs.length, value: final ?? avg };
    }
    return { subject, cells };
  });
  const totals = {};
  for (const p of PERIODS) totals[p.id] = round1(average(rows.map((r) => r.cells[p.id].value).filter((v) => v !== null)));
  return { year, ranges, rows, totals };
}

// Итоговая оценка за период: '' удаляет, 1–5 создаёт или обновляет. Возвращает { final } или { blocked }.
export function setFinal(state, { childId, subjectId, year, period, value }, uid) {
  const idx = state.finals.findIndex((f) => f.childId === childId && f.subjectId === subjectId && f.year === year && f.period === period);
  if (value === '' || value === null || value === undefined) {
    if (idx >= 0) state.finals.splice(idx, 1);
    return { final: null };
  }
  const v = Number(value);
  if (!Number.isInteger(v) || v < 1 || v > 5) return { blocked: 'Оценка — число от 1 до 5.' };
  if (!PERIODS.some((p) => p.id === period)) return { blocked: 'Неизвестный период.' };
  if (idx >= 0) {
    state.finals[idx].value = v;
    return { final: state.finals[idx] };
  }
  const final = { id: uid(), childId, subjectId, year, period, value: v };
  state.finals.push(final);
  return { final };
}

// Учебные годы, за которые есть данные, плюс текущий — для выбора года
export function yearsWithData(state, childId, currentYear) {
  const ys = new Set([currentYear]);
  for (const g of state.grades) if (g.childId === childId) ys.add(schoolYearOf(g.date));
  for (const f of state.finals) if (f.childId === childId) ys.add(f.year);
  return [...ys].sort((a, b) => a - b);
}
