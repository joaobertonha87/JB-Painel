import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import pg from "pg";
import webpush from "web-push";

const { Pool } = pg;
const app = express();
const port = Number(process.env.PORT || 3000);
const root = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(root, "public");
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
});
pool.on("connect", (client) => {
  void client.query("SET TIME ZONE 'America/Sao_Paulo'");
});
const appPassword = process.env.APP_PASSWORD || "admin";
const sessionSecret = process.env.SESSION_SECRET || "development-secret-change-me";
const pushReady = Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);

if (pushReady) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:admin@example.com",
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY,
  );
}

if (process.env.NODE_ENV === "production" && !process.env.APP_PASSWORD) {
  throw new Error("Configure APP_PASSWORD no Render antes de iniciar.");
}

app.set("trust proxy", 1);
app.use(express.json({ limit: "100kb" }));
app.use(express.static(publicDir, { index: false, maxAge: "1h" }));

function parseCookies(request) {
  return Object.fromEntries((request.headers.cookie || "").split(";").filter(Boolean).map((part) => {
    const index = part.indexOf("=");
    return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1))];
  }));
}

function sign(value) {
  return crypto.createHmac("sha256", sessionSecret).update(value).digest("base64url");
}

function createSession() {
  const expires = Date.now() + 30 * 24 * 60 * 60 * 1000;
  const payload = `${expires}`;
  return `${payload}.${sign(payload)}`;
}

function isAuthenticated(request) {
  const token = parseCookies(request).painel_session;
  if (!token) return false;
  const [expires, signature] = token.split(".");
  if (!expires || !signature || Number(expires) < Date.now()) return false;
  const expected = sign(expires);
  if (signature.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

function requireAuth(request, response, next) {
  if (!isAuthenticated(request)) return response.status(401).json({ error: "Sessão expirada." });
  next();
}

function safeEqual(value, expected) {
  const a = Buffer.from(String(value));
  const b = Buffer.from(String(expected));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS items (
      id BIGSERIAL PRIMARY KEY,
      category TEXT NOT NULL CHECK (category IN ('agenda','student','content','app')),
      title TEXT NOT NULL,
      details TEXT NOT NULL DEFAULT '',
      event_date DATE,
      event_time TIME,
      status TEXT NOT NULL DEFAULT 'pending',
      url TEXT,
      reminder_minutes INTEGER,
      notification_sent BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_items_category ON items(category);
    CREATE INDEX IF NOT EXISTS idx_items_agenda_date ON items(category, event_date, event_time);
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id BIGSERIAL PRIMARY KEY,
      endpoint TEXT UNIQUE NOT NULL,
      subscription JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

app.get("/health", (_request, response) => response.json({ ok: true }));

app.post("/api/login", (request, response) => {
  if (!safeEqual(request.body?.password || "", appPassword)) {
    return response.status(401).json({ error: "Senha incorreta." });
  }
  response.cookie("painel_session", createSession(), {
    httpOnly: true, secure: process.env.NODE_ENV === "production",
    sameSite: "strict", maxAge: 30 * 24 * 60 * 60 * 1000, path: "/",
  });
  response.json({ ok: true });
});

app.post("/api/logout", (_request, response) => {
  response.clearCookie("painel_session", { path: "/" });
  response.json({ ok: true });
});

app.get("/api/session", (request, response) => response.json({ authenticated: isAuthenticated(request) }));

app.get("/api/items", requireAuth, async (_request, response, next) => {
  try {
    const result = await pool.query(`
      SELECT id, category, title, details, event_date AS date,
             LEFT(event_time::text, 5) AS time, status, url,
             reminder_minutes AS "reminderMinutes", created_at AS "createdAt"
      FROM items ORDER BY event_date NULLS LAST, event_time NULLS LAST, id DESC
    `);
    response.json({ items: result.rows });
  } catch (error) { next(error); }
});

app.post("/api/items", requireAuth, async (request, response, next) => {
  try {
    const { category, title, details = "", date = null, time = null, status = "pending", url = null, reminderMinutes = null } = request.body || {};
    if (!["agenda", "student", "content", "app"].includes(category) || !String(title || "").trim()) {
      return response.status(400).json({ error: "Preencha os campos obrigatórios." });
    }
    const result = await pool.query(`
      INSERT INTO items (category, title, details, event_date, event_time, status, url, reminder_minutes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING id, category, title, details, event_date AS date,
                LEFT(event_time::text, 5) AS time, status, url,
                reminder_minutes AS "reminderMinutes", created_at AS "createdAt"
    `, [category, String(title).trim(), String(details).trim(), date || null, time || null, status, url || null, reminderMinutes || null]);
    response.status(201).json({ item: result.rows[0] });
  } catch (error) { next(error); }
});

app.patch("/api/items/:id", requireAuth, async (request, response, next) => {
  try {
    const id = Number(request.params.id);
    if (!Number.isInteger(id)) return response.status(400).json({ error: "Registro inválido." });
    const existing = await pool.query("SELECT * FROM items WHERE id = $1", [id]);
    if (!existing.rowCount) return response.status(404).json({ error: "Registro não encontrado." });
    const old = existing.rows[0];
    const body = request.body || {};
    const result = await pool.query(`
      UPDATE items SET title=$1, details=$2, event_date=$3, event_time=$4,
        status=$5, url=$6, reminder_minutes=$7,
        notification_sent=CASE WHEN event_date IS DISTINCT FROM $3 OR event_time IS DISTINCT FROM $4 OR reminder_minutes IS DISTINCT FROM $7 THEN FALSE ELSE notification_sent END
      WHERE id=$8
      RETURNING id, category, title, details, event_date AS date,
        LEFT(event_time::text, 5) AS time, status, url,
        reminder_minutes AS "reminderMinutes", created_at AS "createdAt"
    `, [
      body.title ?? old.title, body.details ?? old.details, body.date ?? old.event_date,
      body.time ?? old.event_time, body.status ?? old.status, body.url ?? old.url,
      body.reminderMinutes ?? old.reminder_minutes, id,
    ]);
    response.json({ item: result.rows[0] });
  } catch (error) { next(error); }
});

app.delete("/api/items/:id", requireAuth, async (request, response, next) => {
  try {
    await pool.query("DELETE FROM items WHERE id=$1", [Number(request.params.id)]);
    response.json({ ok: true });
  } catch (error) { next(error); }
});

app.get("/api/push/key", requireAuth, (_request, response) => {
  response.json({ publicKey: process.env.VAPID_PUBLIC_KEY || null });
});

app.post("/api/push/subscribe", requireAuth, async (request, response, next) => {
  try {
    if (!pushReady) return response.status(503).json({ error: "Notificações ainda não configuradas no Render." });
    const subscription = request.body;
    if (!subscription?.endpoint) return response.status(400).json({ error: "Assinatura inválida." });
    await pool.query(`
      INSERT INTO push_subscriptions (endpoint, subscription) VALUES ($1,$2)
      ON CONFLICT (endpoint) DO UPDATE SET subscription=EXCLUDED.subscription
    `, [subscription.endpoint, subscription]);
    response.json({ ok: true });
  } catch (error) { next(error); }
});

app.get("/", (request, response) => {
  response.sendFile(path.join(publicDir, isAuthenticated(request) ? "index.html" : "login.html"));
});

app.use((error, _request, response, _next) => {
  console.error(error);
  response.status(500).json({ error: "Não foi possível concluir esta ação." });
});

async function sendDueReminders() {
  if (!pushReady) return;
  const due = await pool.query(`
    SELECT * FROM items
    WHERE category='agenda' AND status <> 'done' AND notification_sent=FALSE
      AND event_date IS NOT NULL AND event_time IS NOT NULL AND reminder_minutes IS NOT NULL
      AND (event_date + event_time - (reminder_minutes || ' minutes')::interval) <= NOW()
      AND (event_date + event_time) >= NOW() - interval '30 minutes'
  `);
  if (!due.rowCount) return;
  const subscriptions = await pool.query("SELECT id, subscription FROM push_subscriptions");
  for (const item of due.rows) {
    const payload = JSON.stringify({ title: item.title, body: item.details || `Compromisso às ${String(item.event_time).slice(0,5)}`, url: "/" });
    for (const row of subscriptions.rows) {
      try { await webpush.sendNotification(row.subscription, payload); }
      catch (error) {
        if (error?.statusCode === 404 || error?.statusCode === 410) await pool.query("DELETE FROM push_subscriptions WHERE id=$1", [row.id]);
      }
    }
    await pool.query("UPDATE items SET notification_sent=TRUE WHERE id=$1", [item.id]);
  }
}

initializeDatabase()
  .then(() => {
    app.listen(port, () => console.log(`Meu Painel JB ativo na porta ${port}`));
    setInterval(() => sendDueReminders().catch(console.error), 60_000);
  })
  .catch((error) => {
    console.error("Falha ao iniciar o banco de dados", error);
    process.exit(1);
  });
