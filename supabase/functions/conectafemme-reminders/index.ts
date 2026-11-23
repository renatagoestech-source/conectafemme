import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const secrets = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
const SERVICE_KEY = secrets.default ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const RESEND_FROM_EMAIL = Deno.env.get("RESEND_FROM_EMAIL") ?? "";
const APP_ORIGIN = (Deno.env.get("APP_ORIGIN") ?? "https://conectaelasapp.vercel.app").replace(/\/$/, "");

class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

function response(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type, apikey, x-cron-secret",
    "access-control-allow-methods": "POST, OPTIONS",
    "cache-control": "no-store",
  }});
}
function fail(status: number, message: string): never { throw new ApiError(status, message); }
function idFilter(id: number) { return `eq.${id}`; }

async function db(path: string, method = "GET", params: Record<string, string> = {}, body?: unknown, prefer?: string) {
  if (!SUPABASE_URL || !SERVICE_KEY) fail(503, "A configuração do Supabase está indisponível.");
  const url = new URL(`/rest/v1/${path}`, SUPABASE_URL);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const headers: Record<string, string> = { apikey: SERVICE_KEY, accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (prefer) headers.prefer = prefer;
  const result = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await result.text();
  let parsed: any = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  if (!result.ok) {
    console.error("Reminder database error", result.status, typeof parsed === "object" ? parsed?.code : "");
    fail(500, "Não foi possível consultar os agendamentos.");
  }
  return parsed;
}
const get = (path: string, params: Record<string, string>) => db(path, "GET", params);
const del = (path: string, params: Record<string, string>) => db(path, "DELETE", params, undefined, "return=minimal");

function saoPauloNow() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const hour = Number(values.hour), minute = Number(values.minute);
  return { day: `${values.year}-${values.month}-${values.day}`, hour, minute, minutes: hour * 60 + minute };
}
function nextDay(day: string) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}
function timeMinutes(value: unknown) {
  const match = String(value ?? "").match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hour = Number(match[1]), minute = Number(match[2]);
  return hour <= 23 && minute <= 59 ? hour * 60 + minute : null;
}
function dateBr(value: unknown) {
  const parts = String(value ?? "").split("-");
  return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : String(value ?? "");
}
function htmlEscape(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!));
}
function claimKey(kind: string, channel: "push" | "email", booking: any, slot: any) {
  return `${channel}:reminder:${kind}:${booking.id}:${slot.id}`;
}
async function claimEvent(eventKey: string) {
  const claimed = await db("push_event_log", "POST", { on_conflict: "event_key" }, { event_key: eventKey }, "resolution=ignore-duplicates,return=representation");
  return Array.isArray(claimed) && claimed.length > 0;
}
async function releaseEvent(eventKey: string) {
  try { await del("push_event_log", { event_key: `eq.${eventKey}` }); } catch { /* retry cleanup is best effort */ }
}

async function sendPush(booking: any, slot: any, title: string, body: string, kind: "day" | "30m") {
  const userId = Number(booking.client_id);
  const subscriptions = await get("push_subscriptions", {
    select: "endpoint,p256dh,auth", user_id: idFilter(userId), limit: "50",
  });
  if (!Array.isArray(subscriptions) || !subscriptions.length) return "unsubscribed";
  const eventKey = claimKey(kind, "push", booking, slot);
  if (!await claimEvent(eventKey)) return "duplicate";

  try {
    const keys = await get("push_settings", { select: "public_key,private_key", name: "eq.vapid", limit: "1" });
    if (!Array.isArray(keys) || !keys[0]?.public_key || !keys[0]?.private_key) fail(503, "As chaves de notificação não estão configuradas.");
    webpush.setVapidDetails("mailto:conectafemmest@gmail.com", keys[0].public_key, keys[0].private_key);
    const rescheduleUrl = `${APP_ORIGIN}/#/painel?remarcar=${encodeURIComponent(String(booking.id))}`;
    const payload = JSON.stringify({
      title,
      body,
      url: rescheduleUrl,
      rescheduleUrl,
      actions: [{ action: "reschedule", title: "Remarcar" }],
    });
    let failed = false;
    await Promise.all(subscriptions.map(async (subscription: any) => {
      try {
        await webpush.sendNotification({
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        }, payload, { TTL: 3600 });
      } catch (error) {
        const status = Number((error as any)?.statusCode ?? 0);
        if (status === 404 || status === 410) {
          try { await del("push_subscriptions", { endpoint: `eq.${subscription.endpoint}`, user_id: idFilter(userId) }); } catch { /* cleanup is best effort */ }
        } else {
          failed = true;
          console.error("Reminder push failed", status || (error instanceof Error ? error.name : "UnknownError"));
        }
      }
    }));
    if (failed) {
      await releaseEvent(eventKey);
      return "failed";
    }
    return "sent";
  } catch (error) {
    await releaseEvent(eventKey);
    throw error;
  }
}

async function sendEmail(booking: any, slot: any, client: any, title: string, subject: string, text: string, kind: "day" | "30m") {
  if (!RESEND_API_KEY || !RESEND_FROM_EMAIL) return "unconfigured";
  if (!client?.email || client.is_demo) return "no_recipient";
  const eventKey = claimKey(kind, "email", booking, slot);
  if (!await claimEvent(eventKey)) return "duplicate";
  const rescheduleUrl = `${APP_ORIGIN}/#/painel?remarcar=${encodeURIComponent(String(booking.id))}`;
  const safeName = htmlEscape(client.name || "");
  const safeTitle = htmlEscape(title);
  const safeDay = htmlEscape(dateBr(slot.day));
  const safeHour = htmlEscape(String(slot.hour));
  const safeText = htmlEscape(text);
  const html = `<div style="font-family:Arial,sans-serif;color:#38242a;line-height:1.6;max-width:600px;margin:auto"><h2 style="color:#7b1e3a">ConectaFemme</h2><p>Olá${safeName ? `, ${safeName}` : ""}.</p><p>${safeText}</p><p><strong>${safeTitle}</strong><br>${safeDay} às ${safeHour}</p><p>Se acontecer algum imprevisto, você pode escolher outro horário disponível:</p><p><a href="${htmlEscape(rescheduleUrl)}" style="display:inline-block;background:#7b1e3a;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none">Remarcar atendimento</a></p></div>`;
  try {
    const result = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ from: RESEND_FROM_EMAIL, to: [client.email], subject, html, text: `${text}\n\n${title} — ${dateBr(slot.day)} às ${slot.hour}.\nRemarque: ${rescheduleUrl}` }),
    });
    if (!result.ok) {
      console.error("Reminder email delivery failed", result.status);
      await releaseEvent(eventKey);
      return "failed";
    }
    return "sent";
  } catch (error) {
    await releaseEvent(eventKey);
    console.error("Reminder email request failed", error instanceof Error ? error.name : "UnknownError");
    return "failed";
  }
}

function reminderContent(kind: "day" | "30m", title: string, hour: string) {
  if (kind === "30m") {
    const text = `Faltam 30 minutos para o seu atendimento. Não se atrase! ${title} às ${hour}.`;
    return { pushTitle: "Seu atendimento começa em 30 minutos", pushBody: text, subject: "Seu atendimento começa em 30 minutos", emailText: text };
  }
  const text = `Lembrete: seu atendimento de ${title} é hoje às ${hour}.`;
  return { pushTitle: "Lembrete: seu atendimento é hoje", pushBody: text, subject: "Lembrete do seu atendimento de hoje", emailText: text };
}

async function processReminders(kind: "day" | "30m", now: ReturnType<typeof saoPauloNow>, slotRows: any[], bookingRows: any[], servicesById: Map<number, string>, usersById: Map<number, any>) {
  const slotsById = new Map(slotRows.map((slot: any) => [Number(slot.id), slot]));
  let pushSent = 0, emailSent = 0, failed = 0;
  for (const booking of bookingRows) {
    if (booking.status !== "confirmado" || booking.client_id == null) continue;
    const slot = slotsById.get(Number(booking.slot_id));
    if (!slot) continue;
    const appointmentMinutes = timeMinutes(slot.hour);
    if (appointmentMinutes === null) continue;
    if (kind === "day") {
      if (slot.day !== now.day || now.hour !== 8 || now.minute > 5 || appointmentMinutes < now.minutes) continue;
    } else {
      const dayOffset = slot.day === now.day ? 0 : slot.day === nextDay(now.day) ? 1 : null;
      if (dayOffset === null) continue;
      const minutesUntil = dayOffset * 1440 + appointmentMinutes - now.minutes;
      if (minutesUntil < 29 || minutesUntil > 30) continue;
    }

    const title = servicesById.get(Number(booking.service_id)) ?? "seu atendimento";
    const client = usersById.get(Number(booking.client_id));
    const content = reminderContent(kind, title, String(slot.hour));
    try {
      const [pushResult, emailResult] = await Promise.all([
        sendPush(booking, slot, content.pushTitle, content.pushBody, kind),
        sendEmail(booking, slot, client, title, content.subject, content.emailText, kind),
      ]);
      if (pushResult === "sent") pushSent++;
      if (emailResult === "sent") emailSent++;
      if (pushResult === "failed" || emailResult === "failed") failed++;
    } catch {
      failed++;
    }
  }
  return { pushSent, emailSent, failed };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return response({ ok: true });
  if (req.method !== "POST") return response({ error: "Método inválido." }, 405);
  try {
    const candidate = req.headers.get("x-cron-secret") ?? "";
    if (!candidate) fail(401, "A autorização do agendador está ausente.");
    const secretIsValid = await db("rpc/check_conectafemme_reminder_secret", "POST", {}, { candidate });
    if (secretIsValid !== true) fail(401, "A autorização do agendador é inválida.");

    const input = await req.json().catch(() => ({}));
    const kind = input?.kind === "day" || input?.kind === "30m" ? input.kind : "30m";
    const now = saoPauloNow();
    if (kind === "day" && (now.hour !== 8 || now.minute > 5))
      return response({ ok: true, skipped: "outside_0800", sent: 0, failed: 0 });

    const days = [...new Set([now.day, nextDay(now.day)])];
    const slots = await get("slots", { select: "id,day,hour", day: `in.(${days.join(",")})`, limit: "2000" });
    const slotRows = Array.isArray(slots) ? slots : [];
    const slotIds = slotRows.map((slot: any) => Number(slot.id)).filter((id: number) => Number.isInteger(id) && id > 0);
    if (!slotIds.length) return response({ ok: true, day: now.day, sent: 0, failed: 0 });

    const bookings = await get("bookings", {
      select: "id,slot_id,service_id,client_id,status", slot_id: `in.(${slotIds.join(",")})`,
      status: "eq.confirmado", client_id: "not.is.null", limit: "2000",
    });
    const bookingRows = Array.isArray(bookings) ? bookings : [];
    const serviceIds = [...new Set(bookingRows.map((booking: any) => Number(booking.service_id)).filter((id: number) => Number.isInteger(id) && id > 0))];
    const clientIds = [...new Set(bookingRows.map((booking: any) => Number(booking.client_id)).filter((id: number) => Number.isInteger(id) && id > 0))];
    const [services, users] = await Promise.all([
      serviceIds.length ? get("services", { select: "id,title", id: `in.(${serviceIds.join(",")})`, limit: "2000" }) : [],
      clientIds.length ? get("users", { select: "id,name,email,is_demo", id: `in.(${clientIds.join(",")})`, limit: "2000" }) : [],
    ]);
    const servicesById = new Map((Array.isArray(services) ? services : []).map((service: any) => [Number(service.id), service.title]));
    const usersById = new Map((Array.isArray(users) ? users : []).map((user: any) => [Number(user.id), user]));

    const results = kind === "day"
      ? await processReminders("day", now, slotRows, bookingRows, servicesById, usersById)
      : await processReminders("30m", now, slotRows, bookingRows, servicesById, usersById);
    const emailsConfigured = Boolean(RESEND_API_KEY && RESEND_FROM_EMAIL);
    return response({ ok: true, day: now.day, ...results, emailConfiguration: emailsConfigured ? "ready" : "required" });
  } catch (error) {
    if (error instanceof ApiError) return response({ error: error.message }, error.status);
    console.error("ConectaFemme reminder error", error instanceof Error ? error.name : "UnknownError");
    return response({ error: "Não foi possível processar os lembretes." }, 500);
  }
});
