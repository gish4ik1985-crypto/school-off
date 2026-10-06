// Вызов Claude API прямо из браузера. Ключ родитель вводит сам и он хранится ТОЛЬКО в localStorage этого браузера:
// в репозиторий, в резервную копию и на чужие серверы он не попадает (запросы идут только на api.anthropic.com).
// Намеренно не используем SDK с CDN: так ключ не получает ничей посторонний код.

const KEY = 'school-off:ai';
const ENDPOINT = 'https://api.anthropic.com/v1/messages';

export const MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 — самый точный (рекомендуется)', hint: '≈ $4 / $20 за миллион токенов' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 — быстрее и дешевле', hint: '≈ $2 / $10 за миллион токенов' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 — самый дешёвый, хуже читает почерк', hint: '≈ $1 / $5 за миллион токенов' },
];
// Автоматическое переключение на запасную модель при отказе по политике безопасности
const FALLBACK_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5'];

export function getSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { apiKey: typeof s.apiKey === 'string' ? s.apiKey : '', model: MODELS.some((m) => m.id === s.model) ? s.model : MODELS[0].id };
  } catch {
    return { apiKey: '', model: MODELS[0].id };
  }
}

export function saveSettings({ apiKey, model }) {
  localStorage.setItem(KEY, JSON.stringify({ apiKey: apiKey.trim(), model }));
}

export function clearSettings() {
  localStorage.removeItem(KEY);
}

export const hasKey = () => getSettings().apiKey.length > 0;

export class AiError extends Error {}

function describeHttp(status, body) {
  const msg = body?.error?.message ? ` (${body.error.message})` : '';
  if (status === 401 || status === 403) return 'Ключ не подошёл. Проверьте ключ API в настройках.';
  if (status === 429) return 'Превышен лимит запросов или бюджет ключа. Подождите немного и попробуйте снова.';
  if (status === 529 || status >= 500) return 'Сервис Claude сейчас перегружен. Попробуйте через минуту.';
  return `Запрос отклонён (${status})${msg}`;
}

async function post(body, settings, withFallback) {
  const headers = {
    'content-type': 'application/json',
    'x-api-key': settings.apiKey,
    'anthropic-version': '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true', // обязательно для вызова из браузера
  };
  if (withFallback) {
    headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
    body = { ...body, fallbacks: 'default' };
  }
  let res;
  try {
    res = await fetch(ENDPOINT, { method: 'POST', headers, body: JSON.stringify(body) });
  } catch {
    throw new AiError('Не удалось связаться с сервисом Claude. Проверьте интернет.');
  }
  const json = await res.json().catch(() => null);
  return { res, json };
}

// system/user — строки; images — массив Blob (JPEG/PNG); schema — JSON-схема ответа. Возвращает разобранный JSON.
export async function ask({ system, user, images = [], schema }) {
  const settings = getSettings();
  if (!settings.apiKey) throw new AiError('Сначала введите ключ API в настройках (⚙️ → ИИ-помощник).');

  const content = [];
  for (const blob of images) {
    content.push({ type: 'image', source: { type: 'base64', media_type: blob.type || 'image/jpeg', data: await toBase64(blob) } });
  }
  content.push({ type: 'text', text: user });

  const body = {
    model: settings.model,
    max_tokens: 16000,
    system,
    messages: [{ role: 'user', content }],
    output_config: { format: { type: 'json_schema', schema } },
  };

  const useFallback = FALLBACK_MODELS.includes(settings.model);
  let { res, json } = await post(body, settings, useFallback);
  // если сервис не принял параметр запасной модели — повторяем без него
  if (res.status === 400 && useFallback) ({ res, json } = await post(body, settings, false));
  if (!res.ok) throw new AiError(describeHttp(res.status, json));

  if (json.stop_reason === 'refusal') throw new AiError('Модель отказалась обработать этот запрос. Попробуйте другое фото или формулировку.');
  if (json.stop_reason === 'max_tokens') throw new AiError('Ответ получился слишком длинным и оборвался. Попробуйте меньше заданий или одну страницу.');
  const text = (json.content ?? []).find((b) => b.type === 'text')?.text;
  try {
    return JSON.parse(text);
  } catch {
    throw new AiError('Не удалось разобрать ответ модели. Попробуйте ещё раз.');
  }
}

// Дешёвая проверка ключа: крошечный запрос
export async function checkKey(apiKey, model) {
  const { res, json } = await post(
    { model, max_tokens: 16, messages: [{ role: 'user', content: 'Ответь одним словом: ок' }] },
    { apiKey: apiKey.trim() },
    false,
  );
  if (!res.ok) throw new AiError(describeHttp(res.status, json));
  return true;
}

function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
