// Чистая часть работы с ИИ: промпты, схемы ответа и проверка того, что вернула модель.
// Сеть — в ai.js. Всё, что пришло от модели, считается недоверенным и проверяется.
import { addDays, dow, DAY_NAMES } from './logic.js';

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function validISO(s) {
  if (typeof s !== 'string' || !ISO.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

const clean = (v, max = 600) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

// ---------- Сопоставление названий предметов ----------

const ALIASES = [
  [/^(физ-?ра|физ\.?\s?культура|физкультура|физическая культура)/, 'физкультура'],
  [/^(лит\.?\s?чтение|литчтение|лит\.?\s?чт|чтение|литературное чтение)/, 'литературное чтение'],
  [/^(окр\.?\s?мир|окруж\.?\s?мир|окружающий мир|окружайка)/, 'окружающий мир'],
  [/^(рус\.?\s?яз|русский|русский язык)/, 'русский язык'],
  [/^(матем|математика|мат\.)/, 'математика'],
  [/^(англ|английский)/, 'английский язык'],
  [/^(технол|труд|технология)/, 'технология'],
  [/^(изо|рисование|изобразительное)/, 'изо'],
  [/^(муз|музыка)/, 'музыка'],
];

const norm = (s) =>
  clean(s, 80)
    .toLowerCase()
    .replace(/ё/g, 'е');

// Возвращает id подходящего предмета или null.
export function matchSubject(name, subjects) {
  const n = norm(name);
  if (!n) return null;
  const exact = subjects.find((s) => norm(s.name) === n);
  if (exact) return exact.id;
  const alias = ALIASES.find(([re]) => re.test(n));
  if (alias) {
    const hit = subjects.find((s) => norm(s.name) === alias[1]);
    if (hit) return hit.id;
  }
  const part = subjects.find((s) => n.length >= 4 && (norm(s.name).includes(n) || n.includes(norm(s.name))));
  return part ? part.id : null;
}

// ---------- Распознавание страницы дневника ----------

export const DIARY_SCHEMA = {
  type: 'object',
  properties: {
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          subject: { type: 'string' },
          text: { type: 'string' },
          due: { type: 'string' },
        },
        required: ['subject', 'text', 'due'],
        additionalProperties: false,
      },
    },
    grades: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          subject: { type: 'string' },
          value: { type: 'integer' },
          kind: { type: 'string' },
          date: { type: 'string' },
          comment: { type: 'string' },
        },
        required: ['subject', 'value', 'kind', 'date', 'comment'],
        additionalProperties: false,
      },
    },
    remarks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['negative', 'positive', 'info'] },
          text: { type: 'string' },
          subject: { type: 'string' },
          teacher: { type: 'string' },
          date: { type: 'string' },
        },
        required: ['type', 'text', 'subject', 'teacher', 'date'],
        additionalProperties: false,
      },
    },
  },
  required: ['tasks', 'grades', 'remarks'],
  additionalProperties: false,
};

export function diaryPrompt(subjects, today) {
  const system = [
    'Ты помогаешь родителю перенести записи с фотографии страницы школьного дневника (начальная школа, Россия) в учётную программу.',
    'Извлекай только то, что действительно написано на фото. Ничего не выдумывай и не додумывай; если запись нечитаема — пропусти её.',
    'Верни три списка: tasks (домашние задания), grades (оценки), remarks (замечания и похвалы учителей).',
    'Даты — строго в формате ГГГГ-ММ-ДД. Если у домашнего задания дата не указана явно, но оно записано в строке дня недели, используй дату этого дня. Если срок определить нельзя, оставь due пустой строкой.',
    'Оценка — целое число от 1 до 5. Если оценки нет, не добавляй запись. Поле kind — вид работы, если указан (контрольная, диктант и т.п.), иначе пустая строка.',
    'Имена и фамилии детей, ФИО родителей, телефоны и адреса не извлекай. Фамилию учителя можно указать в поле teacher, если она подписана под замечанием.',
    'Названия предметов пиши так, как в списке известных предметов, если запись явно относится к одному из них; иначе — как в дневнике.',
  ].join('\n');
  const known = subjects.map((s) => s.name).join(', ');
  const user = [
    `Сегодня ${today} (${DAY_NAMES[dow(today)].toLowerCase()}).`,
    `Известные предметы: ${known}.`,
    'Разбери страницу дневника на фото.',
  ].join('\n');
  return { system, user, schema: DIARY_SCHEMA };
}

// Проверяет ответ модели и приводит к записям приложения (без id — их ставит интерфейс).
export function normalizeDiary(raw, subjects, today) {
  const arr = (x) => (Array.isArray(x) ? x : []);
  const dateOr = (s, fallback) => (validISO(s) ? s : fallback);
  const tasks = arr(raw?.tasks)
    .map((t) => ({
      subjectName: clean(t?.subject, 60),
      subjectId: matchSubject(t?.subject, subjects),
      text: clean(t?.text),
      due: dateOr(t?.due, ''),
    }))
    .filter((t) => t.text);
  const grades = arr(raw?.grades)
    .map((g) => ({
      subjectName: clean(g?.subject, 60),
      subjectId: matchSubject(g?.subject, subjects),
      value: Number(g?.value),
      kind: clean(g?.kind, 40),
      date: dateOr(g?.date, today),
      comment: clean(g?.comment),
    }))
    .filter((g) => Number.isInteger(g.value) && g.value >= 1 && g.value <= 5);
  const remarks = arr(raw?.remarks)
    .map((r) => ({
      type: ['negative', 'positive', 'info'].includes(r?.type) ? r.type : 'info',
      subjectName: clean(r?.subject, 60),
      subjectId: matchSubject(r?.subject, subjects),
      teacher: clean(r?.teacher, 60),
      date: dateOr(r?.date, today),
      text: clean(r?.text),
    }))
    .filter((r) => r.text);
  return { tasks, grades, remarks };
}

// ---------- Подбор заданий для тренировки ----------

export const PRACTICE_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    intro: { type: 'string' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          answer: { type: 'string' },
          hint: { type: 'string' },
        },
        required: ['question', 'answer', 'hint'],
        additionalProperties: false,
      },
    },
  },
  required: ['title', 'intro', 'items'],
  additionalProperties: false,
};

export const LEVELS = {
  easier: 'проще, чем в классе — чтобы закрепить основу и вернуть уверенность',
  normal: 'как в классе',
  harder: 'чуть сложнее, чем в классе',
};

export function practicePrompt({ grade, subject, topic, count, level, hints }) {
  const system = [
    'Ты опытный учитель начальных классов в России (программа ФГОС). Составляешь для родителя тренировочные задания, чтобы ребёнок подтянул тему.',
    'Требования: язык — русский; задания соответствуют классу и программе; решаются в тетради или устно, без картинок и без интернета; формулировки короткие и понятные ребёнку.',
    'Задания разнообразные и идут от простых к более сложным. Не повторяй одно и то же с другими числами.',
    'Ответ к каждому заданию короткий и верный. Перед тем как записать ответ, проверь его (вычисления пересчитай).',
    'В поле hint — короткая подсказка для родителя: как навести ребёнка на решение, не давая готовый ответ.',
    'Поле intro — одно-два предложения: что отрабатываем и как лучше заниматься (по 10–15 минут).',
    'Не используй имена реальных людей. Не включай в задания ничего, кроме учебного материала.',
  ].join('\n');
  const lines = [
    `Класс: ${grade}.`,
    `Предмет: ${subject}.`,
    `Тема: ${topic || 'по усмотрению — самое важное для этого предмета и класса'}.`,
    `Количество заданий: ${count}.`,
    `Сложность: ${LEVELS[level] ?? LEVELS.normal}.`,
  ];
  if (hints?.length) lines.push(`Контекст из школы (где ребёнок ошибается или что не сдано): ${hints.join('; ')}.`);
  return { system, user: lines.join('\n'), schema: PRACTICE_SCHEMA };
}

export function normalizePractice(raw) {
  const items = (Array.isArray(raw?.items) ? raw.items : [])
    .map((i) => ({ question: clean(i?.question, 800), answer: clean(i?.answer, 400), hint: clean(i?.hint, 400) }))
    .filter((i) => i.question && i.answer)
    .slice(0, 20);
  if (!items.length) throw new Error('Модель не вернула ни одного задания. Попробуйте ещё раз или уточните тему.');
  return { title: clean(raw?.title, 120) || 'Тренировка', intro: clean(raw?.intro, 400), items };
}

// Текст задания для списка «Задания» (без ответов)
export function practiceAsTaskText(set) {
  return [`Тренировка: ${set.topic || set.title}`, ...set.items.map((i, n) => `${n + 1}) ${i.question}`)].join('\n');
}

export function nextSchoolDay(today) {
  let d = addDays(today, 1);
  while (dow(d) > 5) d = addDays(d, 1);
  return d;
}
