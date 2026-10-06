// Рекомендации для родителя: правила «на что обратить внимание» и «что подтянуть».
// Каждый предмет получает одну причину из фактов (проваленные контрольные, спад после
// хорошей работы, слабый средний балл) — и текст под эту причину, а не общий шаблон.
// Формулировки берутся из пула вариантов по детерминированному хешу (предмет + неделя):
// соседние карточки не совпадают текстом, но рендер и тесты стабильны.
import { addDays, average, dow, formatDate, nextLessonDate, plural, round1, taskStatus } from './logic.js';

// Контрольные знания: низкая оценка за такую работу — сигнал серьёзнее, чем за устный ответ.
export const HEAVY_KINDS = ['Контрольная', 'Диктант', 'Самостоятельная'];

const byDate = (a, b) => (a.date === b.date ? 0 : a.date < b.date ? -1 : 1);

// Детерминированный выбор варианта текста: одинаковый seed — одинаковый вариант.
export function pickVariant(seed, variants) {
  let h = 0;
  for (const ch of String(seed)) h = ((h * 31 + ch.codePointAt(0)) >>> 0) % 1000000007;
  return variants[h % variants.length];
}

const datesOf = (gs) => gs.map((g) => formatDate(g.date)).join(', ');
const trailing = (vals, isLow) => {
  let n = 0;
  for (let i = vals.length - 1; i >= 0 && isLow(vals[i]); i--) n++;
  return n;
};

// Причина по предмету — одна, самая серьёзная. Оценок меньше трёх мало для выводов.
//   system  — две и больше контрольных/диктантов ниже 4 подряд по смыслу — системный провал
//   drop    — после хорошей оценки (4–5) идут 2+ слабые: дело в текущем материале, не в пробелах
//   single  — один провал контрольной на фоне ровных работ
//   decline — средняя последних 3 оценок заметно ниже предыдущих 3 (нужно 6 оценок)
//   weak    — средний балл по последним 8 оценкам ниже 3.5
export function subjectSignals(state, childId, today) {
  const signals = [];
  for (const s of state.subjects) {
    const gs = state.grades.filter((g) => g.childId === childId && g.subjectId === s.id).sort(byDate);
    if (gs.length < 3) continue;
    const vals = gs.map((g) => g.value);
    const heavyFails = gs.filter((g) => HEAVY_KINDS.includes(g.kind) && g.value <= 3);
    const streak = trailing(vals, (v) => v <= 3);
    const before = vals.length > streak ? vals[vals.length - 1 - streak] : null;
    const avgRecent = round1(average(vals.slice(-8)));
    const last3 = round1(average(vals.slice(-3)));
    const prev3 = vals.length >= 6 ? round1(average(vals.slice(-6, -3))) : null;

    let cause = null;
    if (heavyFails.length >= 2) cause = 'system';
    else if (streak >= 2 && before !== null && before >= 4) cause = 'drop';
    else if (heavyFails.length === 1) cause = 'single';
    else if (prev3 !== null && last3 <= prev3 - 0.5 && vals[vals.length - 1] <= 3) cause = 'decline';
    else if (avgRecent !== null && avgRecent < 3.5) cause = 'weak';
    if (!cause) continue;

    const sev = { system: 5, drop: 4, single: 3, decline: 2, weak: 1 }[cause];
    signals.push({ subject: s, cause, sev, gs, vals, streak, before, heavyFails, avgRecent, last3, prev3 });
  }
  return signals.sort((a, b) => b.sev - a.sev || a.avgRecent - b.avgRecent);
}

const HEADLINES = {
  system: [
    (sig) => `${sig.heavyFails.some((g) => g.value <= 2) ? 'Двойки' : 'Слабые оценки'} за ${sig.heavyFails.length} ${plural(sig.heavyFails.length, ['контрольную', 'контрольные', 'контрольных'])} (${datesOf(sig.heavyFails.slice(-3))}) — предмет сейчас системно не идёт.`,
    (sig) => `Последние контрольные не удаются: ${sig.heavyFails.slice(-3).map((g) => g.value).join(', ')} (${datesOf(sig.heavyFails.slice(-3))}). Это уже не случайность.`,
  ],
  drop: [
    (sig) => `После ${sig.before} за работу ${formatDate(sig.gs[sig.gs.length - 1 - sig.streak].date)} — ${sig.streak} ${plural(sig.streak, ['слабая оценка', 'слабые оценки', 'слабых оценок'])} подряд (${sig.vals.slice(-sig.streak).join(', ')}). Похоже, дело не в старой теме, а в текущем материале.`,
    (sig) => `Ещё недавно была ${sig.before} (${formatDate(sig.gs[sig.gs.length - 1 - sig.streak].date)}), а последние работы — ${sig.vals.slice(-sig.streak).join(', ')}. Спад заметный.`,
  ],
  single: [
    (sig) => `${sig.heavyFails[0].value <= 2 ? 'Двойка' : 'Тройка'} за контрольную ${formatDate(sig.heavyFails[0].date)} — единственный провал на фоне ровных работ.`,
    (sig) => `Контрольная ${formatDate(sig.heavyFails[0].date)} написана на ${sig.heavyFails[0].value} — выбивается из остальной картины.`,
  ],
  decline: [
    (sig) => `Оценки стали заметно слабее: было ≈${sig.prev3}, стало ≈${sig.last3}.`,
    (sig) => `Если сравнить последние три работы с предыдущими тремя — падение с ≈${sig.prev3} до ≈${sig.last3}.`,
  ],
  weak: [
    (sig) => `Средний балл ${sig.avgRecent} по последним ${Math.min(8, sig.vals.length)} оценкам — ниже, чем хотелось бы.`,
    (sig) => `По последним работам средний ${sig.avgRecent} — предмету не хватает уверенности.`,
  ],
};

// Подсказка по расписанию: когда ближайший урок — туда и приурочиваем занятия.
const practiceHint = (state, childId, sig, today) => {
  const next = nextLessonDate(state, childId, sig.subject.id, today);
  return next ? ` Ближайший урок — ${formatDate(next)}, к нему и приурочьте занятия.` : '';
};

const PLANS = {
  system: [
    (state, childId, sig, today) =>
      `Разберите последнюю контрольную (${formatDate(sig.heavyFails[sig.heavyFails.length - 1].date)}): выпишите 2–3 темы, где ошибки. Дальше 5 дней по 10–15 минут именно на них, в конце — короткий прогон в формате контрольной.${practiceHint(state, childId, sig, today)}`,
    (state, childId, sig, today) =>
      `Соберите все работы за месяц (${datesOf(sig.heavyFails.slice(-3))}) и найдите типичные ошибки — обычно они повторяются. Повторяйте эти темы по 10–15 минут в день до следующей контрольной.${practiceHint(state, childId, sig, today)}`,
  ],
  drop: [
    (state, childId, sig) =>
      `Посмотрите вместе последние работы (${datesOf(sig.gs.slice(-sig.streak))}) и найдите, где именно ошибки. Потом 10–15 минут практики по 2–3 текущим темам.`,
    (state, childId, sig, today) =>
      `Спросите, что проходят сейчас и что даётся труднее всего. Повторите темы двух последних работ (${datesOf(sig.gs.slice(-2))}) по 10–15 минут в день.${practiceHint(state, childId, sig, today)}`,
  ],
  single: [
    () => `Разберите именно эту работу: обычно хватает одного прицельного повторения темы перед следующей контрольной.`,
    () => `Один провал — не закономерность: разберите работу, найдите 2–3 ошибки и повторите тему один раз, спокойно.`,
  ],
  decline: [
    () => `Поговорите без нажима: что изменилось на уроках, что непонятно? Затем повторите темы двух последних работ.`,
    () => `Сначала разговор (усталость, пропуски, новая тема?), потом 10–15 минут в день на темы двух последних работ.`,
  ],
  weak: [
    (state, childId, sig, today) =>
      `Короткие занятия по 10–15 минут в дни, когда по расписанию ${sig.subject.name.toLowerCase()}. Начните с заданий, где были ошибки.${practiceHint(state, childId, sig, today)}`,
    (state, childId, sig, today) =>
      `Ритм «немного, но часто»: 10–15 минут через день, задачи проще классных, чтобы восстановить уверенность.${practiceHint(state, childId, sig, today)}`,
  ],
};

// Что получается хорошо — для блока похвалы.
export function praiseList(state, childId) {
  const out = [];
  for (const s of state.subjects) {
    const vals = state.grades
      .filter((g) => g.childId === childId && g.subjectId === s.id)
      .sort(byDate)
      .map((g) => g.value);
    if (vals.length < 2) continue;
    const five = trailing(vals, (v) => v === 5);
    const avgRecent = round1(average(vals.slice(-8)));
    if (five >= 2) out.push(`${s.name}: ${five} ${plural(five, ['пятёрка', 'пятёрки', 'пятёрок'])} подряд`);
    else if (avgRecent !== null && avgRecent >= 4.5) out.push(`${s.name}: средний балл ${avgRecent}`);
  }
  return out;
}

// Карточки для вкладки «Подтянуть»: топ-N с разными причинами и планами, остальное — списком.
export function practiceCards(state, childId, today, maxCards = 3) {
  const week = addDays(today, -(dow(today) - 1));
  const cards = subjectSignals(state, childId, today).map((sig) => ({
    subjectId: sig.subject.id,
    subject: sig.subject.name,
    cause: sig.cause,
    sev: sig.sev,
    headline: pickVariant(`${sig.subject.id}:${week}:h`, HEADLINES[sig.cause])(sig),
    plan: pickVariant(`${sig.subject.id}:${week}:p`, PLANS[sig.cause])(state, childId, sig, today),
  }));
  return {
    cards: cards.slice(0, maxCards),
    more: cards.slice(maxCards).map((c) => c.subject),
    praise: praiseList(state, childId).slice(0, 3),
  };
}

// Список «на что обратить внимание» для главной и обзора. level: high | mid | info
export function attention(state, childId, today) {
  const out = [];
  const name = (id) => state.subjects.find((s) => s.id === id)?.name ?? 'Без предмета';
  const tasks = state.tasks.filter((t) => t.childId === childId);
  const grades = state.grades.filter((g) => g.childId === childId);
  const remarks = state.remarks.filter((r) => r.childId === childId);
  const since = addDays(today, -14);

  const overdue = tasks.filter((t) => taskStatus(t, today) === 'overdue');
  if (overdue.length) {
    out.push({
      level: 'high',
      tab: 'tasks',
      text: `Просрочено: ${pluralCount(overdue.length, ['задание', 'задания', 'заданий'])}`,
    });
  }

  const low = grades.filter((g) => g.date >= since && g.value <= 3).sort(byDate);
  if (low.length) {
    const worst = Math.min(...low.map((g) => g.value));
    const list = low
      .slice(-3)
      .map((g) => `${name(g.subjectId)} ${g.value} (${formatDate(g.date)})`)
      .join(', ');
    out.push({ level: worst <= 2 ? 'high' : 'mid', tab: 'grades', text: `Низкие оценки за 2 недели: ${list}` });
  }

  // Предметы одной группой на причину — вместо одинаковых строк на каждый предмет.
  const systematic = [];
  const drops = [];
  const declines = [];
  const weak = [];
  for (const s of state.subjects) {
    const gs = grades.filter((g) => g.subjectId === s.id).sort(byDate);
    if (gs.length < 3) continue;
    const vals = gs.map((g) => g.value);
    const heavyFails = gs.filter((g) => HEAVY_KINDS.includes(g.kind) && g.value <= 3);
    const streak = trailing(vals, (v) => v <= 3);
    const before = vals.length > streak ? vals[vals.length - 1 - streak] : null;
    const avgRecent = round1(average(vals.slice(-8)));
    if (heavyFails.length >= 2) {
      systematic.push({ text: `${s.name} — ${heavyFails.slice(-3).map((g) => g.value).join(', ')}`, worst: Math.min(...heavyFails.map((g) => g.value)) });
    } else if (streak >= 2 && before !== null && before >= 4) {
      drops.push(`${s.name} (после ${before} от ${formatDate(gs[gs.length - 1 - streak].date)} — ${vals.slice(-streak).join(', ')})`);
    } else if (avgRecent !== null && avgRecent < 3.5) {
      weak.push(`${s.name} (${avgRecent})`);
    } else if (vals.length >= 6 && round1(average(vals.slice(-3))) <= round1(average(vals.slice(-6, -3))) - 0.5 && vals[vals.length - 1] <= 3) {
      declines.push(`${s.name} (≈${round1(average(vals.slice(-6, -3)))} → ≈${round1(average(vals.slice(-3)))})`);
    }
  }
  if (systematic.length) {
    const worst = Math.min(...systematic.map((x) => x.worst));
    out.push({ level: worst <= 2 ? 'high' : 'mid', tab: 'practice', text: `Контрольные идут плохо: ${systematic.map((x) => x.text).join('; ')}` });
  }
  if (drops.length) out.push({ level: 'mid', tab: 'practice', text: `Спад после хороших работ: ${drops.join('; ')}` });
  if (declines.length) out.push({ level: 'mid', tab: 'practice', text: `Заметное снижение: ${declines.join('; ')}` });
  if (weak.length) out.push({ level: 'mid', tab: 'practice', text: `Средний балл ниже 3.5 по последним оценкам: ${weak.join(', ')}` });

  const toCheck = tasks.filter((t) => t.status === 'done');
  if (toCheck.length) {
    out.push({
      level: 'info',
      tab: 'tasks',
      text: `Ждут вашей проверки: ${pluralCount(toCheck.length, ['задание', 'задания', 'заданий'])}`,
    });
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

const pluralCount = (n, forms) => `${n} ${plural(n, forms)}`;
