// Чистая логика без доступа к DOM и хранилищу: даты, статусы заданий, статистика, "на что обратить внимание".

export const GRADE_KINDS = [
  'Классная работа',
  'Домашняя работа',
  'Самостоятельная',
  'Контрольная',
  'Диктант',
  'Устный ответ',
  'Другое',
];

export const DAY_NAMES = ['', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];

const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

export function todayISO(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function formatDate(iso) {
  if (!iso) return '';
  const [, m, d] = iso.split('-');
  return `${d}.${m}`;
}

export function formatDateLong(iso) {
  if (!iso) return '';
  const wd = WEEKDAYS[new Date(`${iso}T00:00:00Z`).getUTCDay()];
  return `${wd} ${formatDate(iso)}`;
}

export function plural(n, forms) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}

const count = (n, forms) => `${n} ${plural(n, forms)}`;

// todo -> done (ребёнок сделал) -> checked (родитель проверил)
export function taskStatus(task, today) {
  if (task.status === 'checked') return 'checked';
  if (task.status === 'done') return 'done';
  if (task.due < today) return 'overdue';
  if (task.due === today) return 'today';
  return 'upcoming';
}

export function dueLabel(task, today) {
  if (task.due === today) return 'на сегодня';
  if (task.due === addDays(today, 1)) return 'на завтра';
  return `на ${formatDateLong(task.due)}`;
}

export function average(values) {
  if (!values.length) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

export function round1(x) {
  return x === null ? null : Math.round(x * 10) / 10;
}

const byDate = (a, b) => (a.date === b.date ? 0 : a.date < b.date ? -1 : 1);

// Тренд: средняя последних 3 оценок минус средняя предыдущих (до 3). Нужно минимум 4 оценки.
export function trend(grades) {
  if (grades.length < 4) return null;
  const sorted = [...grades].sort(byDate).map((g) => g.value);
  const last = sorted.slice(-3);
  const prev = sorted.slice(-6, -3);
  return average(last) - average(prev);
}

export function subjectStats(grades, subjects) {
  return subjects
    .map((s) => {
      const gs = grades.filter((g) => g.subjectId === s.id).sort(byDate);
      return {
        subject: s,
        count: gs.length,
        avg: round1(average(gs.map((g) => g.value))),
        trend: trend(gs),
        values: gs.map((g) => g.value),
      };
    })
    .filter((x) => x.count > 0);
}

export function recentAverage(grades, today, days = 30) {
  const from = addDays(today, -days);
  return round1(average(grades.filter((g) => g.date >= from && g.date <= today).map((g) => g.value)));
}

// Список "на что обратить внимание" для родителя. level: high | mid | info
export function attention(state, childId, today) {
  const out = [];
  const subjectName = (id) => state.subjects.find((s) => s.id === id)?.name ?? 'Без предмета';
  const tasks = state.tasks.filter((t) => t.childId === childId);
  const grades = state.grades.filter((g) => g.childId === childId);
  const remarks = state.remarks.filter((r) => r.childId === childId);
  const since = addDays(today, -14);

  const overdue = tasks.filter((t) => taskStatus(t, today) === 'overdue');
  if (overdue.length) {
    out.push({
      level: 'high',
      tab: 'tasks',
      text: `Просрочено: ${count(overdue.length, ['задание', 'задания', 'заданий'])}`,
    });
  }

  const toCheck = tasks.filter((t) => t.status === 'done');
  if (toCheck.length) {
    out.push({
      level: 'info',
      tab: 'tasks',
      text: `Ждут вашей проверки: ${count(toCheck.length, ['задание', 'задания', 'заданий'])}`,
    });
  }

  const low = grades.filter((g) => g.date >= since && g.value <= 3).sort(byDate);
  if (low.length) {
    const worst = Math.min(...low.map((g) => g.value));
    const list = low
      .slice(-3)
      .map((g) => `${subjectName(g.subjectId)} ${g.value} (${formatDate(g.date)})`)
      .join(', ');
    out.push({
      level: worst <= 2 ? 'high' : 'mid',
      tab: 'grades',
      text: `Низкие оценки за 2 недели: ${list}`,
    });
  }

  for (const st of subjectStats(grades, state.subjects)) {
    if (st.count >= 3 && st.avg !== null && st.avg < 3.5) {
      out.push({
        level: 'mid',
        tab: 'overview',
        text: `${st.subject.name}: средний балл ${st.avg} — стоит подтянуть`,
      });
    } else if (st.trend !== null && st.trend <= -0.5) {
      out.push({
        level: 'mid',
        tab: 'overview',
        text: `${st.subject.name}: оценки снижаются`,
      });
    }
  }

  const negative = remarks.filter((r) => r.type === 'negative' && r.date >= since);
  if (negative.length) {
    out.push({
      level: negative.length >= 2 ? 'high' : 'mid',
      tab: 'remarks',
      text: `Замечаний за 2 недели: ${negative.length}`,
    });
  }

  const order = { high: 0, mid: 1, info: 2 };
  return out.sort((a, b) => order[a.level] - order[b.level]);
}

// День недели: 1 = понедельник ... 7 = воскресенье
export function dow(iso) {
  const d = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

export function lessonsOn(state, childId, iso) {
  const d = dow(iso);
  return state.schedule.filter((l) => l.childId === childId && l.day === d).sort((a, b) => a.num - b.num);
}

// Ближайший (не сегодняшний) день, когда по расписанию есть этот предмет — срок для домашки.
export function nextLessonDate(state, childId, subjectId, today) {
  for (let i = 1; i <= 14; i++) {
    const iso = addDays(today, i);
    if (state.schedule.some((l) => l.childId === childId && l.subjectId === subjectId && l.day === dow(iso))) return iso;
  }
  return null;
}
