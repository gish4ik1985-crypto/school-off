import test from 'node:test';
import assert from 'node:assert/strict';
import { validISO, matchSubject, normalizeDiary, normalizePractice, practicePrompt, diaryPrompt, practiceAsTaskText, nextSchoolDay } from '../js/aimap.js';

const subjects = ['Математика', 'Русский язык', 'Литературное чтение', 'Окружающий мир', 'Английский язык', 'Физкультура', 'ИЗО'].map((name, i) => ({
  id: `s${i}`,
  name,
}));
const id = (n) => subjects.find((s) => s.name === n).id;

test('validISO', () => {
  assert.ok(validISO('2026-10-06'));
  assert.ok(!validISO('2026-02-30'));
  assert.ok(!validISO('06.10.2026'));
  assert.ok(!validISO(''));
  assert.ok(!validISO(null));
});

test('matchSubject: точные, сокращения и неизвестные', () => {
  assert.equal(matchSubject('математика', subjects), id('Математика'));
  assert.equal(matchSubject('Матем.', subjects), id('Математика'));
  assert.equal(matchSubject('Рус. яз.', subjects), id('Русский язык'));
  assert.equal(matchSubject('Русский', subjects), id('Русский язык'));
  assert.equal(matchSubject('Лит. чтение', subjects), id('Литературное чтение'));
  assert.equal(matchSubject('Окр. мир', subjects), id('Окружающий мир'));
  assert.equal(matchSubject('физ-ра', subjects), id('Физкультура'));
  assert.equal(matchSubject('Англ', subjects), id('Английский язык'));
  assert.equal(matchSubject('Шахматы', subjects), null);
  assert.equal(matchSubject('', subjects), null);
});

test('normalizeDiary: мусор от модели отбрасывается', () => {
  const raw = {
    tasks: [
      { subject: 'Математика', text: '  стр. 5   №3 ', due: '2026-10-08' },
      { subject: 'Шахматы', text: 'ход конём', due: '32.13.2026' },
      { subject: 'Русский', text: '   ', due: '2026-10-08' },
    ],
    grades: [
      { subject: 'Математика', value: 5, kind: 'Диктант', date: '2026-10-05', comment: '' },
      { subject: 'Математика', value: 7, kind: '', date: '2026-10-05', comment: '' },
      { subject: 'Русский язык', value: 4.5, kind: '', date: '', comment: '' },
      { subject: 'Русский язык', value: 4, kind: '', date: 'вчера', comment: 'ок' },
    ],
    remarks: [{ type: 'bad', text: 'болтал', subject: 'Окр. мир', teacher: 'М. И.', date: '2026-10-05' }, { type: 'positive', text: '', subject: '', teacher: '', date: '' }],
  };
  const r = normalizeDiary(raw, subjects, '2026-10-06');
  assert.equal(r.tasks.length, 2);
  assert.equal(r.tasks[0].text, 'стр. 5 №3');
  assert.equal(r.tasks[0].subjectId, id('Математика'));
  assert.equal(r.tasks[1].subjectId, null);
  assert.equal(r.tasks[1].due, '');
  assert.equal(r.grades.length, 2); // 7 и 4.5 отброшены
  assert.equal(r.grades[1].date, '2026-10-06'); // неверная дата → сегодня
  assert.equal(r.remarks.length, 1);
  assert.equal(r.remarks[0].type, 'info'); // неизвестный тип → info
  assert.equal(r.remarks[0].subjectId, id('Окружающий мир'));
});

test('normalizeDiary: пустой и некорректный ответ', () => {
  assert.deepEqual(normalizeDiary(null, subjects, '2026-10-06'), { tasks: [], grades: [], remarks: [] });
  assert.deepEqual(normalizeDiary({ tasks: 'x', grades: 5 }, subjects, '2026-10-06'), { tasks: [], grades: [], remarks: [] });
});

test('normalizePractice', () => {
  const r = normalizePractice({ title: 'Деление', intro: 'Занимайтесь', items: [{ question: '12:3', answer: '4', hint: 'таблица' }, { question: '', answer: '1', hint: '' }] });
  assert.equal(r.items.length, 1);
  assert.equal(r.title, 'Деление');
  assert.throws(() => normalizePractice({ items: [] }), /не вернула/);
  assert.throws(() => normalizePractice(null), /не вернула/);
  assert.equal(normalizePractice({ items: [{ question: 'q', answer: 'a' }] }).title, 'Тренировка');
});

test('промпты не содержат имени ребёнка и включают класс/тему', () => {
  const p = practicePrompt({ grade: '3', subject: 'Математика', topic: 'деление в столбик', count: 8, level: 'easier', hints: ['стр. 45 №3'] });
  assert.match(p.user, /Класс: 3/);
  assert.match(p.user, /деление в столбик/);
  assert.match(p.user, /стр\. 45/);
  assert.equal(p.schema.required.includes('items'), true);
  const d = diaryPrompt(subjects, '2026-10-06');
  assert.match(d.user, /Сегодня 2026-10-06 \(вторник\)/);
  assert.match(d.user, /Математика, Русский язык/);
});

test('practiceAsTaskText и nextSchoolDay', () => {
  const t = practiceAsTaskText({ topic: 'таблица на 7', items: [{ question: '7×6' }, { question: '7×8' }] });
  assert.equal(t, 'Тренировка: таблица на 7\n1) 7×6\n2) 7×8');
  assert.equal(nextSchoolDay('2026-10-09'), '2026-10-12'); // пятница → понедельник
  assert.equal(nextSchoolDay('2026-10-06'), '2026-10-07');
});
