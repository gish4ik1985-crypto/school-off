import * as L from './logic.js';
import * as S from './store.js';

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
  return `<div class="cards">${state.children
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
  const body = { overview, schedule: scheduleTab, tasks: tasksTab, grades: gradesTab, remarks: remarksTab }[tab] ?? overview;
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

// --- Расписание ---

function scheduleTab(c) {
  const today = L.dow(L.todayISO());
  const mine = state.schedule.filter((l) => l.childId === c.id);
  const days = [1, 2, 3, 4, 5].concat(mine.some((l) => l.day === 6) ? [6] : []);
  return `<div class="toolbar"><span class="muted">Уроки на неделю</span>
      <button class="btn primary" data-act="lesson-form" data-child="${c.id}">+ Урок</button></div>
    <div class="week">${days
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
      .join('')}</div>
    <p class="muted">Нажмите на урок, чтобы изменить или удалить. Расписание подсказывает срок домашки — до ближайшего урока по предмету.</p>`;
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

function formFields(kind, item, childId, day) {
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
    const dueDefault = item?.due ?? L.nextLessonDate(state, childId, firstSubject, today) ?? L.addDays(today, 1);
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
    <label>Дата<input type="date" name="date" value="${item?.date ?? today}" required /></label>
    <label>Предмет (необязательно)<select name="subjectId">${subjectOptions(item?.subjectId, true)}</select></label>
    <label>Кто написал (необязательно)<input name="teacher" value="${esc(item?.teacher ?? '')}" placeholder="Например, Мария Ивановна" /></label>
    <label>Текст<textarea name="text" rows="3" required>${esc(item?.text ?? '')}</textarea></label>`;
}

function openForm(kind, { id, childId, day } = {}) {
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
      ${formFields(kind, item, cid, Number(day) || undefined)}
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
  for (const list of ['tasks', 'grades', 'remarks', 'schedule']) {
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

// ---------- Обработчики ----------

document.addEventListener('submit', (e) => {
  if (e.target.id === 'entry-form') submitEntry(e);
  if (e.target.id === 'child-form') submitChild(e);
});

dlg.addEventListener('cancel', () => form?.pending?.forEach((p) => URL.revokeObjectURL(p.url)));

document.addEventListener('change', async (e) => {
  const act = e.target.dataset.act;
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
    case 'task-form': openForm('task', { id, childId: child }); break;
    case 'grade-form': openForm('grade', { id, childId: child }); break;
    case 'remark-form': openForm('remark', { id, childId: child }); break;
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
