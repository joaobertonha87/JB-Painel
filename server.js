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
      student_type TEXT,
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
    CREATE TABLE IF NOT EXISTS classes (
      id BIGSERIAL PRIMARY KEY,
      class_type TEXT NOT NULL DEFAULT 'particular' CHECK (class_type IN ('particular','school')),
      weekday SMALLINT NOT NULL CHECK (weekday BETWEEN 0 AND 6),
      class_time TIME NOT NULL,
      capacity SMALLINT NOT NULL DEFAULT 4 CHECK (capacity IN (4,6)),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS class_students (
      class_id BIGINT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      student_id BIGINT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (class_id, student_id)
    );
    CREATE INDEX IF NOT EXISTS idx_classes_schedule ON classes(weekday, class_time);
    CREATE INDEX IF NOT EXISTS idx_class_students_student ON class_students(student_id);
    ALTER TABLE items ADD COLUMN IF NOT EXISTS student_type TEXT;
    UPDATE items SET student_type='particular'
      WHERE category='student' AND student_type IS NULL;
    ALTER TABLE classes ADD COLUMN IF NOT EXISTS class_type TEXT NOT NULL DEFAULT 'particular';
    ALTER TABLE classes DROP CONSTRAINT IF EXISTS classes_weekday_class_time_key;
    ALTER TABLE classes DROP CONSTRAINT IF EXISTS classes_capacity_check;
    UPDATE classes SET capacity=CASE WHEN class_type='school' THEN 6 ELSE 4 END;
    ALTER TABLE classes ADD CONSTRAINT classes_capacity_check CHECK (capacity IN (4,6));
    CREATE UNIQUE INDEX IF NOT EXISTS idx_classes_type_schedule_unique
      ON classes(class_type, weekday, class_time);
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
             reminder_minutes AS "reminderMinutes", student_type AS "studentType",
             created_at AS "createdAt"
      FROM items ORDER BY event_date NULLS LAST, event_time NULLS LAST, id DESC
    `);
    response.json({ items: result.rows });
  } catch (error) { next(error); }
});

app.post("/api/items", requireAuth, async (request, response, next) => {
  try {
    const { category, title, details = "", date = null, time = null, status = "pending", url = null, reminderMinutes = null, studentType = null } = request.body || {};
    if (!["agenda", "student", "content", "app"].includes(category) || !String(title || "").trim()) {
      return response.status(400).json({ error: "Preencha os campos obrigatórios." });
    }
    const normalizedStudentType = category === "student" ? String(studentType || "particular") : null;
    if (category === "student" && !["particular", "school"].includes(normalizedStudentType)) {
      return response.status(400).json({ error: "Selecione uma modalidade válida." });
    }
    const result = await pool.query(`
      INSERT INTO items (category, title, details, event_date, event_time, status, url, reminder_minutes, student_type)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING id, category, title, details, event_date AS date,
                LEFT(event_time::text, 5) AS time, status, url,
                reminder_minutes AS "reminderMinutes", student_type AS "studentType",
                created_at AS "createdAt"
    `, [category, String(title).trim(), String(details).trim(), date || null, time || null, status, url || null, reminderMinutes || null, normalizedStudentType]);
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
        status=$5, url=$6, reminder_minutes=$7, student_type=$8,
        notification_sent=CASE WHEN event_date IS DISTINCT FROM $3 OR event_time IS DISTINCT FROM $4 OR reminder_minutes IS DISTINCT FROM $7 THEN FALSE ELSE notification_sent END
      WHERE id=$9
      RETURNING id, category, title, details, event_date AS date,
        LEFT(event_time::text, 5) AS time, status, url,
        reminder_minutes AS "reminderMinutes", student_type AS "studentType",
        created_at AS "createdAt"
    `, [
      body.title ?? old.title, body.details ?? old.details, body.date ?? old.event_date,
      body.time ?? old.event_time, body.status ?? old.status, body.url ?? old.url,
      body.reminderMinutes ?? old.reminder_minutes,
      old.category === "student" && ["particular", "school"].includes(body.studentType) ? body.studentType : old.student_type,
      id,
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

function classPayload(body = {}) {
  const classType = String(body.classType || "particular");
  const capacity = classType === "school" ? 6 : 4;
  const durationMinutes = classType === "school" ? 35 : 60;
  const weekday = Number(body.weekday);
  const time = String(body.time || "");
  const rawStudentIds = Array.isArray(body.studentIds) ? body.studentIds : [];
  const normalizedStudentIds = rawStudentIds.map(Number);
  if (normalizedStudentIds.some((id) => !Number.isInteger(id) || id <= 0)) {
    return { error: "A seleção de alunos é inválida." };
  }
  const studentIds = [...new Set(normalizedStudentIds)];
  if (!["particular", "school"].includes(classType)) return { error: "Selecione uma modalidade válida." };
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6 || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    return { error: "Informe um dia e horário válidos." };
  }
  if (studentIds.length > capacity) return { error: `Esta modalidade permite no máximo ${capacity} alunos.` };
  return { classType, capacity, durationMinutes, weekday, time, studentIds };
}

async function validateStudents(client, studentIds, classType) {
  if (!studentIds.length) return true;
  const result = await client.query(
    "SELECT COUNT(*)::int AS count FROM items WHERE category='student' AND student_type=$2 AND id = ANY($1::bigint[])",
    [studentIds, classType],
  );
  return result.rows[0].count === studentIds.length;
}

async function findScheduleConflict(client, payload, excludedId = null) {
  await client.query("SELECT pg_advisory_xact_lock($1)", [1000 + payload.weekday]);
  const result = await client.query(`
    SELECT id, class_type AS "classType", LEFT(class_time::text, 5) AS time
    FROM classes
    WHERE weekday=$1
      AND id <> COALESCE($4::bigint, -1)
      AND (EXTRACT(HOUR FROM class_time) * 3600 + EXTRACT(MINUTE FROM class_time) * 60)
        < (EXTRACT(HOUR FROM $2::time) * 3600 + EXTRACT(MINUTE FROM $2::time) * 60) + ($3 * 60)
      AND (EXTRACT(HOUR FROM $2::time) * 3600 + EXTRACT(MINUTE FROM $2::time) * 60)
        < (EXTRACT(HOUR FROM class_time) * 3600 + EXTRACT(MINUTE FROM class_time) * 60)
          + (CASE WHEN class_type='school' THEN 35 ELSE 60 END) * 60
    LIMIT 1
  `, [payload.weekday, payload.time, payload.durationMinutes, excludedId]);
  return result.rows[0] || null;
}

app.get("/api/classes", requireAuth, async (_request, response, next) => {
  try {
    const result = await pool.query(`
      SELECT c.id, c.class_type AS "classType", c.weekday, LEFT(c.class_time::text, 5) AS time, c.capacity,
        COALESCE(
          json_agg(json_build_object('id', i.id, 'name', i.title) ORDER BY i.title)
            FILTER (WHERE i.id IS NOT NULL),
          '[]'::json
        ) AS students
      FROM classes c
      LEFT JOIN class_students cs ON cs.class_id = c.id
      LEFT JOIN items i ON i.id = cs.student_id AND i.category = 'student'
      GROUP BY c.id
      ORDER BY c.weekday, c.class_time
    `);
    response.json({ classes: result.rows });
  } catch (error) { next(error); }
});

app.post("/api/classes", requireAuth, async (request, response, next) => {
  const payload = classPayload(request.body);
  if (payload.error) return response.status(400).json({ error: payload.error });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (!await validateStudents(client, payload.studentIds, payload.classType)) {
      await client.query("ROLLBACK");
      return response.status(400).json({ error: "Um dos alunos selecionados não foi encontrado." });
    }
    const conflict = await findScheduleConflict(client, payload);
    if (conflict) {
      await client.query("ROLLBACK");
      const label = conflict.classType === "school" ? "Escolinha" : "Particular";
      return response.status(409).json({ error: `Este horário se sobrepõe à turma ${label} das ${conflict.time}.` });
    }
    const created = await client.query(
      "INSERT INTO classes (class_type, weekday, class_time, capacity) VALUES ($1,$2,$3,$4) RETURNING id",
      [payload.classType, payload.weekday, payload.time, payload.capacity],
    );
    for (const studentId of payload.studentIds) {
      await client.query("INSERT INTO class_students (class_id, student_id) VALUES ($1,$2)", [created.rows[0].id, studentId]);
    }
    await client.query("COMMIT");
    response.status(201).json({ id: created.rows[0].id });
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23505") return response.status(409).json({ error: "Já existe uma turma nesse dia e horário." });
    next(error);
  } finally { client.release(); }
});

app.patch("/api/classes/:id", requireAuth, async (request, response, next) => {
  const id = Number(request.params.id);
  const payload = classPayload(request.body);
  if (!Number.isInteger(id) || payload.error) return response.status(400).json({ error: payload.error || "Turma inválida." });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (!await validateStudents(client, payload.studentIds, payload.classType)) {
      await client.query("ROLLBACK");
      return response.status(400).json({ error: "Um dos alunos selecionados não foi encontrado." });
    }
    const conflict = await findScheduleConflict(client, payload, id);
    if (conflict) {
      await client.query("ROLLBACK");
      const label = conflict.classType === "school" ? "Escolinha" : "Particular";
      return response.status(409).json({ error: `Este horário se sobrepõe à turma ${label} das ${conflict.time}.` });
    }
    const updated = await client.query(
      "UPDATE classes SET class_type=$1, weekday=$2, class_time=$3, capacity=$4 WHERE id=$5 RETURNING id",
      [payload.classType, payload.weekday, payload.time, payload.capacity, id],
    );
    if (!updated.rowCount) {
      await client.query("ROLLBACK");
      return response.status(404).json({ error: "Turma não encontrada." });
    }
    await client.query("DELETE FROM class_students WHERE class_id=$1", [id]);
    for (const studentId of payload.studentIds) {
      await client.query("INSERT INTO class_students (class_id, student_id) VALUES ($1,$2)", [id, studentId]);
    }
    await client.query("COMMIT");
    response.json({ ok: true });
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23505") return response.status(409).json({ error: "Já existe uma turma nesse dia e horário." });
    next(error);
  } finally { client.release(); }
});

app.delete("/api/classes/:id", requireAuth, async (request, response, next) => {
  try {
    const id = Number(request.params.id);
    if (!Number.isInteger(id)) return response.status(400).json({ error: "Turma inválida." });
    await pool.query("DELETE FROM classes WHERE id=$1", [id]);
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
