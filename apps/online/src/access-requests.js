import {
  identity,
  csrfAllowed,
  secureJson,
  timestamp,
  admins,
  hash,
} from "./auth.js";
import { normalizePhone } from "./phone.js";
const roles = ["service", "cash", "bar", "delivery"];
const keyboard = {
  keyboard: [
    [{ text: "Подати заявку" }],
    [{ text: "Подати заявку з номером", request_contact: true }],
    [{ text: "Мій статус" }],
  ],
  resize_keyboard: true,
};
const ack = () => secureJson({ ok: true });
const reply = (chat, text, markup = keyboard) =>
  secureJson({
    method: "sendMessage",
    chat_id: chat,
    text,
    reply_markup: markup,
  });
export async function telegramCall(env, method, body) {
  if (!env.TELEGRAM_BOT_TOKEN) return null;
  try {
    const r = await fetch(
      `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(6000),
      },
    );
    const data = await r.json();
    return data.ok ? data.result : null;
  } catch {
    return null;
  } // Never log URLs containing a bot token.
}
async function bounded(request, max = 65536) {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks = [];
  let n = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(n);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}
export function userProfile(user, chat, contact) {
  const safe = {};
  for (const [key, value] of Object.entries(user || {}))
    if (["string", "number", "boolean"].includes(typeof value))
      safe[key] = typeof value === "string" ? value.slice(0, 1000) : value;
  const profile = { user: safe };
  if (chat) {
    // Keep provided profile metadata, including new Telegram fields, but never
    // treat message history as personal profile information.
    profile.chat = Object.fromEntries(
      Object.entries(chat).filter(([key]) => key !== "pinned_message"),
    );
  }
  if (contact)
    profile.contact = {
      phone_number: contact.phone_number,
      first_name: contact.first_name || "",
      last_name: contact.last_name || "",
      user_id: contact.user_id,
      ...(contact.vcard ? { vcard: String(contact.vcard).slice(0, 4000) } : {}),
    };
  if (JSON.stringify(profile).length > 24000) delete profile.chat;
  return profile;
}
async function webhook(request, env) {
  if (request.method !== "POST")
    return secureJson({ error: "Method not allowed" }, 405);
  if (!env.TELEGRAM_WEBHOOK_SECRET)
    return secureJson({ error: "Bot unavailable" }, 503);
  const incoming = request.headers.get("X-Telegram-Bot-Api-Secret-Token") || "";
  if (
    !incoming ||
    (await hash(incoming)) !== (await hash(env.TELEGRAM_WEBHOOK_SECRET))
  )
    return secureJson({ error: "Unauthorized" }, 401);
  const update = await bounded(request);
  if (!update || !Number.isSafeInteger(update.update_id))
    return secureJson({ error: "Invalid update" }, 400);
  const m = update.message,
    u = m?.from;
  if (
    !m ||
    m.chat?.type !== "private" ||
    !u ||
    u.is_bot ||
    !Number.isSafeInteger(u.id) ||
    u.id <= 0 ||
    String(m.chat.id) !== String(u.id)
  )
    return ack();
  const now = timestamp(),
    id = String(u.id);
  const unique = await env.DB.prepare(
    "INSERT INTO telegram_updates VALUES(?,?) ON CONFLICT(id) DO NOTHING RETURNING id",
  )
    .bind(update.update_id, now + 172800)
    .first();
  if (!unique) return ack();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM telegram_updates WHERE expires<?").bind(now),
    env.DB.prepare("DELETE FROM rate_limits WHERE expires<?").bind(now),
  ]);
  const bucket = await hash(`bot:${id}:${Math.floor(now / 60)}`);
  const limit = await env.DB.prepare(
    "INSERT INTO rate_limits VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET hits=hits+1 WHERE hits<8 RETURNING hits",
  )
    .bind(bucket, now + 120)
    .first();
  if (!limit) return reply(id, "Забагато дій. Спробуйте через хвилину.");
  const name =
    [u.first_name, u.last_name].filter(Boolean).join(" ").slice(0, 200) ||
    "Користувач";
  await env.DB.prepare(
    "INSERT INTO telegram_profiles VALUES(?,?,?,?) ON CONFLICT(telegram_id) DO UPDATE SET username=excluded.username,name=excluded.name,updated=excluded.updated",
  )
    .bind(id, u.username || null, name, now)
    .run();
  const staff = await env.DB.prepare(
    "SELECT enabled FROM staff_access WHERE telegram_id=?",
  )
    .bind(id)
    .first();
  if (admins(env).has(id) || staff?.enabled === 1)
    return reply(id, "Вам уже надано доступ до МініКафе.", {
      inline_keyboard: [
        [
          {
            text: "Відкрити МініКафе",
            url: "https://minicafe.minicafe.workers.dev/admin",
          },
        ],
      ],
    });
  const text = (m.text || "").trim();
  if (/^\/start(?:\s+apply)?$/.test(text))
    return reply(
      id,
      "МініКафе · заявка на доступ\n\nНатисніть «Подати заявку». Адміністратор побачить ваш Telegram-профіль і вибере роль. Номер телефону необов’язковий; його можна передати окремою кнопкою.",
    );
  const prior = await env.DB.prepare(
    "SELECT status,phone FROM access_requests WHERE telegram_id=?",
  )
    .bind(id)
    .first();
  if (text === "Мій статус" || text === "/status")
    return reply(
      id,
      prior?.status === "pending"
        ? "Ваша заявка очікує рішення адміністратора."
        : prior?.status === "rejected"
          ? "Заявку відхилено. Можна подати нову заявку."
          : "Активної заявки немає. Натисніть «Подати заявку».",
    );
  let contact = null;
  if (m.contact) {
    if (String(m.contact.user_id) !== id)
      return reply(
        id,
        "Потрібно поділитися власним контактом через кнопку бота.",
      );
    contact = m.contact;
  }
  if (!contact && !["Подати заявку", "/apply"].includes(text))
    return reply(id, "Виберіть дію кнопкою нижче.");
  if (prior?.status === "pending" && !contact)
    return reply(id, "Ваша заявка вже очікує рішення.");
  const phone = contact
    ? normalizePhone(String(contact.phone_number), true)
    : null;
  if (contact && !phone)
    return reply(
      id,
      "Не вдалося перевірити формат контакту. Подайте заявку без номера.",
    );
  const chat = await telegramCall(env, "getChat", { chat_id: id });
  const profile = JSON.stringify(userProfile(u, chat, contact));
  if (prior?.status === "pending")
    await env.DB.prepare(
      "UPDATE access_requests SET profile=?,phone=? WHERE telegram_id=? AND status='pending'",
    )
      .bind(profile, phone, id)
      .run();
  else
    await env.DB.prepare(
      `INSERT INTO access_requests(telegram_id,chat_id,profile,phone,status,version,submitted) VALUES(?,?,?,?,'pending',1,?)
   ON CONFLICT(telegram_id) DO UPDATE SET chat_id=excluded.chat_id,profile=excluded.profile,phone=excluded.phone,status='pending',version=access_requests.version+1,submitted=excluded.submitted,resolved=NULL,resolved_by=NULL WHERE access_requests.status!='pending'`,
    )
      .bind(id, id, profile, phone, now)
      .run();
  return reply(
    id,
    "Заявку надіслано. Адміністратор розгляне її та надасть доступ. Статус можна перевірити кнопкою «Мій статус».",
  );
}
export async function accessRequests(request, env, ctx) {
  const path = new URL(request.url).pathname;
  if (path === "/api/telegram/webhook") return webhook(request, env);
  if (!path.startsWith("/api/staff-requests")) return null;
  const user = await identity(request, env);
  if (!user) return secureJson({ error: "Потрібен вхід" }, 401);
  if (user.role !== "admin")
    return secureJson({ error: "Лише адміністратор" }, 403);
  if (path === "/api/staff-requests/photo" && request.method === "GET") {
    const id = new URL(request.url).searchParams.get("telegram_id");
    if (!/^\d{1,20}$/.test(id || ""))
      return secureJson({ error: "Не знайдено" }, 404);
    const row = await env.DB.prepare(
      "SELECT profile FROM access_requests WHERE telegram_id=? AND status='pending'",
    )
      .bind(id)
      .first();
    const fileId = row
      ? JSON.parse(row.profile).chat?.photo?.small_file_id
      : null;
    if (!fileId) return secureJson({ error: "Фото недоступне" }, 404);
    const file = await telegramCall(env, "getFile", { file_id: fileId });
    if (!file?.file_path || !/^photos\/[A-Za-z0-9_.\/-]+$/.test(file.file_path))
      return secureJson({ error: "Фото недоступне" }, 404);
    try {
      const r = await fetch(
        `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${file.file_path}`,
        { signal: AbortSignal.timeout(6000) },
      );
      if (!r.ok) return secureJson({ error: "Фото недоступне" }, 404);
      const bytes = await r.arrayBuffer();
      if (bytes.byteLength > 3000000)
        return secureJson({ error: "Фото завелике" }, 413);
      return new Response(bytes, {
        headers: {
          "Content-Type": "image/jpeg",
          "Cache-Control": "private,max-age=60",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch {
      return secureJson({ error: "Фото недоступне" }, 404);
    }
  }
  if (path === "/api/staff-requests/link" && request.method === "GET")
    return secureJson({
      url: `https://t.me/${env.TELEGRAM_BOT_USERNAME}?start=apply`,
      ready: !!env.TELEGRAM_BOT_TOKEN && !!env.TELEGRAM_WEBHOOK_SECRET,
    });
  if (path === "/api/staff-requests" && request.method === "GET") {
    const result = await env.DB.prepare(
      "SELECT telegram_id,profile,phone,version,submitted FROM access_requests WHERE status='pending' ORDER BY submitted LIMIT 200",
    ).all();
    return secureJson({
      application_url: `https://t.me/${env.TELEGRAM_BOT_USERNAME}?start=apply`,
      bot_ready: !!env.TELEGRAM_BOT_TOKEN && !!env.TELEGRAM_WEBHOOK_SECRET,
      requests: result.results.map((r) => ({
        ...r,
        profile: JSON.parse(r.profile),
      })),
    });
  }
  if (path !== "/api/staff-requests/decision" || request.method !== "POST")
    return secureJson({ error: "Не знайдено" }, 404);
  if (!csrfAllowed(request, user))
    return secureJson({ error: "Немає доступу" }, 403);
  const input = await bounded(request, 2048);
  const id = String(input?.telegram_id || "");
  if (
    !/^\d{1,20}$/.test(id) ||
    admins(env).has(id) ||
    !Number.isSafeInteger(input?.version) ||
    input.version < 1 ||
    !["approve", "reject"].includes(input.action) ||
    (input.action === "approve" && !roles.includes(input.role))
  )
    return secureJson({ error: "Некоректна дія" }, 400);
  const now = timestamp(),
    statements = [];
  if (input.action === "approve") {
    statements.push(
      env.DB.prepare(
        `INSERT INTO staff_access SELECT telegram_id,?,1,? FROM access_requests WHERE telegram_id=? AND status='pending' AND version=?
    ON CONFLICT(telegram_id) DO UPDATE SET role=excluded.role,enabled=1,updated=excluded.updated`,
      ).bind(input.role, new Date().toISOString(), id, input.version),
    );
    statements.push(
      env.DB.prepare(
        "DELETE FROM auth_sessions WHERE telegram_id=? AND EXISTS(SELECT 1 FROM access_requests WHERE telegram_id=? AND status='pending' AND version=?)",
      ).bind(id, id, input.version),
    );
  }
  statements.push(
    env.DB.prepare(
      "UPDATE access_requests SET status=?,resolved=?,resolved_by=? WHERE telegram_id=? AND status='pending' AND version=? RETURNING chat_id",
    ).bind(
      input.action === "approve" ? "approved" : "rejected",
      now,
      user.id,
      id,
      input.version,
    ),
  );
  const result = await env.DB.batch(statements),
    row = result.at(-1).results[0];
  if (!row)
    return secureJson(
      { error: "Заявку вже опрацьовано або вона оновилася" },
      409,
    );
  const message =
    input.action === "approve"
      ? "Вашу заявку до МініКафе прийнято. Увійдіть на сайт через Telegram."
      : "Вашу заявку до МініКафе відхилено. За потреби можна подати нову заявку.";
  const notification = telegramCall(env, "sendMessage", {
    chat_id: row.chat_id,
    text: message,
    ...(input.action === "approve"
      ? {
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: "Увійти",
                  url: "https://minicafe.minicafe.workers.dev/admin",
                },
              ],
            ],
          },
        }
      : { reply_markup: keyboard }),
  });
  if (ctx?.waitUntil) ctx.waitUntil(notification);
  else await notification;
  return secureJson({ ok: true });
}
