import { getStore } from '@netlify/blobs';
import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual, createHmac } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const store = getStore('textraw-arcade-data');
const SESSION_COOKIE = 'tr_session';
const SESSION_DAYS = 30;
const MAX_REQUEST = 5_500_000;
const MAX_GAME_CODE = 600_000;
const MAX_APP_BYTES = 3_500_000;
const STATE_KEYS = new Set(['trProjects', 'trLogic', 'trVariables']);

const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers }
});
const fail = (message, status = 400) => json({ error: message }, status);
const normalizeUsername = (s) => String(s || '').trim().toLowerCase();
const userKey = (username) => `user:${normalizeUsername(username)}`;
const sessionSecret = () => process.env.TEXTRAW_SESSION_SECRET || '';

async function readJSON(key) {
  try { return await store.get(key, { type: 'json' }); } catch { return null; }
}
async function parseBody(request) {
  const text = await request.text();
  if (text.length > MAX_REQUEST) throw new Error('Запрос слишком большой.');
  try { return text ? JSON.parse(text) : {}; } catch { throw new Error('Неверный формат запроса.'); }
}
function sign(value) {
  const secret = sessionSecret();
  if (!secret || secret.length < 32) throw new Error('В Netlify нужно один раз задать переменную TEXTRAW_SESSION_SECRET длиной не менее 32 символов.');
  return createHmac('sha256', secret).update(value).digest('base64url');
}
function makeSession(username) {
  const payload = Buffer.from(JSON.stringify({ u: username, exp: Date.now() + SESSION_DAYS * 86400000 })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}
async function currentUser(request) {
  const cookie = request.headers.get('cookie') || '';
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  if (!match || !sessionSecret()) return null;
  const token = decodeURIComponent(match[1]);
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.u || !Number.isFinite(data.exp) || data.exp < Date.now()) return null;
    const user = await readJSON(userKey(data.u));
    return user ? { username: user.username } : null;
  } catch { return null; }
}
function cookieHeader(request, token, clear = false) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${clear ? '' : encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=${clear ? 0 : SESSION_DAYS * 86400}`;
}
async function requireUser(request) {
  const user = await currentUser(request);
  return user;
}
function validName(value, max = 70) {
  const name = String(value || '').trim();
  return name.length > 0 && name.length <= max ? name : null;
}
async function listKeys(prefix) {
  const result = await store.list({ prefix });
  return (result.blobs || []).map(b => b.key);
}
async function listGames(user) {
  const keys = await listKeys('game:');
  const result = [];
  for (const key of keys) {
    const g = await readJSON(key);
    if (g && (g.published || (user && g.ownerUsername === user.username))) {
      result.push({ ...g, canEdit: !!user && g.ownerUsername === user.username });
    }
  }
  return result.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}
async function listApps(user) {
  const keys = await listKeys('app:');
  const result = [];
  for (const key of keys) {
    const a = await readJSON(key);
    if (a && (a.published || (user && a.ownerUsername === user.username))) {
      result.push({ ...a, canDelete: !!user && a.ownerUsername === user.username, official: false });
    }
  }
  return result.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

export default async (request) => {
  const url = new URL(request.url);
  const action = url.searchParams.get('action') || '';
  const method = request.method.toUpperCase();
  if (method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'access-control-allow-origin': url.origin, 'access-control-allow-credentials': 'true' } });
  try {
    if (action === 'auth/me' && method === 'GET') {
      const user = await currentUser(request);
      return json({ user });
    }
    if ((action === 'auth/register' || action === 'auth/login') && (!sessionSecret() || sessionSecret().length < 32)) return fail('В настройках Netlify добавь переменную TEXTRAW_SESSION_SECRET длиной не менее 32 символов.', 503);
    if (action === 'auth/register' && method === 'POST') {
      const body = await parseBody(request);
      const username = normalizeUsername(body.username);
      const password = String(body.password || '');
      if (!/^[a-z0-9_]{3,20}$/.test(username)) return fail('Имя пользователя: 3–20 символов, только латинские буквы, цифры и _.');
      if (password.length < 8 || password.length > 128) return fail('Пароль должен содержать от 8 до 128 символов.');
      if (await readJSON(userKey(username))) return fail('Это имя пользователя уже занято.', 409);
      const salt = randomBytes(16).toString('hex');
      const hash = (await scrypt(password, salt, 64)).toString('hex');
      const user = { username, salt, hash, createdAt: new Date().toISOString() };
      await store.set(userKey(username), JSON.stringify(user));
      const token = makeSession(username);
      return json({ user: { username } }, 201, { 'set-cookie': cookieHeader(request, token) });
    }
    if (action === 'auth/login' && method === 'POST') {
      const body = await parseBody(request);
      const username = normalizeUsername(body.username);
      const password = String(body.password || '');
      const user = await readJSON(userKey(username));
      if (!user || typeof user.salt !== 'string' || typeof user.hash !== 'string') return fail('Неверное имя пользователя или пароль.', 401);
      const hash = (await scrypt(password, user.salt, 64)).toString('hex');
      const a = Buffer.from(hash, 'hex'), b = Buffer.from(user.hash, 'hex');
      if (a.length !== b.length || !timingSafeEqual(a, b)) return fail('Неверное имя пользователя или пароль.', 401);
      return json({ user: { username: user.username } }, 200, { 'set-cookie': cookieHeader(request, makeSession(username)) });
    }
    if (action === 'auth/logout' && method === 'POST') return json({ ok: true }, 200, { 'set-cookie': cookieHeader(request, '', true) });

    if (action === 'state/load' && method === 'GET') {
      const user = await requireUser(request); if (!user) return fail('Сначала войди в аккаунт.', 401);
      const state = {};
      for (const key of STATE_KEYS) state[key] = await readJSON(`state:${user.username}:${key}`);
      return json({ state });
    }
    if (action === 'state/save' && method === 'POST') {
      const user = await requireUser(request); if (!user) return fail('Сначала войди в аккаунт.', 401);
      const body = await parseBody(request);
      if (!STATE_KEYS.has(body.key)) return fail('Недопустимый тип данных.');
      const value = JSON.stringify(body.value);
      if (value.length > 1_000_000) return fail('Проект слишком большой для сохранения.');
      await store.set(`state:${user.username}:${body.key}`, value);
      return json({ ok: true });
    }

    if (action === 'games/list' && method === 'GET') return json({ games: await listGames(await requireUser(request)) });
    if (action === 'games/publish' && method === 'POST') {
      const user = await requireUser(request); if (!user) return fail('Чтобы публиковать игры, войди в аккаунт.', 401);
      const body = await parseBody(request);
      const name = validName(body.name); if (!name) return fail('Укажи название игры.');
      const code = String(body.code || ''); if (!code || code.length > MAX_GAME_CODE) return fail('HTML-код пустой или слишком большой (максимум 600 КБ).');
      let id = String(body.id || '');
      let previous = null;
      if (id) {
        previous = await readJSON(`game:${id}`);
        if (!previous || previous.ownerUsername !== user.username) return fail('Нельзя изменять чужую игру.', 403);
      } else id = randomUUID();
      const game = { id, name, desc: String(body.desc || '').slice(0, 500), code, emoji: String(body.emoji || '🧩').slice(0, 8), kind: 'user', published: true, ownerUsername: user.username, createdAt: previous?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
      await store.set(`game:${id}`, JSON.stringify(game));
      return json({ game: { ...game, canEdit: true } }, 201);
    }
    if (action === 'games/delete' && method === 'POST') {
      const user = await requireUser(request); if (!user) return fail('Войди в аккаунт.', 401);
      const body = await parseBody(request), key = `game:${String(body.id || '')}`, game = await readJSON(key);
      if (!game) return fail('Игра не найдена.', 404);
      if (game.ownerUsername !== user.username) return fail('Нельзя удалить чужую игру.', 403);
      await store.delete(key); return json({ ok: true });
    }

    if (action === 'apps/list' && method === 'GET') return json({ apps: await listApps(await requireUser(request)) });
    if (action === 'apps/publish' && method === 'POST') {
      const user = await requireUser(request); if (!user) return fail('Чтобы публиковать приложения, войди в аккаунт.', 401);
      const body = await parseBody(request);
      const name = validName(body.name); if (!name) return fail('Укажи название приложения.');
      const fileName = validName(body.fileName, 180); if (!fileName) return fail('Некорректное имя файла.');
      const base64 = String(body.fileBase64 || '');
      if (!base64) return fail('Файл пустой.');
      const bytes = Buffer.from(base64, 'base64');
      if (bytes.length > MAX_APP_BYTES) return fail('Максимальный размер файла — 3,5 МБ.');
      const id = randomUUID();
      await store.set(`appfile:${id}`, new Uint8Array(bytes), { metadata: { fileName } });
      const app = { id, name, desc: String(body.desc || '').slice(0, 1000), author: user.username, fileName, size: bytes.length, mimeType: String(body.mimeType || 'application/octet-stream').slice(0, 120), official: false, published: true, ownerUsername: user.username, createdAt: new Date().toISOString() };
      await store.set(`app:${id}`, JSON.stringify(app));
      return json({ app: { ...app, canDelete: true } }, 201);
    }
    if (action === 'apps/delete' && method === 'POST') {
      const user = await requireUser(request); if (!user) return fail('Войди в аккаунт.', 401);
      const body = await parseBody(request), id = String(body.id || ''), key = `app:${id}`, app = await readJSON(key);
      if (!app) return fail('Приложение не найдено.', 404);
      if (app.ownerUsername !== user.username) return fail('Нельзя удалить чужое приложение.', 403);
      await store.delete(key); await store.delete(`appfile:${id}`); return json({ ok: true });
    }
    if (action === 'apps/download' && method === 'GET') {
      const id = String(url.searchParams.get('id') || ''), app = await readJSON(`app:${id}`);
      if (!app) return fail('Файл не найден.', 404);
      const user = await requireUser(request);
      if (!app.published && (!user || user.username !== app.ownerUsername)) return fail('Нет доступа.', 403);
      const bytes = await store.get(`appfile:${id}`, { type: 'arrayBuffer' });
      if (!bytes) return fail('Файл отсутствует в хранилище.', 404);
      const encodedFileName = encodeURIComponent(app.fileName).replace(/'/g, '%27');
      return new Response(bytes, { status: 200, headers: { 'content-type': app.mimeType || 'application/octet-stream', 'content-disposition': `attachment; filename="download"; filename*=UTF-8''${encodedFileName}`,  'content-length': String(bytes.byteLength), 'cache-control': 'public, max-age=300' } });
    }
    return fail('Неизвестный запрос.', 404);
  } catch (error) {
    const message = String(error?.message || error || 'Неизвестная ошибка');
    console.error('TEXTRAW API:', message);
    return fail(message.includes('TEXTRAW_SESSION_SECRET') ? message : 'Ошибка сервера. Проверь настройки Netlify и попробуй ещё раз.', message.includes('TEXTRAW_SESSION_SECRET') ? 503 : 500);
  }
};
