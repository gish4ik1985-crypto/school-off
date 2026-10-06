import test from 'node:test';
import assert from 'node:assert/strict';
import { attention, praiseList, practiceCards, pickVariant, subjectSignals } from '../js/advise.js';

const today = '2026-10-06';
const mk = (over = {}) => ({
  children: [{ id: 'c1' }],
  subjects: [
    { id: 'en', name: 'Английский язык' },
    { id: 'm', name: 'Математика' },
    { id: 'pe', name: 'Физкультура' },
    { id: 'art', name: 'ИЗО' },
  ],
  tasks: [],
  grades: [],
  remarks: [],
  schedule: [],
  ...over,
});
const g = (subjectId, date, value, kind = 'Устный ответ') => ({ childId: 'c1', subjectId, date, value, kind });

test('pickVariant: детерминирован и не выходит за пул', () => {
  const pool = ['a', 'b', 'c'];
  for (const seed of ['x', 'идентификатор:даты', 'y:2']) {
    const v = pickVariant(seed, pool);
    assert.ok(pool.includes(v));
    assert.equal(pickVariant(seed, pool), v);
  }
  assert.equal(pickVariant('s', ['один']), 'один');
});

test('subjectSignals: системный провал по контрольным', () => {
  const st = mk({ grades: [g('en', '2026-09-15', 2, 'Контрольная'), g('en', '2026-09-24', 2, 'Контрольная'), g('en', '2026-10-01', 2, 'Контрольная')] });
  const [sig] = subjectSignals(st, 'c1', today);
  assert.equal(sig.cause, 'system');
  assert.equal(sig.sev, 5);
  const { cards } = practiceCards(st, 'c1', today);
  assert.match(cards[0].headline, /15\.09/); // даты проваленных контрольных в любом варианте текста
  assert.ok(cards[0].plan.includes('01.10'));
});

test('subjectSignals: спад после хорошей работы', () => {
  const st = mk({
    grades: [
      g('m', '2026-09-07', 4),
      g('m', '2026-09-16', 3),
      g('m', '2026-09-24', 5, 'Контрольная'),
      g('m', '2026-09-28', 3),
      g('m', '2026-10-01', 2, 'Классная работа'),
    ],
  });
  const [sig] = subjectSignals(st, 'c1', today);
  assert.equal(sig.cause, 'drop');
  assert.equal(sig.before, 5);
  const { cards } = practiceCards(st, 'c1', today);
  assert.match(cards[0].headline, /24\.09/);
  assert.ok(cards[0].headline.includes('5'));
});

test('subjectSignals: тренд на шуме не срабатывает (физкультура)', () => {
  // 5, 4, 4, 5: старый тренд «на 4 оценках» ложно помечал предмет как снижающийся
  const st = mk({
    grades: [g('pe', '2026-09-09', 5), g('pe', '2026-09-16', 4), g('pe', '2026-09-28', 4), g('pe', '2026-10-05', 5)],
  });
  assert.deepEqual(subjectSignals(st, 'c1', today), []);
  assert.deepEqual(praiseList(st, 'c1'), ['Физкультура: средний балл 4.5']);
});

test('subjectSignals: слабый средний и единичный провал', () => {
  const st = mk({
    grades: [g('m', '2026-09-10', 3), g('m', '2026-09-20', 3), g('m', '2026-09-30', 4)],
  });
  const [sig] = subjectSignals(st, 'c1', today);
  assert.equal(sig.cause, 'weak');
  const one = mk({ grades: [g('m', '2026-09-10', 4), g('m', '2026-09-20', 5), g('m', '2026-09-30', 2, 'Контрольная')] });
  assert.equal(subjectSignals(one, 'c1', today)[0].cause, 'single');
});

test('practiceCards: топ-3, остальное списком, похвалы', () => {
  const grades = [
    ...[2, 2, 2].map((v, i) => g('en', `2026-09-1${i}`, v, 'Контрольная')),
    ...[4, 3, 5, 3, 2].map((v, i) => g('m', `2026-09-2${i}`, v)),
    ...[5, 5, 5].map((v, i) => g('art', `2026-09-2${i}`, v)),
  ];
  const { cards, more, praise } = practiceCards(mk({ grades }), 'c1', today);
  assert.equal(cards.length, 2);
  assert.equal(more.length, 0);
  assert.deepEqual(praise, ['ИЗО: 3 пятёрки подряд']);
  const big = mk({
    grades: [
      ...grades,
      ...[4, 3, 3, 2].map((v, i) => g('pe', `2026-09-0${i + 1}`, v)),
    ],
  });
  const res = practiceCards(big, 'c1', today, 2);
  assert.equal(res.cards.length, 2);
  assert.equal(res.more.length, 1);
});

test('attention: группировка причин вместо одинаковых строк', () => {
  const st = mk({
    grades: [
      g('en', '2026-09-15', 2, 'Контрольная'),
      g('en', '2026-09-24', 2, 'Контрольная'),
      g('en', '2026-10-01', 2, 'Контрольная'),
      g('m', '2026-09-07', 4),
      g('m', '2026-09-16', 3),
      g('m', '2026-09-24', 5, 'Контрольная'),
      g('m', '2026-09-28', 3),
      g('m', '2026-10-01', 2, 'Классная работа'),
    ],
  });
  const items = attention(st, 'c1', today);
  const text = items.map((i) => i.text).join(' | ');
  assert.match(text, /Контрольные идут плохо: Английский язык — 2, 2, 2/);
  assert.match(text, /Спад после хороших работ: Математика \(после 5 от 24\.09 — 3, 2\)/);
  assert.ok(!text.includes('стоит подтянуть')); // старый шаблон ушёл
  const levels = items.map((i) => i.level);
  assert.ok(levels.indexOf('high') < levels.indexOf('mid')); // серьёзное — раньше
});

test('attention: просрочка, проверка, низкие оценки, замечания', () => {
  const st = mk({
    tasks: [
      { childId: 'c1', status: 'todo', due: '2026-10-01' },
      { childId: 'c1', status: 'done', due: '2026-10-05' },
    ],
    grades: [{ childId: 'c1', subjectId: 'm', value: 2, date: '2026-10-04' }],
    remarks: [
      { childId: 'c1', type: 'negative', date: '2026-10-02' },
      { childId: 'c1', type: 'negative', date: '2026-10-03' },
      { childId: 'c1', type: 'positive', date: '2026-10-03' },
    ],
  });
  const items = attention(st, 'c1', today);
  assert.deepEqual(
    items.map((i) => i.level),
    ['high', 'high', 'high', 'info'],
  );
  assert.match(items.find((i) => i.tab === 'grades').text, /Математика 2 \(04\.10\)/);
  assert.match(items.find((i) => i.tab === 'remarks').text, /: 2$/);
});

test('attention: ничего подозрительного и чужие данные', () => {
  const st = mk({ grades: [g('m', '2026-10-04', 5)] });
  assert.deepEqual(attention(st, 'c1', today), []);
  const other = mk({ tasks: [{ childId: 'other', status: 'todo', due: '2026-10-01' }] });
  assert.deepEqual(attention(other, 'c1', today), []);
});
