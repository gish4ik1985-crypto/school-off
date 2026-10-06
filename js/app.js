import * as L from './logic.js';
import * as S from './store.js';
import * as W from './week.js';
import * as D from './diary.js';
import * as R from './remind.js';

let state = S.load();
const root = document.getElementById('app');
const dlg = document.getElementById('dlg');
const lightbox = document.getElementById('lightbox');

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const EMOJIS = ['🧒', '👦', '👧', '🦊', '🐼', '🦁', '🐯', '🐸', '🚀', '⚽'];
const REMARK_TYPES = {
  negative: { label: 'Замечание', cls: 'bad' },
  positive: { label: 'Похвала', cls: 'good' },
  info: { label: 'Информация', cls: 'info' },
};
const TABS = [
  ['overview', 'Обзор'],
  ['diary', 'Дневник'],
  ['week', 'Неделя'],
  ['practice', 'Подтянуть'],
  ['schedule', 'Расписание'],
  ['tasks', 'Задания'],
  ['grades', 'Оценки'],
  ['remarks', 'Замечания'],
];

const subjectName = (id) => state.subjects.find((s) => s.id === id)?.name ?? '—';
const childById = (id) => state.children.find((c) => c.id === id);
const commit = () => {
  S.save(state);
  render();
};
const subjectOptions = (selected, withEmpty) =>
  (withEmpty ? '<option value="">— не указан —</option>' : '') +
  state.subjects
    .map((s) => `<option value="${s.id}" ${s.id === selected ? 'selected' : ''}>${esc(s.name)}</option>`)
    .join('');

let photoUrls = [];
let taskFilter = 'active';
let gradeSubject = '';
let diaryFrom = null; // понедельник недели в «Дневнике»; null = текущая
let showSat = false;
let weekFrom = null; // понедельник выбранной недели; null = текущая

// ---------- Маршрутизация ----------

function route() {
  const [, page, id, tab] = location.hash.split('/');
  return { page: page || 'home', id, tab: tab || 'overview' };
}

function render() {
  const r = route();
  photoUrls.forEach((u) => URL.revokeObjectURL(u));
  photoUrls = [];
  let html;
  if (r.page === 'child' && childById(r.id)) html = childPage(childById(r.id), r.tab);
  else if (r.page === 'settings') html = settingsPage();
  else html = homePage();
  root.innerHTML = html;
  root.classList.toggle('wide', r.page === 'child' && ['diary', 'schedule'].includes(r.tab));
  hydratePhotos();
  document.title = 'Школьный помощник';
}

async function hydratePhotos() {
  for (const img of root.querySelectorAll('img[data-photo]')) {
    try {
      const blob = await S.getPhoto(img.dataset.photo);
      if (!blob) continue;
      const url = URL.createObjectURL(blob);
      photoUrls.push(url);
      img.src = url;
    } catch {
      /* фото недоступно — оставляем пустую рамку */
    }
  }
}

// ---------- Главная: карточки детей ----------

function homePage() {
  if (!state.children.length) {
    return `<section class="empty">
      <h2>Добро пожаловать 👋</h2>
      <p>Добавьте ребёнка, чтобы начать вести задания, оценки и замечания учителей.</p>
      <button class="btn primary" data-act="child-form">Добавить ребёнка</button>
    </section>`;
  }
  const today = L.todayISO();
  return `${reminderBanner(today)}<div class="cards">${state.children
    .map((c) => {
      const tasks = state.tasks.filter((t) => t.childId === c.id);
      const nToday = tasks.filter((t) => L.taskStatus(t, today) === 'today').length;
      const nOver = tasks.filter((t) => L.taskStatus(t, today) === 'overdue').length;
      const avg = L.recentAverage(state.grades.filter((g) => g.childId === c.id), today);
      const att = L.attention(state, c.id, today);
      return `<article class="card">
        <a class="card-head" href="#/child/${c.id}/overview">
          <span class="avatar">${esc(c.emoji)}</span>
          <span><strong>${esc(c.name)}</strong><small>${esc(c.grade)} класс</small></span>
        </a>
        <div class="stats">
          <div><b>${nToday}</b><small>на сегодня</small></div>
          <div class="${nOver ? 'warn' : ''}"><b>${nOver}</b><small>просрочено</small></div>
          <div><b>${avg ?? '—'}</b><small>балл за 30 дн.</small></div>
        </div>
        ${attentionList(att, c.id)}
        <div class="quick">
          <button class="chip" data-act="task-form" data-child="${c.id}">+ Задание</button>
          <button class="chip" data-act="grade-form" data-child="${c.id}">+ Оценка</button>
          <button class="chip" data-act="remark-form" data-child="${c.id}">+ Замечание</button>
          <a class="chip" href="#/child/${c.id}/week">📊 Сводка недели</a>
          <a class="chip" href="#/child/${c.id}/practice">🎯 Подтянуть</a>
        </div>
      </article>`;
    })
    .join('')}</div>`;
}

function attentionList(items, childId) {
  if (!items.length) return '<p class="ok">Всё спокойно — поводов для беспокойства нет 👍</p>';
  return `<ul class="attention">${items
    .map((i) => `<li class="${i.level}"><a href="#/child/${childId}/${i.tab}">${esc(i.text)}</a></li>`)
    .join('')}</ul>`;
}

// ---------- Страница ребёнка ----------

function childPage(c, tab) {
  const tabs = TABS.map(
    ([k, label]) => `<a class="tab ${k === tab ? 'active' : ''}" href="#/child/${c.id}/${k}">${label}</a>`,
  ).join('');
  const body = { overview, diary: diaryTab, week: weekTab, practice: practiceTab, schedule: scheduleTab, tasks: tasksTab, grades: gradesTab, remarks: remarksTab }[tab] ?? overview;
  return `<div class="child-head">
      <a href="#/" class="back" aria-label="Назад">←</a>
      <span class="avatar">${esc(c.emoji)}</span>
      <h2>${esc(c.name)} <small>${esc(c.grade)} класс</small></h2>
      <button class="chip edit-name" data-act="child-form" data-id="${c.id}" aria-label="Изменить имя и класс" title="Изменить имя и класс">✏️</button>
    </div>
    <nav class="tabs">${tabs}</nav>
    ${body(c)}`;
}

function sparkline(values) {
  const v = values.slice(-10);
  if (v.length < 2) return '';
  const w = 70;
  const h = 22;
  const pts = v.map((x, i) => `${((i / (v.length - 1)) * w).toFixed(1)},${(h - ((x - 1) / 4) * h).toFixed(1)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}

const gradeCls = (v) => (v >= 5 ? 'g5' : v >= 4 ? 'g4' : v >= 3 ? 'g3' : 'g2');

function overview(c) {
  const today = L.todayISO();
  const grades = state.grades.filter((g) => g.childId === c.id);
  const stats = L.subjectStats(grades, state.subjects);
  const recent = [...grades].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 5);
  const tomorrow = L.addDays(today, 1);
  const lessons = L.lessonsOn(state, c.id, tomorrow);
  const dueTomorrow = state.tasks.filter((t) => t.childId === c.id && t.due === tomorrow && t.status === 'todo');
  return `<section>
      <h3>Завтра, ${L.formatDateLong(tomorrow)}</h3>
      ${
        lessons.length
          ? `<p>${lessons.map((l) => `${l.num}. ${esc(subjectName(l.subjectId))}`).join(' · ')}</p>`
          : `<p class="muted">Расписание на этот день не заполнено. <a class="link" href="#/child/${c.id}/schedule">Заполнить</a></p>`
      }
      ${dueTomorrow.length ? `<p class="note">К завтрашнему дню не сделано: ${dueTomorrow.map((t) => esc(subjectName(t.subjectId))).join(', ')}</p>` : ''}
    </section>
    <section>
      <h3>На что обратить внимание</h3>
      ${attentionList(L.attention(state, c.id, today), c.id)}
    </section>
    <section>
      <h3>Успеваемость по предметам</h3>
      ${
        stats.length
          ? `<table class="subjects"><tbody>${stats
              .map((s) => {
                const arrow = s.trend === null ? '' : s.trend >= 0.5 ? '<span class="up">↑</span>' : s.trend <= -0.5 ? '<span class="down">↓</span>' : '';
                return `<tr><td>${esc(s.subject.name)}</td><td><span class="grade ${gradeCls(Math.round(s.avg))}">${s.avg}</span> ${arrow}</td><td>${sparkline(s.values)}</td><td class="muted">${s.count} шт.</td></tr>`;
              })
              .join('')}</tbody></table>`
          : '<p class="muted">Оценок пока нет. Добавьте первую на вкладке «Оценки».</p>'
      }
    </section>
    <section>
      <h3>Последние оценки</h3>
      ${recent.length ? `<ul class="list">${recent.map(gradeItem).join('')}</ul>` : '<p class="muted">Пусто.</p>'}
    </section>`;
}

function photoStrip(ids) {
  if (!ids?.length) return '';
  return `<div class="photos">${ids
    .map((id) => `<img class="thumb" data-photo="${id}" data-act="open-photo" alt="Фото" />`)
    .join('')}</div>`;
}

// --- Сводка за неделю ---

function weekTab(c) {
  const today = L.todayISO();
  const cur = W.weekStart(today);
  weekFrom = weekFrom ?? cur;
  const s = W.weeklySummary(state, c.id, weekFrom, today);
  const g = s.grades;
  const delta = g.avg !== null && g.prevAvg !== null ? Math.round((g.avg - g.prevAvg) * 10) / 10 : null;
  const arrow = delta === null || delta === 0 ? '' : delta > 0 ? `<span class="up">↑ ${delta}</span>` : `<span class="down">↓ ${Math.abs(delta)}</span>`;
  const nav = `<div class="weeknav">
      <button class="chip" data-act="week-shift" data-value="-1" aria-label="Предыдущая неделя">‹</button>
      <strong>${L.formatDate(s.from)} – ${L.formatDate(s.to)}${weekFrom === cur ? ' <small>эта неделя</small>' : ''}</strong>
      <button class="chip" data-act="week-shift" data-value="1" aria-label="Следующая неделя" ${weekFrom >= cur ? 'disabled' : ''}>›</button>
      ${weekFrom === cur ? '' : '<button class="chip" data-act="week-now">К текущей</button>'}
    </div>`;
  if (s.empty) {
    return `${nav}<p class="muted">За эту неделю нет записей. Добавьте задания, оценки или замечания — и здесь появится сводка.</p>`;
  }
  const t = s.tasks;
  const r = s.remarks;
  const list = (items) => `<ul class="plain">${items.map((x) => `<li>${x}</li>`).join('')}</ul>`;
  const good = [
    ...(g.fives ? [`Пятёрок за неделю: ${g.fives}`] : []),
    ...(t.total && t.finished === t.total ? ['Все задания недели выполнены'] : []),
    ...r.positive.map((x) => `Похвала ${L.formatDate(x.date)}: ${esc(x.text)}`),
  ];
  const bad = [
    ...t.missed.map((x) => `Не сдано: ${esc(x.subject)} — ${esc(x.text)} (срок ${L.formatDate(x.due)})`),
    ...g.list.filter((x) => x.value <= 3).map((x) => `Оценка ${x.value}: ${esc(x.subject)} (${esc(x.kind)}, ${L.formatDate(x.date)})`),
    ...r.negative.map((x) => `Замечание ${L.formatDate(x.date)}${x.subject ? ` (${esc(x.subject)})` : ''}: ${esc(x.text)}`),
  ];
  return `${nav}
    <div class="stats tiles">
      <div><b>${t.finished}<small class="of">/${t.total}</small></b><small>заданий сделано</small></div>
      <div><b>${g.avg ?? '—'}</b><small>средний балл ${arrow}</small></div>
      <div class="${r.negative.length ? 'warn' : ''}"><b>${r.negative.length}</b><small>замечаний${r.positive.length ? `, похвал: ${r.positive.length}` : ''}</small></div>
    </div>
    <section><h3>Что получилось 👍</h3>${good.length ? list(good) : '<p class="muted">Пока ничего особенного.</p>'}</section>
    <section><h3>Что тревожит</h3>${bad.length ? list(bad) : '<p class="ok">Ничего тревожного.</p>'}</section>
    <section><h3>Что делать дальше</h3>${s.tips.length ? list(s.tips.map(esc)) : '<p class="muted">—</p>'}</section>
    <div class="actions"><button class="btn" data-act="copy-summary" data-id="${c.id}">📋 Скопировать текст для отправки</button></div>`;
}

// --- Расписание ---

const lessonOptions = (selected) => '<option value="">—</option>' + state.subjects.map((s) => `<option value="${s.id}" ${s.id === selected ? 'selected' : ''}>${esc(s.name)}</option>`).join('');

function scheduleTab(c) {
  const today = L.dow(L.todayISO());
  const mine = state.schedule.filter((l) => l.childId === c.id);
  const withSat = showSat || mine.some((l) => l.day === 6);
  const days = [1, 2, 3, 4, 5].concat(withSat ? [6] : []);
  const rows = Math.max(8, ...mine.map((l) => l.num));
  const at = (d, n) => mine.find((l) => l.day === d && l.num === n);
  const grid = `<table class="sgrid">
      <thead><tr><th></th>${days.map((d) => `<th class="${d === today ? 'today' : ''}">${L.DAY_NAMES[d]}</th>`).join('')}</tr></thead>
      <tbody>${Array.from({ length: rows }, (_, i) => i + 1)
        .map((n) => `<tr><th>${n}</th>${days.map((d) => `<td><select data-act="lesson-cell" data-child="${c.id}" data-day="${d}" data-num="${n}" aria-label="${L.DAY_NAMES[d]}, урок ${n}">${lessonOptions(at(d, n)?.subjectId)}</select></td>`).join('')}</tr>`)
        .join('')}</tbody></table>`;
  const cards = days
    .map((d) => {
      const ls = mine.filter((l) => l.day === d).sort((a, b) => a.num - b.num);
      return `<section class="day ${d === today ? 'today' : ''}">
          <h4>${L.DAY_NAMES[d]}${d === today ? ' <small>сегодня</small>' : ''}</h4>
          ${
            ls.length
              ? `<ol class="lessons">${ls
                  .map(
                    (l) => `<li data-act="lesson-form" data-id="${l.id}"><b>${l.num}</b><span>${esc(subjectName(l.subjectId))}${l.room ? ` <small>каб. ${esc(l.room)}</small>` : ''}</span><small>${esc(l.start ?? '')}${l.start && l.end ? '–' : ''}${esc(l.end ?? '')}</small></li>`,
                  )
                  .join('')}</ol>`
              : '<p class="muted">нет уроков</p>'
          }
          <button class="chip" data-act="lesson-form" data-child="${c.id}" data-day="${d}">+ Урок</button>
        </section>`;
    })
    .join('');
  return `<div class="toolbar"><span class="muted">Расписание уроков на неделю</span>
      <span class="actions">${mine.some((l) => l.day === 6) ? '' : `<button class="chip" data-act="toggle-sat">${withSat ? 'Скрыть субботу' : 'Показать субботу'}</button>`}
      <button class="btn primary sched-narrow" data-act="lesson-form" data-child="${c.id}">+ Урок</button></span></div>
    <div class="sched-wide">${grid}<p class="muted">Выберите предмет в нужной клетке — расписание сохраняется сразу. Расписание нужно, чтобы вкладка «Дневник» знала, какие уроки в какой день.</p></div>
    <div class="week sched-narrow">${cards}</div>
    <p class="muted sched-narrow">Нажмите на урок, чтобы изменить время или кабинет. На большом экране расписание показано таблицей, как в дневнике.</p>`;
}

// --- Дневник: разворот недели ---

function diaryTab(c) {
  const today = L.todayISO();
  const cur = W.weekStart(today);
  diaryFrom = diaryFrom ?? cur;
  const hasSat = state.schedule.some((l) => l.childId === c.id && l.day === 6);
  const days = D.diaryWeek(state, c.id, diaryFrom, showSat || hasSat);
  const to = L.addDays(diaryFrom, 6);
  const nav = `<div class="weeknav">
      <button class="chip" data-act="diary-shift" data-value="-1" aria-label="Предыдущая неделя">‹</button>
      <strong>${L.formatDate(diaryFrom)} – ${L.formatDate(to)}${diaryFrom === cur ? ' <small>эта неделя</small>' : ''}</strong>
      <button class="chip" data-act="diary-shift" data-value="1" aria-label="Следующая неделя">›</button>
      ${diaryFrom === cur ? '' : '<button class="chip" data-act="diary-now">К текущей</button>'}
      ${hasSat ? '' : `<button class="chip" data-act="toggle-sat">${showSat ? 'Скрыть субботу' : '+ суббота'}</button>`}
    </div>`;
  if (!state.schedule.some((l) => l.childId === c.id)) {
    return `${nav}<p class="muted">Сначала заполните расписание уроков — оно станет строками дневника. <a class="link" href="#/child/${c.id}/schedule">Открыть расписание</a></p>`;
  }
  const hwCell = (row, date) => {
    const t = row.tasks[0];
    const more = row.tasks.slice(1);
    return `<td class="hw">
        <button class="st st-${t?.status ?? 'none'}" data-act="hw-status" data-id="${t?.id ?? ''}" ${t ? '' : 'disabled'} title="Нажмите: сделано → проверено → в работе">${{ todo: '☐', done: '✓', checked: '✓✓' }[t?.status] ?? '☐'}</button>
        <textarea rows="2" data-act="hw-edit" data-child="${c.id}" data-subject="${row.lesson.subjectId}" data-date="${date}" placeholder="${row.first ? 'что задано…' : '(см. выше)'}" ${row.first ? '' : 'disabled'} aria-label="Домашнее задание: ${esc(row.subject)}">${esc(t?.text ?? '')}</textarea>
        ${more.length ? `<p class="more">Ещё: ${more.map((x) => esc(x.text)).join(' · ')}</p>` : ''}
      </td>`;
  };
  const gradeCell = (row, date) => {
    const g = row.grades[0];
    return `<td class="gr"><select data-act="grade-edit" data-child="${c.id}" data-subject="${row.lesson.subjectId}" data-date="${date}" ${row.first ? '' : 'disabled'} aria-label="Оценка: ${esc(row.subject)}">
        <option value="">—</option>${[5, 4, 3, 2, 1].map((v) => `<option ${g?.value === v ? 'selected' : ''}>${v}</option>`).join('')}</select></td>`;
  };
  const page = days
    .map(
      (d) => `<section class="dday ${d.date === today ? 'today' : ''}">
      <h4>${d.name} <small>${L.formatDate(d.date)}</small></h4>
      ${
        d.rows.length
          ? `<table class="dtable"><thead><tr><th>№</th><th>Предмет</th><th>Домашнее задание</th><th>Оц.</th></tr></thead><tbody>${d.rows
              .map((r) => `<tr><td class="num">${r.lesson.num}</td><td class="subj">${esc(r.subject)}${r.lesson.room ? `<small>каб. ${esc(r.lesson.room)}</small>` : ''}</td>${hwCell(r, d.date)}${gradeCell(r, d.date)}</tr>`)
              .join('')}</tbody></table>`
          : '<p class="muted">В этот день уроков нет.</p>'
      }
      ${d.extraTasks.length ? `<div class="dextra"><b>Ещё на этот день:</b> ${d.extraTasks.map((t) => `${esc(subjectName(t.subjectId))}: ${esc(t.text)}`).join(' · ')}</div>` : ''}
      <div class="dnotes"><b>Замечания:</b>
        ${d.remarks.length ? d.remarks.map((r) => `<span class="tag ${(REMARK_TYPES[r.type] ?? REMARK_TYPES.info).cls}" title="${esc(r.text)}">${esc(r.text.length > 40 ? `${r.text.slice(0, 39)}…` : r.text)}</span>`).join(' ') : '<span class="muted">нет</span>'}
        <button class="chip" data-act="remark-form" data-child="${c.id}" data-date="${d.date}">+ Замечание</button>
        <button class="chip" data-act="task-form" data-child="${c.id}" data-date="${d.date}">+ Другое задание</button>
      </div>
    </section>`,
    )
    .join('');
  return `${nav}<div class="spread">${page}</div>
    <p class="muted">Пишите домашнее задание прямо в строке нужного предмета (в день, к которому оно задано) — оно сохранится само и появится в «Заданиях». Значок слева от задания: ☐ в работе, ✓ сделано, ✓✓ проверено.</p>`;
}

// --- Задания ---

function tasksTab(c) {
  const today = L.todayISO();
  const all = state.tasks.filter((t) => t.childId === c.id);
  const isActive = (t) => ['overdue', 'today', 'upcoming', 'done'].includes(L.taskStatus(t, today));
  const filters = { active: 'Активные', checked: 'Проверенные', all: 'Все' };
  let items = all.filter((t) => (taskFilter === 'active' ? isActive(t) : taskFilter === 'checked' ? t.status === 'checked' : true));
  items.sort((a, b) => (taskFilter === 'active' ? (a.due < b.due ? -1 : 1) : a.due < b.due ? 1 : -1));
  return `<div class="toolbar">
      <div class="chips">${Object.entries(filters)
        .map(([k, v]) => `<button class="chip ${k === taskFilter ? 'on' : ''}" data-act="task-filter" data-value="${k}">${v}</button>`)
        .join('')}</div>
      <button class="btn primary" data-act="task-form" data-child="${c.id}">+ Задание</button>
    </div>
    ${items.length ? `<ul class="list">${items.map((t) => taskItem(t, today)).join('')}</ul>` : '<p class="muted">Заданий нет.</p>'}`;
}

const STATUS_LABEL = { overdue: 'Просрочено', today: 'Сегодня', upcoming: 'Впереди', done: 'Сделано, ждёт проверки', checked: 'Проверено' };

function taskItem(t, today) {
  const st = L.taskStatus(t, today);
  let actions = '';
  if (t.status === 'checked' || t.status === 'done') {
    if (t.status === 'done') actions += `<button class="chip ok" data-act="task-set" data-id="${t.id}" data-value="checked">✓ Проверено</button>`;
    actions += `<button class="chip" data-act="task-set" data-id="${t.id}" data-value="todo">Вернуть в работу</button>`;
  } else {
    actions += `<button class="chip ok" data-act="task-set" data-id="${t.id}" data-value="done">Сделано</button>`;
  }
  actions += `<button class="chip" data-act="task-form" data-id="${t.id}">Изменить</button>`;
  return `<li class="item st-${st}">
    <div class="item-top"><span class="tag">${esc(subjectName(t.subjectId))}</span><span class="due">${esc(L.dueLabel(t, today))}</span><span class="status">${STATUS_LABEL[st]}</span></div>
    <p class="text">${esc(t.text)}</p>
    ${t.note ? `<p class="note">📝 ${esc(t.note)}</p>` : ''}
    ${photoStrip(t.photoIds)}
    <div class="actions">${actions}</div>
  </li>`;
}

// --- Оценки ---

function gradeItem(g) {
  return `<li class="item">
    <div class="item-top">
      <span class="grade ${gradeCls(g.value)}">${g.value}</span>
      <span class="tag">${esc(subjectName(g.subjectId))}</span>
      <span class="due">${esc(g.kind)} · ${L.formatDateLong(g.date)}</span>
    </div>
    ${g.comment ? `<p class="text">${esc(g.comment)}</p>` : ''}
    ${photoStrip(g.photoIds)}
    <div class="actions"><button class="chip" data-act="grade-form" data-id="${g.id}">Изменить</button></div>
  </li>`;
}

function gradesTab(c) {
  const items = state.grades
    .filter((g) => g.childId === c.id && (!gradeSubject || g.subjectId === gradeSubject))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  return `<div class="toolbar">
      <select data-act="grade-filter" aria-label="Предмет"><option value="">Все предметы</option>${subjectOptions(gradeSubject)}</select>
      <button class="btn primary" data-act="grade-form" data-child="${c.id}">+ Оценка</button>
    </div>
    ${items.length ? `<ul class="list">${items.map(gradeItem).join('')}</ul>` : '<p class="muted">Оценок нет.</p>'}`;
}

// --- Замечания ---

function remarksTab(c) {
  const items = state.remarks.filter((r) => r.childId === c.id).sort((a, b) => (a.date < b.date ? 1 : -1));
  return `<div class="toolbar"><span></span><button class="btn primary" data-act="remark-form" data-child="${c.id}">+ Замечание</button></div>
    ${
      items.length
        ? `<ul class="list">${items
            .map((r) => {
              const t = REMARK_TYPES[r.type] ?? REMARK_TYPES.info;
              return `<li class="item">
                <div class="item-top"><span class="tag ${t.cls}">${t.label}</span>${r.subjectId ? `<span class="tag">${esc(subjectName(r.subjectId))}</span>` : ''}<span class="due">${L.formatDateLong(r.date)}${r.teacher ? ` · ${esc(r.teacher)}` : ''}</span></div>
                <p class="text">${esc(r.text)}</p>
                ${photoStrip(r.photoIds)}
                <div class="actions"><button class="chip" data-act="remark-form" data-id="${r.id}">Изменить</button></div>
              </li>`;
            })
            .join('')}</ul>`
        : '<p class="muted">Замечаний и похвал нет.</p>'
    }`;
}

// ---------- Настройки ----------

function settingsPage() {
  return `<div class="child-head"><a href="#/" class="back" aria-label="Назад">←</a><h2>Настройки</h2></div>
    <section>
      <h3>Дети</h3>
      <ul class="list">${state.children
        .map(
          (c) => `<li class="item row"><span><span class="avatar sm">${esc(c.emoji)}</span> ${esc(c.name)}, ${esc(c.grade)} класс</span>
            <span><button class="chip" data-act="child-form" data-id="${c.id}">Изменить</button></span></li>`,
        )
        .join('')}</ul>
      <button class="btn" data-act="child-form">+ Добавить ребёнка</button>
    </section>
    <section>
      <h3>Предметы</h3>
      <ul class="list">${state.subjects
        .map(
          (s) => `<li class="item row"><span>${esc(s.name)}</span>
            <span><button class="chip" data-act="subject-rename" data-id="${s.id}">Переименовать</button>
            <button class="chip" data-act="subject-delete" data-id="${s.id}">Удалить</button></span></li>`,
        )
        .join('')}</ul>
      <button class="btn" data-act="subject-add">+ Добавить предмет</button>
    </section>
    ${remindSettings()}
    <section>
      <h3>Резервная копия</h3>
      <p class="muted">Данные хранятся только в этом браузере, на этом устройстве. Сохраняйте копию время от времени — и так же можно перенести данные на другое устройство.</p>
      <div class="actions">
        <button class="btn" data-act="export">Скачать копию</button>
        <label class="btn">Загрузить копию<input type="file" accept="application/json,.json" data-act="import" hidden /></label>
      </div>
    </section>
    <section>
      <h3>Опасная зона</h3>
      <button class="btn danger" data-act="wipe">Удалить все данные</button>
    </section>`;
}

// ---------- Формы ----------

let form = null; // { kind, item, existing, removed, pending }

const KINDS = {
  task: { list: 'tasks', title: ['Новое задание', 'Задание'] },
  grade: { list: 'grades', title: ['Новая оценка', 'Оценка'] },
  remark: { list: 'remarks', title: ['Новое замечание', 'Замечание или похвала'] },
  lesson: { list: 'schedule', title: ['Новый урок', 'Урок'] },
};

function formFields(kind, item, childId, day, date) {
  const today = L.todayISO();
  if (kind === 'lesson') {
    const d = item?.day ?? day ?? 1;
    const dayLessons = state.schedule.filter((l) => l.childId === childId && l.day === d);
    const num = item?.num ?? Math.max(0, ...dayLessons.map((l) => l.num)) + 1;
    return `<label>День недели<select name="day">${[1, 2, 3, 4, 5, 6]
      .map((x) => `<option value="${x}" ${x === d ? 'selected' : ''}>${L.DAY_NAMES[x]}</option>`)
      .join('')}</select></label>
      <label>Номер урока<input type="number" name="num" min="1" max="10" value="${num}" required /></label>
      <label>Предмет<select name="subjectId" required>${subjectOptions(item?.subjectId)}</select></label>
      <label>Начало (необязательно)<input type="time" name="start" value="${esc(item?.start ?? '')}" /></label>
      <label>Конец (необязательно)<input type="time" name="end" value="${esc(item?.end ?? '')}" /></label>
      <label>Кабинет (необязательно)<input name="room" value="${esc(item?.room ?? '')}" /></label>`;
  }
  if (kind === 'task') {
    const firstSubject = item?.subjectId ?? state.subjects[0]?.id;
    const dueDefault = item?.due ?? date ?? L.nextLessonDate(state, childId, firstSubject, today) ?? L.addDays(today, 1);
    return `<label>Предмет<select name="subjectId" required>${subjectOptions(item?.subjectId)}</select></label>
      <label>Что задано<textarea name="text" rows="3" required>${esc(item?.text ?? '')}</textarea></label>
      <label>Срок сдачи<input type="date" name="due" value="${dueDefault}" required /></label>
      <label>Заметка родителя (необязательно)<input name="note" value="${esc(item?.note ?? '')}" /></label>`;
  }
  if (kind === 'grade') {
    const cur = item?.value ?? 5;
    return `<label>Предмет<select name="subjectId" required>${subjectOptions(item?.subjectId)}</select></label>
      <fieldset class="values"><legend>Оценка</legend>${[5, 4, 3, 2, 1]
        .map((v) => `<label class="valbtn ${gradeCls(v)}"><input type="radio" name="value" value="${v}" ${v === cur ? 'checked' : ''} /><span>${v}</span></label>`)
        .join('')}</fieldset>
      <label>Вид работы<select name="kind">${L.GRADE_KINDS.map((k) => `<option ${k === (item?.kind ?? 'Классная работа') ? 'selected' : ''}>${k}</option>`).join('')}</select></label>
      <label>Дата<input type="date" name="date" value="${item?.date ?? today}" required /></label>
      <label>Комментарий (необязательно)<textarea name="comment" rows="2">${esc(item?.comment ?? '')}</textarea></label>`;
  }
  return `<label>Тип<select name="type">${Object.entries(REMARK_TYPES)
      .map(([k, v]) => `<option value="${k}" ${k === (item?.type ?? 'negative') ? 'selected' : ''}>${v.label}</option>`)
      .join('')}</select></label>
    <label>Дата<input type="date" name="date" value="${item?.date ?? date ?? today}" required /></label>
    <label>Предмет (необязательно)<select name="subjectId">${subjectOptions(item?.subjectId, true)}</select></label>
    <label>Кто написал (необязательно)<input name="teacher" value="${esc(item?.teacher ?? '')}" placeholder="Например, Мария Ивановна" /></label>
    <label>Текст<textarea name="text" rows="3" required>${esc(item?.text ?? '')}</textarea></label>`;
}

function openForm(kind, { id, childId, day, date } = {}) {
  const meta = KINDS[kind];
  const item = id ? state[meta.list].find((x) => x.id === id) : null;
  const cid = item?.childId ?? childId ?? route().id ?? state.children[0]?.id;
  form = { kind, item, existing: [...(item?.photoIds ?? [])], removed: [], pending: [] };
  const childSelect =
    state.children.length > 1
      ? `<label>Ребёнок<select name="childId">${state.children
          .map((c) => `<option value="${c.id}" ${c.id === cid ? 'selected' : ''}>${esc(c.name)}</option>`)
          .join('')}</select></label>`
      : `<input type="hidden" name="childId" value="${cid}" />`;
  dlg.innerHTML = `<form method="dialog" id="entry-form">
      <h3>${meta.title[item ? 1 : 0]}</h3>
      ${childSelect}
      ${formFields(kind, item, cid, Number(day) || undefined, date || undefined)}
      ${kind === 'lesson' ? '' : `<div class="field"><span>Фото (необязательно)</span>
        <label class="btn small">📷 Добавить фото<input type="file" accept="image/*" multiple hidden data-act="pick-photos" /></label>
        <div class="photos" id="form-photos"></div>
      </div>`}
      <div class="actions end">
        ${item ? '<button type="button" class="btn danger" data-act="delete-entry">Удалить</button>' : ''}
        <button type="button" class="btn" data-act="close-dialog">Отмена</button>
        <button type="submit" class="btn primary">Сохранить</button>
      </div>
    </form>`;
  dlg.showModal();
  renderFormPhotos();
}

function renderFormPhotos() {
  const box = document.getElementById('form-photos');
  if (!box) return;
  const parts = [];
  for (const id of form.existing) parts.push(`<span class="ph"><img class="thumb" data-photo="${id}" alt="Фото" /><button type="button" data-act="rm-existing" data-id="${id}" aria-label="Убрать фото">×</button></span>`);
  form.pending.forEach((p, i) => parts.push(`<span class="ph"><img class="thumb" src="${p.url}" alt="Новое фото" /><button type="button" data-act="rm-pending" data-index="${i}" aria-label="Убрать фото">×</button></span>`));
  box.innerHTML = parts.join('');
  box.querySelectorAll('img[data-photo]').forEach(async (img) => {
    const blob = await S.getPhoto(img.dataset.photo);
    if (blob) img.src = URL.createObjectURL(blob);
  });
}

async function submitEntry(e) {
  e.preventDefault();
  const fd = new FormData(e.target);
  await form.loading;
  const meta = KINDS[form.kind];
  const rec = { ...(form.item ?? { id: S.uid(), createdAt: new Date().toISOString() }) };
  for (const [k, v] of fd.entries()) rec[k] = typeof v === 'string' ? v.trim() : v;
  if (form.kind === 'grade') rec.value = Number(rec.value);
  if (form.kind === 'lesson') {
    rec.day = Number(rec.day);
    rec.num = Number(rec.num);
    for (const k of ['start', 'end', 'room']) if (!rec[k]) delete rec[k];
  }
  if (form.kind === 'task') rec.status = form.item?.status ?? 'todo';
  if (form.kind === 'remark' && !rec.subjectId) delete rec.subjectId;
  const newIds = [];
  for (const p of form.pending) {
    const pid = S.uid();
    await S.putPhoto(pid, p.blob);
    newIds.push(pid);
  }
  for (const pid of form.removed) await S.deletePhoto(pid).catch(() => {});
  if (form.kind !== 'lesson') rec.photoIds = [...form.existing, ...newIds];
  const list = state[meta.list];
  const idx = list.findIndex((x) => x.id === rec.id);
  if (idx >= 0) list[idx] = rec;
  else list.push(rec);
  closeForm();
  commit();
}

function closeForm() {
  form?.pending.forEach((p) => URL.revokeObjectURL(p.url));
  form = null;
  dlg.close();
}

async function deleteEntry() {
  if (!form?.item || !confirm('Удалить запись?')) return;
  const meta = KINDS[form.kind];
  for (const pid of form.item.photoIds ?? []) await S.deletePhoto(pid).catch(() => {});
  state[meta.list] = state[meta.list].filter((x) => x.id !== form.item.id);
  closeForm();
  commit();
}

function openChildForm(id) {
  const c = id ? childById(id) : null;
  form = { child: c };
  dlg.innerHTML = `<form method="dialog" id="child-form">
      <h3>${c ? 'Ребёнок' : 'Новый ребёнок'}</h3>
      <label>Имя<input name="name" value="${esc(c?.name ?? '')}" required /></label>
      <label>Класс<input type="number" name="grade" min="1" max="11" value="${esc(c?.grade ?? 1)}" required /></label>
      <fieldset class="emoji"><legend>Значок</legend>${EMOJIS.map(
        (e) => `<label><input type="radio" name="emoji" value="${e}" ${e === (c?.emoji ?? EMOJIS[0]) ? 'checked' : ''} /><span>${e}</span></label>`,
      ).join('')}</fieldset>
      <div class="actions end">
        ${c ? '<button type="button" class="btn danger" data-act="delete-child">Удалить</button>' : ''}
        <button type="button" class="btn" data-act="close-dialog">Отмена</button>
        <button type="submit" class="btn primary">Сохранить</button>
      </div>
    </form>`;
  dlg.showModal();
}

function submitChild(e) {
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.target));
  const c = form.child;
  if (c) Object.assign(c, { name: fd.name.trim(), grade: fd.grade, emoji: fd.emoji });
  else state.children.push({ id: S.uid(), name: fd.name.trim(), grade: fd.grade, emoji: fd.emoji });
  form = null;
  dlg.close();
  commit();
}

async function deleteChild() {
  const c = form?.child;
  if (!c || !confirm(`Удалить ${c.name} вместе со всеми заданиями, оценками и замечаниями?`)) return;
  for (const list of ['tasks', 'grades', 'remarks', 'schedule', 'practice']) {
    for (const rec of state[list].filter((x) => x.childId === c.id)) {
      for (const pid of rec.photoIds ?? []) await S.deletePhoto(pid).catch(() => {});
    }
    state[list] = state[list].filter((x) => x.childId !== c.id);
  }
  state.children = state.children.filter((x) => x.id !== c.id);
  form = null;
  dlg.close();
  location.hash = '#/';
  commit();
}

// ---------- Напоминания ----------

const PREFS_KEY = 'school-off:prefs';
function getPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}');
    return { evening: /^\d{2}:\d{2}$/.test(p.evening) ? p.evening : '19:00' };
  } catch {
    return { evening: '19:00' };
  }
}
function setPrefs(p) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* хранилище недоступно — время останется по умолчанию */
  }
}

function reminderBanner(today) {
  const items = R.reminders(state, today);
  if (!items.length) return '';
  const multi = state.children.length > 1;
  return `<section class="remind"><h3>🔔 Напоминания</h3><ul class="attention">${items
    .map((i) => `<li class="${i.level}"><a href="#/child/${i.childId}/${i.tab}">${multi ? `<b>${esc(i.child)}:</b> ` : ''}${esc(i.text)}</a></li>`)
    .join('')}</ul></section>`;
}

function remindSettings() {
  return `<section>
      <h3>Напоминания</h3>
      <p class="muted">Баннер с напоминаниями показывается на главной странице. Чтобы телефон напоминал сам, скачайте календарь: в нём каждое несданное задание (с напоминанием накануне вечером) и ежедневная «проверка уроков» с вс по чт. Файл — снимок на сегодня: после новых записей скачайте его заново.</p>
      <label>Время вечерней проверки<input type="time" value="${getPrefs().evening}" data-act="evening-time" /></label>
      <div class="actions"><button class="btn" data-act="ics-export">📅 Скачать календарь (.ics)</button></div>
    </section>`;
}

// ---------- Подтянуть: рекомендации ----------

const PLAN = 'План на 5 дней по 10–15 минут: 1) вместе разберите ошибки в последней работе; 2) каждый день 5–8 заданий на тему из учебника или рабочей тетради; 3) в конце недели — короткая самопроверка.';

function practiceTab(c) {
  const weak = W.weakSubjects(state, c.id, L.todayISO());
  return `<section>
      <h3>Что подтянуть <small class="muted">— по данным за 2 недели</small></h3>
      ${
        weak.length
          ? weak
              .map(
                (w) => `<div class="item">
          <div class="item-top"><span class="tag">${esc(w.subject)}</span></div>
          <p class="text">${esc(w.reasons.join('; '))}</p>
          ${w.topics.length ? `<p class="note">Темы из ваших записей: ${w.topics.map(esc).join(' · ')}</p>` : ''}
          <p class="note">${PLAN}</p>
          <div class="actions"><button class="chip" data-act="goto-grades" data-child="${c.id}" data-subject="${w.subjectId}">Оценки по предмету</button></div>
        </div>`,
              )
              .join('')
          : '<p class="ok">Явных проблем за последние две недели не видно 👍</p>'
      }
    </section>`;
}

// ---------- Обработчики ----------

document.addEventListener('submit', (e) => {
  if (e.target.id === 'entry-form') submitEntry(e);
  if (e.target.id === 'child-form') submitChild(e);
});

dlg.addEventListener('cancel', () => form?.pending?.forEach((p) => URL.revokeObjectURL(p.url)));

document.addEventListener('change', async (e) => {
  const act = e.target.dataset.act;
  if (act === 'hw-edit') {
    const { child, subject, date } = e.target.dataset;
    const r = D.saveHomework(state, { childId: child, subjectId: subject, date, text: e.target.value }, S.uid);
    if (r.blocked) {
      alert(r.blocked);
      render();
      return;
    }
    S.save(state);
    const btn = e.target.closest('td').querySelector('.st');
    btn.disabled = !r.task;
    btn.dataset.id = r.task?.id ?? '';
    btn.textContent = r.task ? { todo: '☐', done: '✓', checked: '✓✓' }[r.task.status] : '☐';
    return;
  }
  if (act === 'grade-edit') {
    const { child, subject, date } = e.target.dataset;
    const r = D.saveGrade(state, { childId: child, subjectId: subject, date, value: e.target.value }, S.uid);
    if (r.blocked) {
      alert(r.blocked);
      render();
      return;
    }
    S.save(state);
    return;
  }
  if (act === 'lesson-cell') {
    D.setLessonSubject(state, { childId: e.target.dataset.child, day: Number(e.target.dataset.day), num: Number(e.target.dataset.num), subjectId: e.target.value }, S.uid);
    S.save(state);
    return;
  }
  if (act === 'evening-time') {
    if (e.target.value) setPrefs({ evening: e.target.value });
    return;
  }
  if (e.target.name === 'subjectId' && form?.kind === 'task' && !form.item) {
    const next = L.nextLessonDate(state, e.target.form.childId.value, e.target.value, L.todayISO());
    if (next) e.target.form.due.value = next;
  }
  if (act === 'grade-filter') {
    gradeSubject = e.target.value;
    render();
  } else if (act === 'pick-photos') {
    const current = form;
    const files = [...e.target.files];
    e.target.value = '';
    // «Сохранить» дожидается этой цепочки, чтобы не потерять фото, которые ещё обрабатываются
    current.loading = (current.loading ?? Promise.resolve()).then(async () => {
      for (const file of files) {
        try {
          const blob = await S.shrinkImage(file);
          current.pending.push({ blob, url: URL.createObjectURL(blob) });
        } catch {
          alert('Не удалось обработать одно из фото');
        }
      }
      if (form === current) renderFormPhotos();
    });
  } else if (act === 'import') {
    const file = e.target.files[0];
    if (!file || !confirm('Заменить все текущие данные данными из файла?')) return;
    try {
      state = await S.importAll(await file.text());
      commit();
      alert('Данные загружены');
    } catch (err) {
      alert(err.message);
    }
  }
});

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.tagName === 'SELECT' || el.tagName === 'INPUT') return;
  const { act, id, child, value, index } = el.dataset;
  switch (act) {
    case 'child-form': openChildForm(id); break;
    case 'delete-child': await deleteChild(); break;
    case 'task-form': openForm('task', { id, childId: child, date: el.dataset.date }); break;
    case 'grade-form': openForm('grade', { id, childId: child }); break;
    case 'remark-form': openForm('remark', { id, childId: child, date: el.dataset.date }); break;
    case 'week-shift': weekFrom = L.addDays(weekFrom ?? W.weekStart(L.todayISO()), 7 * Number(value)); render(); break;
    case 'week-now': weekFrom = null; render(); break;
    case 'copy-summary': {
      const text = W.summaryText(W.weeklySummary(state, id, weekFrom ?? W.weekStart(L.todayISO()), L.todayISO()), childById(id).name);
      try {
        await navigator.clipboard.writeText(text);
        el.textContent = '✓ Скопировано';
      } catch {
        prompt('Скопируйте текст:', text);
      }
      break;
    }
    case 'lesson-form': openForm('lesson', { id, childId: child, day: el.dataset.day }); break;
    case 'delete-entry': await deleteEntry(); break;
    case 'close-dialog': form?.pending?.forEach((p) => URL.revokeObjectURL(p.url)); form = null; dlg.close(); break;
    case 'task-filter': taskFilter = value; render(); break;
    case 'task-set': {
      const t = state.tasks.find((x) => x.id === id);
      t.status = value;
      commit();
      break;
    }
    case 'rm-existing':
      form.existing = form.existing.filter((x) => x !== id);
      form.removed.push(id);
      renderFormPhotos();
      break;
    case 'rm-pending': {
      const [p] = form.pending.splice(Number(index), 1);
      URL.revokeObjectURL(p.url);
      renderFormPhotos();
      break;
    }
    case 'open-photo':
      if (el.src) {
        lightbox.innerHTML = `<img src="${el.src}" alt="Фото" /><button class="btn" data-act="close-lightbox">Закрыть</button>`;
        lightbox.showModal();
      }
      break;
    case 'close-lightbox': lightbox.close(); break;
    case 'subject-add': {
      const name = prompt('Название предмета')?.trim();
      if (name) { state.subjects.push({ id: S.uid(), name }); commit(); }
      break;
    }
    case 'subject-rename': {
      const s = state.subjects.find((x) => x.id === id);
      const name = prompt('Новое название', s.name)?.trim();
      if (name) { s.name = name; commit(); }
      break;
    }
    case 'subject-delete': {
      const used = [...state.tasks, ...state.grades, ...state.remarks, ...state.schedule].some((x) => x.subjectId === id);
      if (used) alert('Этот предмет используется в записях — сначала измените или удалите их.');
      else if (confirm('Удалить предмет?')) { state.subjects = state.subjects.filter((x) => x.id !== id); commit(); }
      break;
    }
    case 'export': {
      const blob = new Blob([await S.exportAll(state)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `school-off-${L.todayISO()}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      break;
    }
    case 'goto-grades':
      gradeSubject = el.dataset.subject;
      location.hash = `#/child/${child}/grades`;
      break;
    case 'diary-shift': diaryFrom = L.addDays(diaryFrom ?? W.weekStart(L.todayISO()), 7 * Number(value)); render(); break;
    case 'diary-now': diaryFrom = null; render(); break;
    case 'toggle-sat': showSat = !showSat; render(); break;
    case 'hw-status': {
      const t = state.tasks.find((x) => x.id === id);
      if (t) {
        t.status = { todo: 'done', done: 'checked', checked: 'todo' }[t.status] ?? 'todo';
        commit();
      }
      break;
    }
    case 'ics-export': {
      const [h, m] = getPrefs().evening.split(':').map(Number);
      const blob = new Blob([R.buildICS(state, L.todayISO(), { hour: h, minute: m })], { type: 'text/calendar;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'school-off.ics';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      break;
    }
    case 'wipe':
      if (confirm('Удалить ВСЕ данные без возможности восстановления?') && confirm('Точно удалить? Сначала лучше скачать копию.')) {
        await S.clearPhotos();
        state = S.defaultState();
        location.hash = '#/';
        commit();
      }
      break;
  }
});

lightbox.addEventListener('click', (e) => { if (e.target === lightbox) lightbox.close(); });
window.addEventListener('hashchange', render);
render();

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
