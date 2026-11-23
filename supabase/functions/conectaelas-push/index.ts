import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import webpush from "web-push";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const secrets = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
const SERVICE_KEY = secrets.default ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const publishables = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "{}");
const PUBLIC_KEY = publishables.default ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const encoder = new TextEncoder();
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
    "access-control-allow-headers": "content-type, apikey, x-token",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "cache-control": "no-store",
  }});
}
function fail(status: number, message: string): never { throw new ApiError(status, message); }
function first(rows: any[]) { return rows?.[0] ?? null; }
function safeEq(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function idFilter(id: number) { return `eq.${id}`; }
function dateBr(value: unknown) {
  const parts = String(value ?? "").split("-");
  return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : String(value ?? "");
}

async function verifySignature(payload: string) {
  if (!SERVICE_KEY) fail(503, "A configuração segura do Supabase está indisponível.");
  const key = await crypto.subtle.importKey("raw", encoder.encode(SERVICE_KEY), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)));
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}
async function authenticate(req: Request, roles: string[]) {
  const [payload, supplied] = (req.headers.get("x-token") ?? "").split(".");
  if (!payload || !supplied || !safeEq(await verifySignature(payload), supplied)) fail(401, "Faça login para continuar.");
  let user: { id: number; role: string; exp: number };
  try { user = JSON.parse(atob(payload)); } catch { fail(401, "Sessão inválida."); }
  if (!Number.isFinite(user!.id) || user!.exp < Math.floor(Date.now() / 1000)) fail(401, "Sessão expirada.");
  if (!roles.includes(user!.role)) fail(403, "Sem permissão.");
  return user!;
}

async function db(table: string, method = "GET", params: Record<string, string> = {}, body?: unknown, prefer?: string) {
  if (!SUPABASE_URL || !SERVICE_KEY) fail(503, "A configuração segura do banco Supabase está incompleta.");
  const url = new URL(`/rest/v1/${table}`, SUPABASE_URL);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const headers: Record<string, string> = { apikey: SERVICE_KEY, accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (prefer) headers.prefer = prefer;
  const result = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await result.text();
  let parsed: any = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  if (!result.ok) {
    console.error("Push database error", result.status, typeof parsed === "object" ? parsed?.code : "");
    fail(500, "Não foi possível concluir a operação de notificações.");
  }
  return parsed;
}
const get = (table: string, params: Record<string, string>) => db(table, "GET", params);
const del = (table: string, params: Record<string, string>) => db(table, "DELETE", params, undefined, "return=minimal");

function decodePushKey(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - base64.length % 4) % 4);
    const raw = atob(padded);
    return Uint8Array.from(raw, (char) => char.charCodeAt(0));
  } catch { return null; }
}
function validateEndpoint(value: unknown) {
  let endpoint: URL;
  try { endpoint = new URL(String(value ?? "")); } catch { fail(400, "Assinatura de notificação inválida."); }
  const host = endpoint!.hostname.toLowerCase();
  const allowedHost = host === "fcm.googleapis.com"
    || host === "updates.push.services.mozilla.com"
    || host === "push.services.mozilla.com"
    || host === "web.push.apple.com"
    || host === "notify.windows.com"
    || /^wns[0-9]+-[a-z0-9-]+\.notify\.windows\.com$/.test(host);
  if (endpoint!.protocol !== "https:" || endpoint!.username || endpoint!.password || endpoint!.href.length > 2048 || !allowedHost)
    fail(400, "O navegador forneceu um endereço de notificação inválido.");
  return endpoint!.href;
}

async function getVapidKeys() {
  const query = { select: "name,public_key,private_key", name: "eq.vapid", limit: "1" };
  let keys = first(await get("push_settings", query));
  if (!keys) {
    const generated = webpush.generateVAPIDKeys();
    await db("push_settings", "POST", { on_conflict: "name" }, {
      name: "vapid", public_key: generated.publicKey, private_key: generated.privateKey,
    }, "resolution=ignore-duplicates,return=minimal");
    keys = first(await get("push_settings", query));
  }
  if (!keys?.public_key || !keys?.private_key) fail(503, "Não foi possível preparar as notificações push.");
  return keys;
}

async function sendPushToUser(userId: unknown, payload: { title: string; body: string; url: string }) {
  const id = Number(userId);
  if (!Number.isFinite(id) || id <= 0) return true;
  const subscriptions = await get("push_subscriptions", {
    select: "endpoint,p256dh,auth", user_id: idFilter(id), limit: "50",
  });
  if (!subscriptions.length) return false;
  const keys = await getVapidKeys();
  webpush.setVapidDetails("mailto:conectafemmest@gmail.com", keys.public_key, keys.private_key);
  let allSent = true;
  await Promise.all(subscriptions.map(async (subscription: any) => {
    try {
      await webpush.sendNotification({
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      }, JSON.stringify(payload), { TTL: 3600 });
    } catch (error) {
      const status = Number((error as any)?.statusCode ?? 0);
      if (status === 404 || status === 410) {
        try { await del("push_subscriptions", { endpoint: `eq.${subscription.endpoint}`, user_id: idFilter(id) }); } catch { /* cleanup is best effort */ }
      } else {
        allSent = false;
        console.error("Push delivery failed", status || (error instanceof Error ? error.name : "UnknownError"));
      }
    }
  }));
  return allSent;
}

async function dispatchEvent(eventKey: string, recipientId: unknown, payload: { title: string; body: string; url: string }) {
  const claimed = await db("push_event_log", "POST", { on_conflict: "event_key" }, { event_key: eventKey }, "resolution=ignore-duplicates,return=representation");
  if (!Array.isArray(claimed) || !claimed.length) return { ok: 1, duplicate: true };
  try {
    const available = await get("push_subscriptions", {
      select: "endpoint", user_id: idFilter(Number(recipientId)), limit: "1",
    });
    if (!Array.isArray(available) || !available.length) {
      await del("push_event_log", { event_key: `eq.${eventKey}` });
      return { ok: 1, skipped: true, reason: "no_push_subscription" };
    }
    const sent = await sendPushToUser(recipientId, payload);
    if (!sent) {
      await del("push_event_log", { event_key: `eq.${eventKey}` });
      fail(502, "O serviço de notificações não aceitou o aviso. Tente novamente.");
    }
    return { ok: 1 };
  } catch (error) {
    try { await del("push_event_log", { event_key: `eq.${eventKey}` }); } catch { /* retry cleanup is best effort */ }
    throw error;
  }
}

async function notifyBooking(req: Request, input: any) {
  const me = await authenticate(req, ["client"]);
  const slotId = Number(input.slot_id), serviceId = Number(input.service_id);
  if (!Number.isInteger(slotId) || slotId <= 0 || !Number.isInteger(serviceId) || serviceId <= 0) fail(400, "Agendamento inválido.");
  const booking = first(await get("bookings", {
    select: "id,slot_id,service_id,client_id,provider_id,status",
    client_id: idFilter(me.id), slot_id: idFilter(slotId), service_id: idFilter(serviceId), status: "eq.confirmado",
    order: "created.desc", limit: "1",
  }));
  if (!booking) return { ok: 1, skipped: true };
  const [slot, service] = await Promise.all([
    get("slots", { select: "day,hour", id: idFilter(Number(booking.slot_id)), limit: "1" }),
    get("services", { select: "title", id: idFilter(Number(booking.service_id)), limit: "1" }),
  ]);
  const title = service[0]?.title ?? "Atendimento";
  const when = `${dateBr(slot[0]?.day)} às ${slot[0]?.hour ?? ""}`;
  const [providerPush, clientPush] = await Promise.all([
    dispatchEvent(`booking:${booking.id}:provider`, booking.provider_id, {
      title: "Novo atendimento confirmado",
      body: `${title} com cliente confirmado para ${when}.`,
      url: "/#/painel",
    }),
    dispatchEvent(`booking:${booking.id}:client`, booking.client_id, {
      title: "Agendamento confirmado",
      body: `${title} confirmado para ${when}.`,
      url: "/#/painel",
    }),
  ]);
  return { ok: 1, providerPush, clientPush };
}

async function notifyStatus(req: Request, input: any) {
  const me = await authenticate(req, ["client", "provider"]);
  const bookingId = Number(input.id), status = String(input.status ?? "");
  if (!Number.isInteger(bookingId) || bookingId <= 0 || !["confirmado", "cancelado"].includes(status)) fail(400, "Atualização de agendamento inválida.");
  const booking = first(await get("bookings", {
    select: "id,slot_id,service_id,client_id,provider_id,status", id: idFilter(bookingId), limit: "1",
  }));
  if (!booking) fail(404, "Agendamento não encontrado.");
  if (booking.status !== status) return { ok: 1, skipped: true };

  let recipientId: number;
  if (status === "confirmado") {
    if (me.role !== "provider" || Number(booking.provider_id) !== me.id) fail(403, "Sem permissão.");
    recipientId = Number(booking.client_id);
  } else if (me.role === "provider" && Number(booking.provider_id) === me.id) {
    recipientId = Number(booking.client_id);
  } else if (me.role === "client" && Number(booking.client_id) === me.id) {
    recipientId = Number(booking.provider_id);
  } else fail(403, "Sem permissão.");
  if (!Number.isFinite(recipientId) || recipientId <= 0) return { ok: 1, skipped: true };

  const [slot, service] = await Promise.all([
    get("slots", { select: "day,hour", id: idFilter(Number(booking.slot_id)), limit: "1" }),
    get("services", { select: "title", id: idFilter(Number(booking.service_id)), limit: "1" }),
  ]);
  const confirmed = status === "confirmado";
  const verb = confirmed ? "foi confirmado" : "foi cancelado";
  return await dispatchEvent(`status:${booking.id}:${status}`, recipientId, {
    title: confirmed ? "Agendamento confirmado" : "Agendamento cancelado",
    body: `${service[0]?.title ?? "O atendimento"} em ${dateBr(slot[0]?.day)} às ${slot[0]?.hour ?? ""} ${verb}.`,
    url: "/#/painel",
  });
}

async function notifyReschedule(req: Request, input: any) {
  const me = await authenticate(req, ["client", "provider"]);
  const bookingId = Number(input.id);
  if (!Number.isInteger(bookingId) || bookingId <= 0) fail(400, "Agendamento inválido.");
  const booking = first(await get("bookings", {
    select: "id,slot_id,service_id,client_id,provider_id,status,reschedule_version",
    id: idFilter(bookingId), status: "eq.confirmado", limit: "1",
  }));
  if (!booking || Number(booking.reschedule_version) < 1) fail(404, "Remarcação não encontrada.");
  const isClient = me.role === "client" && Number(booking.client_id) === me.id;
  const isProvider = me.role === "provider" && Number(booking.provider_id) === me.id;
  if (!isClient && !isProvider) fail(403, "Sem permissão.");
  const recipientId = isClient ? Number(booking.provider_id) : Number(booking.client_id);
  if (!Number.isFinite(recipientId) || recipientId <= 0) return { ok: 1, push: { skipped: true, reason: "recipient_unavailable" } };
  const [slot, service, actor, recipient, subscriptions] = await Promise.all([
    get("slots", { select: "day,hour", id: idFilter(Number(booking.slot_id)), limit: "1" }),
    get("services", { select: "title", id: idFilter(Number(booking.service_id)), limit: "1" }),
    get("users", { select: "name", id: idFilter(me.id), limit: "1" }),
    get("users", { select: "name,email", id: idFilter(recipientId), limit: "1" }),
    get("push_subscriptions", { select: "endpoint", user_id: idFilter(recipientId), limit: "1" }),
  ]);
  const actorName = actor[0]?.name ?? (isClient ? "Uma cliente" : "A profissional");
  const text = `${actorName} remarcou ${service[0]?.title ?? "o atendimento"} para ${dateBr(slot[0]?.day)} às ${slot[0]?.hour ?? ""}.`;
  const payload = { title: "Atendimento remarcado", body: text, url: "/#/painel" };
  const version = Number(booking.reschedule_version);
  const push = Array.isArray(subscriptions) && subscriptions.length
    ? await dispatchEvent(`reschedule:${booking.id}:${version}`, recipientId, payload)
    : { ok: 1, skipped: true, reason: "no_push_subscription" };
  let email: { sent?: boolean; skipped?: boolean; reason?: string } = { skipped: true, reason: "email_not_configured" };
  // Mantém o envio de e-mail existente apenas para o fluxo cliente -> profissional.
  if (isClient && recipient[0]?.email && RESEND_API_KEY && RESEND_FROM_EMAIL) {
    const eventKey = `email:reschedule:${booking.id}:${version}`;
    const claimed = await db("push_event_log", "POST", { on_conflict: "event_key" }, { event_key: eventKey }, "resolution=ignore-duplicates,return=representation");
    if (!Array.isArray(claimed) || !claimed.length) {
      email = { skipped: true, reason: "duplicate" };
    } else {
      const safe = (value: unknown) => String(value ?? "").replace(/[&<>\"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!));
      try {
        const result = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { authorization: `Bearer ${RESEND_API_KEY}`, "content-type": "application/json" },
          body: JSON.stringify({
            from: RESEND_FROM_EMAIL, to: [recipient[0].email],
            subject: "Uma cliente remarcou um atendimento no ConectaFemme", text,
            html: `<div style="font-family:Arial,sans-serif;color:#38242a;line-height:1.6"><h2 style="color:#7b1e3a">ConectaFemme</h2><p>${safe(text)}</p><p>Acesse o painel para conferir a atualização.</p><p><a href="${safe(APP_ORIGIN)}/#/painel">Abrir painel</a></p></div>`,
          }),
        });
        if (!result.ok) {
          try { await del("push_event_log", { event_key: `eq.${eventKey}` }); } catch { /* best effort */ }
          email = { skipped: true, reason: "delivery_failed" };
        } else email = { sent: true };
      } catch {
        try { await del("push_event_log", { event_key: `eq.${eventKey}` }); } catch { /* best effort */ }
        email = { skipped: true, reason: "delivery_failed" };
      }
    }
  }
  return { ok: 1, push, email };
}

async function handle(req: Request) {
  const url = new URL(req.url), action = url.searchParams.get("a") ?? "";
  let input: any = {};
  if (req.method !== "GET" && req.method !== "OPTIONS") {
    try { input = await req.json(); } catch { input = {}; }
  }
  switch (action) {
    case "public_key": {
      const keys = await getVapidKeys();
      return { publicKey: keys.public_key };
    }
    case "subscribe": {
      const me = await authenticate(req, ["client", "provider"]);
      const subscription = input?.subscription;
      const endpoint = validateEndpoint(subscription?.endpoint);
      const p256dh = String(subscription?.keys?.p256dh ?? ""), authKey = String(subscription?.keys?.auth ?? "");
      const publicKeyBytes = decodePushKey(p256dh), authBytes = decodePushKey(authKey);
      if (!publicKeyBytes || publicKeyBytes.length !== 65 || publicKeyBytes[0] !== 4 || !authBytes || authBytes.length !== 16)
        fail(400, "O navegador forneceu uma assinatura inválida.");
      await db("push_subscriptions", "POST", { on_conflict: "endpoint" }, {
        endpoint, user_id: me.id, p256dh, auth: authKey, updated_at: new Date().toISOString(),
      }, "resolution=merge-duplicates,return=minimal");
      return { ok: 1 };
    }
    case "unsubscribe": {
      const me = await authenticate(req, ["client", "provider"]);
      const endpoint = validateEndpoint(input?.endpoint);
      await del("push_subscriptions", { endpoint: `eq.${endpoint}`, user_id: idFilter(me.id) });
      return { ok: 1 };
    }
    case "notify_booking": return await notifyBooking(req, input);
    case "notify_status": return await notifyStatus(req, input);
    case "notify_reschedule": return await notifyReschedule(req, input);
    default: fail(404, "Ação de notificação inválida.");
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return response({ ok: true });
  try {
    if (!SERVICE_KEY || !SUPABASE_URL) fail(503, "A configuração segura do Supabase está indisponível.");
    if (PUBLIC_KEY && !safeEq(req.headers.get("apikey") ?? "", PUBLIC_KEY)) fail(401, "Chave pública inválida.");
    return response(await handle(req));
  } catch (error) {
    if (error instanceof ApiError) return response({ error: error.message }, error.status);
    console.error("ConectaFemme push error", error instanceof Error ? error.name : "UnknownError");
    return response({ error: "Não foi possível processar a notificação." }, 500);
  }
});
