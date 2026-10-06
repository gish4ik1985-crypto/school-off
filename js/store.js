// Хранилище в браузере: данные — localStorage, фотографии — IndexedDB.
// Ничего не уходит в сеть.

import { DEFAULT_ENDS, normalizeEnds } from './grades.js';

const KEY = 'school-off:v1';
const DB_NAME = 'school-off-photos';
const STORE = 'photos';

export const DEFAULT_SUBJECTS = [
  'Математика',
  'Русский язык',
  'Литературное чтение',
  'Окружающий мир',
  'Английский язык',
  'Технология',
  'ИЗО',
  'Музыка',
  'Физкультура',
];

export function uid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function defaultState() {
  return {
    version: 1,
    children: [],
    subjects: DEFAULT_SUBJECTS.map((name) => ({ id: uid(), name })),
    tasks: [],
    grades: [],
    remarks: [],
    schedule: [],
    finals: [],
    settings: { quarterEnds: [...DEFAULT_ENDS] },
  };
}

export function normalize(raw) {
  const base = defaultState();
  if (!raw || typeof raw !== 'object') return base;
  return {
    version: 1,
    children: Array.isArray(raw.children) ? raw.children : [],
    subjects: Array.isArray(raw.subjects) && raw.subjects.length ? raw.subjects : base.subjects,
    tasks: Array.isArray(raw.tasks) ? raw.tasks : [],
    grades: Array.isArray(raw.grades) ? raw.grades : [],
    remarks: Array.isArray(raw.remarks) ? raw.remarks : [],
    schedule: Array.isArray(raw.schedule) ? raw.schedule : [],
    finals: Array.isArray(raw.finals) ? raw.finals : [],
    settings: { quarterEnds: normalizeEnds(raw.settings?.quarterEnds) },
  };
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch {
    /* повреждённые данные или недоступное хранилище — начинаем с чистого состояния */
  }
  return defaultState();
}

export function save(state) {
  localStorage.setItem(KEY, JSON.stringify(state));
}

// ---------- Фото (IndexedDB) ----------

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => {
      db.close();
      resolve(req?.result);
    };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const putPhoto = (id, blob) => run('readwrite', (s) => s.put(blob, id));
export const getPhoto = (id) => run('readonly', (s) => s.get(id));
export const deletePhoto = (id) => run('readwrite', (s) => s.delete(id));
export const clearPhotos = () => run('readwrite', (s) => s.clear());

// Уменьшаем фото, чтобы не раздувать хранилище: до 1600 px по длинной стороне, JPEG.
export async function shrinkImage(file, maxSide = 1600, quality = 0.8) {
  const bitmap = await createImageBitmap(file);
  const k = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * k);
  canvas.height = Math.round(bitmap.height * k);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Не удалось обработать фото'))), 'image/jpeg', quality),
  );
}

const blobToDataUrl = (blob) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

// ---------- Резервная копия ----------

export async function exportAll(state) {
  const ids = new Set();
  for (const rec of [...state.tasks, ...state.grades, ...state.remarks]) {
    for (const id of rec.photoIds ?? []) ids.add(id);
  }
  const photos = {};
  for (const id of ids) {
    const blob = await getPhoto(id);
    if (blob) photos[id] = await blobToDataUrl(blob);
  }
  return JSON.stringify({ app: 'school-off', exportedAt: new Date().toISOString(), state, photos });
}

export async function importAll(text) {
  const data = JSON.parse(text);
  if (data?.app !== 'school-off' || !data.state) throw new Error('Это не файл резервной копии школьного помощника');
  const state = normalize(data.state);
  await clearPhotos();
  for (const [id, url] of Object.entries(data.photos ?? {})) {
    await putPhoto(id, await (await fetch(url)).blob());
  }
  return state;
}
