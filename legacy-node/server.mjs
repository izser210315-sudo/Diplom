import http from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, scryptSync, timingSafeEqual, createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const PORT = Number(process.env.PORT || 4173);
const SESSION_TTL = 1000 * 60 * 60 * 24 * 7;

await mkdir(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, "diplom.db"));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user','admin')),
    bio TEXT NOT NULL DEFAULT '',
    theme TEXT NOT NULL DEFAULT 'dark' CHECK(theme IN ('dark','light')),
    accent TEXT NOT NULL DEFAULT 'violet' CHECK(accent IN ('violet','cyan','amber')),
    density TEXT NOT NULL DEFAULT 'comfortable' CHECK(density IN ('comfortable','compact')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    csrf_token TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sender_role TEXT NOT NULL CHECK(sender_role IN ('user','admin')),
    body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    read_at TEXT
  );
  CREATE TABLE IF NOT EXISTS visits (
    id INTEGER PRIMARY KEY,
    visitor_hash TEXT NOT NULL,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    pathname TEXT NOT NULL,
    referrer TEXT NOT NULL DEFAULT '',
    visited_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_messages_user_created ON messages(user_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_visits_date ON visits(visited_at);
  CREATE INDEX IF NOT EXISTS idx_visits_user ON visits(user_id);
  PRAGMA optimize;
`);

function passwordHash(password, salt = randomBytes(16).toString("hex")) {
  const digest = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${digest}`;
}

function passwordMatches(password, stored) {
  const [salt, digest] = stored.split(":");
  if (!salt || !digest) return false;
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(digest, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function seedUser(name, email, password, role) {
  const found = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
  if (!found) {
    db.prepare("INSERT INTO users (name, email, password_hash, role, bio) VALUES (?, ?, ?, ?, ?)")
      .run(name, email, passwordHash(password), role, role === "admin" ? "Администратор платформы" : "Начинающий 3D-художник");
  }
}

seedUser("Администратор", "admin@formspace.local", process.env.ADMIN_PASSWORD || "Admin123!", "admin");
seedUser("Алексей Морозов", "user@formspace.local", process.env.DEMO_PASSWORD || "User123!", "user");

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8"
};

function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || "").split(";").filter(Boolean).map(v => {
    const i = v.indexOf("=");
    return [v.slice(0, i).trim(), decodeURIComponent(v.slice(i + 1))];
  }));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function currentSession(req) {
  const token = parseCookies(req).session;
  if (!token) return null;
  const row = db.prepare(`
    SELECT s.token_hash, s.csrf_token, s.expires_at,
           u.id, u.name, u.email, u.role, u.bio, u.theme, u.accent, u.density, u.created_at
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?
  `).get(sha256(token), Date.now());
  return row || null;
}

function safeUser(row) {
  if (!row) return null;
  return {
    id: row.id, name: row.name, email: row.email, role: row.role, bio: row.bio,
    theme: row.theme, accent: row.accent, density: row.density, createdAt: row.created_at
  };
}

function sendJson(res, status, data, headers = {}) {
  res.writeHead(status, { "Content-Type": mime[".json"], "Cache-Control": "no-store", ...headers });
  res.end(JSON.stringify(data));
}

async function bodyJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 100_000) throw Object.assign(new Error("Слишком большой запрос"), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); }
  catch { throw Object.assign(new Error("Некорректный JSON"), { status: 400 }); }
}

function assertSameOrigin(req) {
  const origin = req.headers.origin;
  if (origin && origin !== `http://${req.headers.host}` && origin !== `https://${req.headers.host}`) {
    throw Object.assign(new Error("Запрос с другого источника запрещён"), { status: 403 });
  }
}

function requireUser(req, role) {
  const session = currentSession(req);
  if (!session) throw Object.assign(new Error("Требуется вход"), { status: 401 });
  if (role && session.role !== role) throw Object.assign(new Error("Недостаточно прав"), { status: 403 });
  return session;
}

function requireCsrf(req, session) {
  if (req.headers["x-csrf-token"] !== session.csrf_token) {
    throw Object.assign(new Error("Сессия устарела. Обновите страницу."), { status: 403 });
  }
}

function sessionCookie(value, maxAge = 604800) {
  return `session=${encodeURIComponent(value)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

function newSession(userId) {
  const token = randomBytes(32).toString("base64url");
  const csrf = randomBytes(24).toString("base64url");
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(Date.now());
  db.prepare("INSERT INTO sessions (token_hash, user_id, csrf_token, expires_at) VALUES (?, ?, ?, ?)")
    .run(sha256(token), userId, csrf, Date.now() + SESSION_TTL);
  return { token, csrf };
}

async function api(req, res, url) {
  const key = `${req.method} ${url.pathname}`;
  if (req.method !== "GET") assertSameOrigin(req);

  if (key === "GET /api/me") {
    const session = currentSession(req);
    return sendJson(res, 200, { user: safeUser(session), csrfToken: session?.csrf_token || null });
  }

  if (key === "POST /api/register") {
    const { name = "", email = "", password = "" } = await bodyJson(req);
    const cleanName = String(name).trim().slice(0, 80);
    const cleanEmail = String(email).trim().toLowerCase();
    if (cleanName.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail) || String(password).length < 8) {
      return sendJson(res, 400, { error: "Проверьте имя, email и пароль (не менее 8 символов)." });
    }
    try {
      const result = db.prepare("INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)")
        .run(cleanName, cleanEmail, passwordHash(String(password)));
      const created = newSession(Number(result.lastInsertRowid));
      return sendJson(res, 201, { ok: true }, { "Set-Cookie": sessionCookie(created.token) });
    } catch (error) {
      if (String(error).includes("UNIQUE")) return sendJson(res, 409, { error: "Этот email уже зарегистрирован." });
      throw error;
    }
  }

  if (key === "POST /api/login") {
    const { email = "", password = "" } = await bodyJson(req);
    const user = db.prepare("SELECT * FROM users WHERE email = ?").get(String(email).trim().toLowerCase());
    if (!user || !passwordMatches(String(password), user.password_hash)) {
      return sendJson(res, 401, { error: "Неверный email или пароль." });
    }
    const created = newSession(user.id);
    return sendJson(res, 200, { user: safeUser(user) }, { "Set-Cookie": sessionCookie(created.token) });
  }

  if (key === "POST /api/logout") {
    const session = requireUser(req); requireCsrf(req, session);
    db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(session.token_hash);
    return sendJson(res, 200, { ok: true }, { "Set-Cookie": sessionCookie("", 0) });
  }

  if (key === "PATCH /api/profile") {
    const session = requireUser(req); requireCsrf(req, session);
    const body = await bodyJson(req);
    const name = String(body.name ?? session.name).trim().slice(0, 80);
    const bio = String(body.bio ?? session.bio).trim().slice(0, 280);
    const theme = ["dark", "light"].includes(body.theme) ? body.theme : session.theme;
    const accent = ["violet", "cyan", "amber"].includes(body.accent) ? body.accent : session.accent;
    const density = ["comfortable", "compact"].includes(body.density) ? body.density : session.density;
    if (name.length < 2) return sendJson(res, 400, { error: "Имя слишком короткое." });
    db.prepare("UPDATE users SET name = ?, bio = ?, theme = ?, accent = ?, density = ? WHERE id = ?")
      .run(name, bio, theme, accent, density, session.id);
    return sendJson(res, 200, { user: safeUser({ ...session, name, bio, theme, accent, density }) });
  }

  if (key === "GET /api/messages") {
    const session = requireUser(req);
    const requested = Number(url.searchParams.get("userId"));
    const userId = session.role === "admin" && requested ? requested : session.id;
    if (session.role !== "admin" && userId !== session.id) return sendJson(res, 403, { error: "Недостаточно прав" });
    const items = db.prepare("SELECT id, user_id AS userId, sender_role AS senderRole, body, created_at AS createdAt FROM messages WHERE user_id = ? ORDER BY id").all(userId);
    if (session.role === "admin") db.prepare("UPDATE messages SET read_at = CURRENT_TIMESTAMP WHERE user_id = ? AND sender_role = 'user' AND read_at IS NULL").run(userId);
    else db.prepare("UPDATE messages SET read_at = CURRENT_TIMESTAMP WHERE user_id = ? AND sender_role = 'admin' AND read_at IS NULL").run(userId);
    return sendJson(res, 200, { messages: items });
  }

  if (key === "POST /api/messages") {
    const session = requireUser(req); requireCsrf(req, session);
    const body = await bodyJson(req);
    const text = String(body.message || "").trim().slice(0, 2000);
    const userId = session.role === "admin" ? Number(body.userId) : session.id;
    if (!text) return sendJson(res, 400, { error: "Введите сообщение." });
    if (!userId || !db.prepare("SELECT id FROM users WHERE id = ? AND role = 'user'").get(userId)) {
      return sendJson(res, 404, { error: "Пользователь не найден." });
    }
    const result = db.prepare("INSERT INTO messages (user_id, sender_role, body) VALUES (?, ?, ?)")
      .run(userId, session.role === "admin" ? "admin" : "user", text);
    return sendJson(res, 201, { id: Number(result.lastInsertRowid) });
  }

  if (key === "POST /api/visit") {
    const session = currentSession(req);
    const body = await bodyJson(req);
    let visitor = parseCookies(req).visitor;
    if (!visitor) visitor = randomBytes(18).toString("base64url");
    const pathname = String(body.pathname || "/").slice(0, 200);
    const referrer = String(body.referrer || "").slice(0, 300);
    db.prepare("INSERT INTO visits (visitor_hash, user_id, pathname, referrer) VALUES (?, ?, ?, ?)")
      .run(sha256(visitor), session?.id || null, pathname, referrer);
    return sendJson(res, 201, { ok: true }, { "Set-Cookie": `visitor=${visitor}; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000` });
  }

  if (key === "GET /api/admin/users") {
    requireUser(req, "admin");
    const users = db.prepare(`
      SELECT u.id, u.name, u.email, u.role, u.created_at AS createdAt,
             COUNT(m.id) AS messageCount,
             SUM(CASE WHEN m.sender_role = 'user' AND m.read_at IS NULL THEN 1 ELSE 0 END) AS unreadCount
      FROM users u LEFT JOIN messages m ON m.user_id = u.id
      GROUP BY u.id ORDER BY u.created_at DESC
    `).all();
    return sendJson(res, 200, { users });
  }

  if (key === "GET /api/admin/analytics") {
    requireUser(req, "admin");
    const totals = db.prepare(`
      SELECT COUNT(*) AS views, COUNT(DISTINCT visitor_hash) AS visitors,
             COUNT(DISTINCT CASE WHEN user_id IS NOT NULL THEN user_id END) AS signedInUsers
      FROM visits
    `).get();
    const daily = db.prepare(`
      WITH RECURSIVE dates(day) AS (
        SELECT date('now', '-6 days') UNION ALL SELECT date(day, '+1 day') FROM dates WHERE day < date('now')
      )
      SELECT dates.day, COUNT(visits.id) AS views, COUNT(DISTINCT visits.visitor_hash) AS visitors
      FROM dates LEFT JOIN visits ON date(visits.visited_at) = dates.day GROUP BY dates.day ORDER BY dates.day
    `).all();
    const pages = db.prepare("SELECT pathname, COUNT(*) AS views FROM visits GROUP BY pathname ORDER BY views DESC LIMIT 6").all();
    const unread = db.prepare("SELECT COUNT(*) AS count FROM messages WHERE sender_role = 'user' AND read_at IS NULL").get();
    return sendJson(res, 200, { totals, daily, pages, unreadMessages: unread.count });
  }

  return sendJson(res, 404, { error: "API-метод не найден" });
}

const routes = {
  "/": "index.html",
  "/login": "login.html",
  "/cabinet": "dashboard.html",
  "/admin": "admin.html"
};

async function serveStatic(req, res, url) {
  const rel = routes[url.pathname] || url.pathname.replace(/^\//, "");
  const filePath = path.resolve(PUBLIC_DIR, rel);
  if (!filePath.startsWith(PUBLIC_DIR + path.sep) && filePath !== PUBLIC_DIR) return sendJson(res, 403, { error: "Запрещено" });
  try {
    const data = await readFile(filePath);
    const type = mime[path.extname(filePath)] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type, "Cache-Control": type.includes("html") ? "no-cache" : "public, max-age=3600" });
    res.end(data);
  } catch {
    const data = await readFile(path.join(PUBLIC_DIR, "404.html"));
    res.writeHead(404, { "Content-Type": mime[".html"] });
    res.end(data);
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  try {
    if (url.pathname.startsWith("/api/")) await api(req, res, url);
    else if (req.method === "GET" || req.method === "HEAD") await serveStatic(req, res, url);
    else sendJson(res, 405, { error: "Метод не поддерживается" });
  } catch (error) {
    console.error(error);
    sendJson(res, error.status || 500, { error: error.status ? error.message : "Внутренняя ошибка сервера" });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`FormSpace: http://127.0.0.1:${PORT}`);
});
