import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const secrets = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
const SERVICE_KEY = secrets.default ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const publishables = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "{}");
const PUBLIC_KEY = publishables.default ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const encoder = new TextEncoder();
const FOUNDER_LIMIT = 20;
// A contagem começa com esta versão da campanha; perfis antigos não ocupam vagas.
const FOUNDER_CAMPAIGN_STARTED_AT = "2026-10-17T17:15:00.000Z";

class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

function response(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type, apikey, x-token",
    "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "cache-control": "no-store",
  }});
}
function fail(status: number, message: string): never { throw new ApiError(status, message); }
function safeEq(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
function toHex(buf: ArrayBuffer | ArrayBufferView) { const view = buf instanceof ArrayBuffer ? new Uint8Array(buf) : new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength); return [...view].map(x => x.toString(16).padStart(2, "0")).join(""); }
async function hashPassword(password: string, saltHex: string) {
  const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map(x => parseInt(x, 16)));
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 310000, hash: "SHA-256" }, key, 256);
  return `pbkdf2:310000:${saltHex}:${toHex(bits)}`;
}
async function verifyPassword(password: string, stored: string) {
  const parts = stored.split(":");
  if (parts.length !== 4 || parts[0] !== "pbkdf2" || parts[1] !== "310000") return false;
  const actual = await hashPassword(password, parts[2]);
  return safeEq(actual, stored);
}
async function signature(payload: string) {
  if (!SERVICE_KEY) fail(503, "A configuração segura do banco Supabase está indisponível.");
  const key = await crypto.subtle.importKey("raw", encoder.encode(SERVICE_KEY), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)));
}
async function makeToken(user: { id: number | string; role: string }) {
  const payload = btoa(JSON.stringify({ id: Number(user.id), role: user.role, exp: Math.floor(Date.now() / 1000) + 604800 }));
  return `${payload}.${await signature(payload)}`;
}
async function auth(req: Request, roles?: string[]) {
  const raw = req.headers.get("x-token") ?? "";
  const [payload, sig] = raw.split(".");
  if (!payload || !sig || !safeEq(await signature(payload), sig)) fail(401, "Faça login");
  let user: { id: number; role: string; exp: number };
  try { user = JSON.parse(atob(payload)); } catch { fail(401, "Sessão inválida"); }
  if (!Number.isFinite(user!.id) || user!.exp < Math.floor(Date.now() / 1000)) fail(401, "Sessão expirada");
  if (roles && !roles.includes(user!.role)) fail(403, "Sem permissão");
  return user!;
}

async function db(table: string, method = "GET", params: Record<string, string> = {}, payload?: unknown, prefer?: string) {
  if (!SUPABASE_URL || !SERVICE_KEY) fail(503, "A configuração do banco Supabase está incompleta.");
  const url = new URL(`/rest/v1/${table}`, SUPABASE_URL);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const headers: Record<string, string> = { apikey: SERVICE_KEY, accept: "application/json" };
  if (payload !== undefined) headers["content-type"] = "application/json";
  if (prefer) headers.prefer = prefer;
  const res = await fetch(url, { method, headers, body: payload === undefined ? undefined : JSON.stringify(payload) });
  const text = await res.text();
  let parsed: any = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  if (!res.ok) {
    console.error("Supabase REST error", res.status, typeof parsed === "object" ? parsed?.code : "");
    fail(500, "Não foi possível concluir a operação no banco de dados.");
  }
  return parsed;
}
const get = (t: string, p: Record<string,string>) => db(t, "GET", p);
const post = (t: string, row: unknown, p: Record<string,string> = {}) => db(t, "POST", { ...p, select: "*" }, row, "return=representation");
const patch = (t: string, p: Record<string,string>, row: unknown) => db(t, "PATCH", { ...p, select: "*" }, row, "return=representation");
const del = (t: string, p: Record<string,string>) => db(t, "DELETE", { ...p, select: "*" }, undefined, "return=representation");
const first = (rows: any[]) => rows?.[0] ?? null;
const bodyString = (body: any, key: string) => String(body?.[key] ?? "").trim();
const idFilter = (id: unknown) => `eq.${Number(id)}`;
const inFilter = (ids: number[]) => ids.length ? `in.(${ids.join(",")})` : "in.(0)";

async function relatedUsers(ids: number[]) {
  const validIds = [...new Set(ids.filter((id) => Number.isFinite(id) && id > 0))];
  if (!validIds.length) return [];
  return get("users", { select: "id,name,whatsapp,role,email,created", id: inFilter(validIds) });
}
async function relatedServices(ids: number[]) {
  if (!ids.length) return [];
  return get("services", { select: "id,title,price,provider_id", id: inFilter(ids) });
}
async function relatedSlots(ids: number[]) {
  if (!ids.length) return [];
  return get("slots", { select: "id,day,hour,booked,provider_id", id: inFilter(ids) });
}

function appointmentPassed(day: unknown, hour: unknown) {
  const now = saoPauloNow(), date = String(day ?? ""), minutes = timeToMinutes(hour);
  return Boolean(date && minutes !== null && (date < now.day || (date === now.day && minutes <= now.minutes)));
}
async function completeExpiredBookings(rows: any[], slots: any[]) {
  const expired = rows.filter((booking) => booking.status === "confirmado" && appointmentPassed(slots.find((slot) => Number(slot.id) === Number(booking.slot_id))?.day, slots.find((slot) => Number(slot.id) === Number(booking.slot_id))?.hour));
  await Promise.all(expired.map(async (booking) => {
    await patch("bookings", { id: idFilter(booking.id), status: "eq.confirmado" }, { status: "concluido" });
    booking.status = "concluido";
  }));
}
function ratingSummary(rows: any[]) {
  const count = rows.length, average = count ? rows.reduce((sum, row) => sum + Number(row.rating), 0) / count : 0;
  return { rating_avg: Number(average.toFixed(1)), review_count: count };
}

function saoPauloNow() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { day: `${values.year}-${values.month}-${values.day}`, minutes: Number(values.hour) * 60 + Number(values.minute) };
}

function timeToMinutes(value: unknown) {
  const text = String(value ?? "");
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(text)) return null;
  const [hour, minute] = text.split(":").map(Number);
  return hour * 60 + minute;
}

function validISODate(value: unknown) {
  const text = String(value ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const date = new Date(`${text}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === text;
}

function makeHours(start: unknown, end: unknown, duration: unknown, breakStart?: unknown, breakEnd?: unknown) {
  const from = timeToMinutes(start), until = timeToMinutes(end), length = Number(duration);
  if (from === null || until === null || from >= until || !Number.isInteger(length) || length < 15 || length > 240)
    fail(400, "Confira o início, o fim e a duração dos atendimentos.");
  const pauseFrom = breakStart ? timeToMinutes(breakStart) : null;
  const pauseUntil = breakEnd ? timeToMinutes(breakEnd) : null;
  if ((breakStart || breakEnd) && (pauseFrom === null || pauseUntil === null || pauseFrom >= pauseUntil || pauseFrom < from || pauseUntil > until))
    fail(400, "O intervalo precisa ficar dentro do expediente e ter início e fim.");
  const hours: string[] = [];
  for (let minute = from; minute + length <= until; minute += length) {
    const overlapsBreak = pauseFrom !== null && pauseUntil !== null && minute < pauseUntil && minute + length > pauseFrom;
    if (!overlapsBreak) hours.push(`${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`);
  }
  return hours;
}

async function upsertSlots(rows: Record<string, unknown>[]) {
  for (let offset = 0; offset < rows.length; offset += 300) {
    await db("slots", "POST", { on_conflict: "provider_id,day,hour" }, rows.slice(offset, offset + 300), "resolution=merge-duplicates,return=minimal");
  }
}

async function uploadProviderImage(providerId: number, kind: string, dataUrl: string) {
  if (!SUPABASE_URL || !SERVICE_KEY) fail(503, "O armazenamento de imagens não está configurado.");
  if (!["profile", "service"].includes(kind)) fail(400, "Tipo de imagem inválido.");
  const match = dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) fail(400, "Envie uma imagem JPG, PNG ou WebP.");
  const mime = match[1], raw = atob(match[2]);
  if (raw.length > 4 * 1024 * 1024) fail(400, "A imagem precisa ter até 4 MB após a otimização.");
  const bytes = Uint8Array.from(raw, (char) => char.charCodeAt(0));
  const validSignature = mime === "image/png"
    ? bytes.length > 8 && [137,80,78,71,13,10,26,10].every((value, index) => bytes[index] === value)
    : mime === "image/jpeg"
      ? bytes.length > 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      : bytes.length > 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  if (!validSignature) fail(400, "O arquivo não corresponde a uma imagem válida.");
  const extension = mime === "image/jpeg" ? "jpg" : mime === "image/png" ? "png" : "webp";
  const objectPath = `${providerId}/${kind}/${crypto.randomUUID()}.${extension}`;
  const url = new URL(`/storage/v1/object/conectaelas-images/${objectPath}`, SUPABASE_URL);
  const result = await fetch(url, { method: "POST", headers: {
    apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, "content-type": mime, "x-upsert": "false",
  }, body: bytes });
  if (!result.ok) {
    console.error("Supabase image upload error", result.status);
    fail(500, "Não foi possível carregar a imagem. Tente novamente.");
  }
  return `${SUPABASE_URL}/storage/v1/object/public/conectaelas-images/${objectPath}`;
}

async function handle(req: Request) {
  const url = new URL(req.url);
  const action = url.searchParams.get("a") ?? "";
  let input: any = {};
  if (req.method !== "GET" && req.method !== "OPTIONS") {
    try { input = await req.json(); } catch { input = {}; }
  }
  switch (action) {
    case "cats": {
      const rows = await get("categories", { select: "name", order: "name.asc" });
      return rows.map((r: any) => r.name);
    }
    case "register": {
      const role = input.role === "provider" ? "provider" : "client";
      const email = bodyString(input, "email").toLowerCase();
      const name = bodyString(input, "name"), password = String(input.password ?? ""), whatsapp = bodyString(input, "whatsapp");
      if (!name || !/^\S+@\S+\.\S+$/.test(email) || password.length < 6 || !whatsapp) fail(400, "Preencha nome, e-mail válido, WhatsApp e senha (mín. 6 caracteres).");
      if (first(await get("users", { select: "id", email: `eq.${email}`, limit: "1" }))) fail(400, "E-mail já cadastrado");
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const pass = await hashPassword(password, toHex(salt));
      const u = first(await post("users", { role, name, email, pass, whatsapp }));
      if (role === "provider") {
        const founderCandidates = await get("users", {
          select: "id",
          role: "eq.provider",
          is_demo: "eq.false",
          created: `gte.${FOUNDER_CAMPAIGN_STARTED_AT}`,
          order: "created.asc",
          limit: String(FOUNDER_LIMIT),
        });
        await post("providers", {
          user_id: u.id,
          category: bodyString(input, "category"),
          state: bodyString(input, "state").toUpperCase(),
          city: bodyString(input, "city"),
          is_founder: founderCandidates.length < FOUNDER_LIMIT,
        });
      }
      const user = { id: u.id, role: u.role, name: u.name };
      return { token: await makeToken(user), user };
    }
    case "login": {
      const email = bodyString(input, "email").toLowerCase();
      const password = String(input.password ?? "");
      const u = first(await get("users", { select: "id,role,name,pass", email: `eq.${email}`, limit: "1" }));
      const supplied = u?.pass ?? "";
      const valid = u ? await verifyPassword(password, supplied) : false;
      if (!valid) fail(401, "E-mail ou senha inválidos");
      const user = { id: u.id, role: u.role, name: u.name };
      return { token: await makeToken(user), user };
    }
    case "providers": {
      const category = url.searchParams.get("cat") ?? "", state = (url.searchParams.get("state") ?? "").toUpperCase(), city = (url.searchParams.get("city") ?? "").toLocaleLowerCase(), query = (url.searchParams.get("q") ?? "").toLocaleLowerCase();
      const maxPriceText = url.searchParams.get("max_price") ?? "", maxPrice = maxPriceText === "" ? null : Number(maxPriceText);
      const sort = url.searchParams.get("sort") ?? "price_asc";
      const [users, profiles, services, reviews] = await Promise.all([
        get("users", { select: "id,name,is_demo", role: "eq.provider", order: "id.desc", limit: "200" }),
        get("providers", { select: "user_id,category,logo,state,city,bio,is_founder" }),
        get("services", { select: "id,provider_id,title,price,images", order: "id.asc" }),
        get("reviews", { select: "provider_id,rating" }),
      ]);
      const result = users.map((u: any) => {
        const p = profiles.find((x: any) => Number(x.user_id) === Number(u.id));
        const own = services.filter((x: any) => Number(x.provider_id) === Number(u.id));
        const ownReviews = reviews.filter((x: any) => Number(x.provider_id) === Number(u.id));
        return { id: u.id, name: u.name, is_demo: Boolean(u.is_demo), is_founder: Boolean(p?.is_founder), category: p?.category, logo: p?.logo, state: p?.state, city: p?.city, min_price: own.length ? Math.min(...own.map((x: any) => Number(x.price))) : null, img: own[0]?.images, ...ratingSummary(ownReviews) };
      }).filter((p: any) => p.category && (!category || p.category === category) && (!state || p.state === state) && (!city || String(p.city ?? "").toLocaleLowerCase().includes(city)) && (!query || [p.name,p.category,p.state,p.city].some(v => String(v ?? "").toLocaleLowerCase().includes(query)) || services.some((s: any) => Number(s.provider_id) === Number(p.id) && String(s.title).toLocaleLowerCase().includes(query))))
        .filter((p: any) => maxPrice === null || (Number.isFinite(maxPrice) && p.min_price !== null && p.min_price <= maxPrice))
        .sort((a: any, b: any) => {
          if (sort === "price_desc") return (b.min_price ?? -1) - (a.min_price ?? -1) || Number(b.id) - Number(a.id);
          if (sort === "recent") return Number(b.id) - Number(a.id);
          return (a.min_price ?? Number.POSITIVE_INFINITY) - (b.min_price ?? Number.POSITIVE_INFINITY) || Number(b.id) - Number(a.id);
        }).slice(0, 60);
      return result;
    }
    case "provider": {
      const id = Number(url.searchParams.get("id") ?? 0);
      const [u, p, reviews] = await Promise.all([
        get("users", { select: "id,name,whatsapp,is_demo", id: idFilter(id), role: "eq.provider", limit: "1" }),
        get("providers", { select: "category,bio,logo,state,city,instagram_url,is_founder", user_id: idFilter(id), limit: "1" }),
        get("reviews", { select: "id,rating,comment,created,client_id", provider_id: idFilter(id), order: "created.desc", limit: "50" }),
      ]);
      if (!u.length || !p.length) fail(404, "Não encontrado");
      const today = saoPauloNow().day;
      const [services, slots] = await Promise.all([
        get("services", { select: "*", provider_id: idFilter(id), order: "id.desc" }),
        get("slots", { select: "id,day,hour", provider_id: idFilter(id), booked: "eq.false", available: "eq.true", day: `gte.${today}`, order: "day.asc,hour.asc", limit: "500" }),
      ]);
      const reviewPeople = await relatedUsers(reviews.map((review: any) => Number(review.client_id)));
      const reviewList = reviews.map((review: any) => ({ ...review, client_name: reviewPeople.find((person: any) => Number(person.id) === Number(review.client_id))?.name || "Cliente" }));
      return { ...u[0], ...p[0], services, slots, reviews: reviewList, ...ratingSummary(reviews) };
    }
    case "my_profile": {
      const me = await auth(req, ["provider"]);
      const [u,p] = await Promise.all([
        get("users", { select: "name,whatsapp", id: idFilter(me.id), limit: "1" }),
        get("providers", { select: "category,bio,logo,state,city,instagram_url,weekly_schedule", user_id: idFilter(me.id), limit: "1" }),
      ]);
      return { ...(u[0] ?? {}), ...(p[0] ?? {}) };
    }
    case "profile_save": {
      const me = await auth(req, ["provider"]);
      let instagramUrl = bodyString(input, "instagram_url");
      if (instagramUrl) {
        if (/^@?[A-Za-z0-9._]{1,30}$/.test(instagramUrl)) instagramUrl = `https://www.instagram.com/${instagramUrl.replace(/^@/, "")}/`;
        try {
          const parsed = new URL(instagramUrl);
          if (parsed.protocol !== "https:" || !["instagram.com", "www.instagram.com"].includes(parsed.hostname) || parsed.username || parsed.password)
            fail(400, "Informe um link válido do Instagram.");
          instagramUrl = `https://www.instagram.com${parsed.pathname.replace(/\/$/, "")}/`;
        } catch (error) {
          if (error instanceof ApiError) throw error;
          fail(400, "Informe um link válido do Instagram.");
        }
      }
      await patch("users", { id: idFilter(me.id) }, { name: bodyString(input,"name"), whatsapp: bodyString(input,"whatsapp") });
      await patch("providers", { user_id: idFilter(me.id) }, { category: bodyString(input,"category"), bio: bodyString(input,"bio"), logo: bodyString(input,"logo"), state: bodyString(input,"state").toUpperCase(), city: bodyString(input,"city"), instagram_url: instagramUrl });
      return { ok: 1 };
    }
    case "image_upload": {
      const me = await auth(req, ["provider"]);
      return { url: await uploadProviderImage(me.id, bodyString(input, "kind"), String(input.data_url ?? "")) };
    }
    case "service_save": {
      const me = await auth(req, ["provider"]);
      const title = bodyString(input,"title"), price = Number(input.price), descr = bodyString(input,"descr");
      if (!title || title.length > 160 || String(input.price ?? "").trim() === "" || !Number.isFinite(price) || price < 0) fail(400, "Informe título e valor válido.");
      if (descr.length > 4000) fail(400, "A descrição do serviço deve ter no máximo 4.000 caracteres.");
      const images = (Array.isArray(input.images) ? input.images : String(input.images ?? "").split("\n"))
        .map((image: unknown) => String(image).trim()).filter((image: string) => /^https:\/\//.test(image)).slice(0, 4);
      if (input.id !== undefined && input.id !== null && String(input.id).trim()) {
        const id = Number(input.id);
        if (!Number.isSafeInteger(id) || id < 1) fail(400, "Serviço inválido.");
        const existing = first(await get("services", { select: "id,images", id: idFilter(id), provider_id: idFilter(me.id), limit: "1" }));
        if (!existing) fail(404, "Serviço não encontrado.");
        let savedImages: any = images;
        if (!images.length) {
          try { savedImages = Array.isArray(existing.images) ? existing.images : JSON.parse(String(existing.images || "[]")); }
          catch { savedImages = []; }
        }
        if (!Array.isArray(savedImages)) savedImages = [];
        await patch("services", { id: idFilter(id), provider_id: idFilter(me.id) }, { title, descr, price, images: JSON.stringify(savedImages.slice(0, 4)) });
      } else {
        await post("services", { provider_id: me.id, title, descr, price, images: JSON.stringify(images) });
      }
      return { ok: 1 };
    }
    case "service_del": {
      const me = await auth(req, ["provider"]);
      await del("services", { id: idFilter(input.id), provider_id: idFilter(me.id) });
      return { ok: 1 };
    }
    case "schedule_save": {
      const me = await auth(req, ["provider"]), supplied = input.schedule;
      if (!supplied || typeof supplied !== "object" || Array.isArray(supplied)) fail(400, "Informe o expediente semanal.");
      const schedule: Record<string, any> = {};
      for (let day = 0; day < 7; day++) {
        const entry = supplied[String(day)] ?? {};
        const active = Boolean(entry.active);
        const suppliedTimes: unknown[] = Array.isArray(entry.times) ? entry.times : [];
        const times: string[] = [...new Set<string>(suppliedTimes.map((value) => String(value).trim()))].sort();
        if (times.some((hour: string) => timeToMinutes(hour) === null)) fail(400, `Informe horários válidos para ${["domingo","segunda-feira","terça-feira","quarta-feira","quinta-feira","sexta-feira","sábado"][day]}.`);
        if (active && !times.length) fail(400, `Adicione ao menos um horário para ${["domingo","segunda-feira","terça-feira","quarta-feira","quinta-feira","sexta-feira","sábado"][day]}.`);
        schedule[String(day)] = { active, times };
      }
      await patch("providers", { user_id: idFilter(me.id) }, { weekly_schedule: schedule });
      const now = saoPauloNow(), firstDay = new Date(`${now.day}T12:00:00Z`), rows: Record<string, unknown>[] = [];
      for (let offset = 0; offset < 60; offset++) {
        const date = new Date(firstDay.getTime() + offset * 86400000), day = date.toISOString().slice(0, 10);
        const entry = schedule[String(date.getUTCDay())];
        if (!entry.active) continue;
        for (const hour of entry.times) {
          const minute = timeToMinutes(hour)!;
          if (day === now.day && minute <= now.minutes) continue;
          rows.push({ provider_id: me.id, day, hour, available: true, schedule_managed: true });
        }
      }
      await patch("slots", { provider_id: idFilter(me.id), day: `gte.${now.day}`, schedule_managed: "eq.true" }, { available: false });
      await upsertSlots(rows);
      return { ok: 1, generated: rows.length };
    }
    case "slot_generate": {
      const me = await auth(req, ["provider"]), day = bodyString(input, "day"), now = saoPauloNow();
      if (!validISODate(day) || day < now.day) fail(400, "Escolha uma data de hoje em diante.");
      const hours = makeHours(input.start, input.end, input.duration);
      const futureHours = hours.filter((hour) => day !== now.day || timeToMinutes(hour)! > now.minutes);
      if (!futureHours.length) fail(400, "Não há horários futuros nesse intervalo.");
      await upsertSlots(futureHours.map((hour) => ({ provider_id: me.id, day, hour, available: true, schedule_managed: false })));
      return { ok: 1, generated: futureHours.length };
    }
    case "slot_add": {
      const me = await auth(req, ["provider"]), day = bodyString(input,"day"), now = saoPauloNow();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day < now.day) fail(400, "Escolha uma data de hoje em diante.");
      const rawHours: unknown[] = Array.isArray(input.hours) ? input.hours : [];
      const hours: string[] = [...new Set<string>(rawHours.map((value) => String(value).trim()))].sort();
      if (!hours.length || hours.some((hour) => timeToMinutes(hour) === null)) fail(400, "Informe ao menos um horário válido.");
      const futureHours = hours.filter((hour) => day !== now.day || timeToMinutes(hour)! > now.minutes);
      if (!futureHours.length) fail(400, "Não há horários futuros nessa data.");
      await upsertSlots(futureHours.map((hour) => ({ provider_id: me.id, day, hour, available: true, schedule_managed: false })));
      return { ok: 1, generated: futureHours.length };
    }
    case "my_slots": {
      const me = await auth(req, ["provider"]), today = saoPauloNow().day;
      return await get("slots", { select: "id,day,hour,booked,available", provider_id: idFilter(me.id), day: `gte.${today}`, or: "(available.eq.true,booked.eq.true)", order: "day.asc,hour.asc", limit: "1000" });
    }
    case "slot_del": {
      const me = await auth(req, ["provider"]);
      await patch("slots", { id: idFilter(input.id), provider_id: idFilter(me.id), booked: "eq.false" }, { available: false });
      return { ok: 1 };
    }
    case "book": {
      const me = await auth(req, ["client"]);
      const sl = first(await get("slots", { select: "id,provider_id", id: idFilter(input.slot_id), booked: "eq.false", available: "eq.true", limit: "1" }));
      if (!sl) fail(400, "Horário indisponível");
      const owner = first(await get("users", { select: "is_demo", id: idFilter(sl.provider_id), role: "eq.provider", limit: "1" }));
      if (owner?.is_demo) fail(400, "Este perfil demonstrativo não aceita agendamentos.");
      const sv = first(await get("services", { select: "id", id: idFilter(input.service_id), provider_id: idFilter(sl.provider_id), limit: "1" }));
      if (!sv) fail(400, "Horário indisponível");
      const booked = await patch("slots", { id: idFilter(sl.id), booked: "eq.false", available: "eq.true" }, { booked: true });
      if (!booked.length) fail(400, "Horário acabou de ser reservado");
      await post("bookings", { slot_id: sl.id, service_id: sv.id, client_id: me.id, provider_id: sl.provider_id });
      return { ok: 1 };
    }
    case "manual_book": {
      const me = await auth(req, ["provider"]);
      const name = bodyString(input, "name"), whatsapp = bodyString(input, "whatsapp");
      if (!name || name.length > 120 || whatsapp.replace(/\D/g, "").length < 8 || whatsapp.length > 30)
        fail(400, "Informe o nome e um WhatsApp válido da cliente.");
      const owner = first(await get("users", { select: "is_demo", id: idFilter(me.id), role: "eq.provider", limit: "1" }));
      if (owner?.is_demo) fail(400, "Perfis demonstrativos não aceitam agendamentos.");
      const sl = first(await get("slots", { select: "id,provider_id", id: idFilter(input.slot_id), provider_id: idFilter(me.id), booked: "eq.false", available: "eq.true", limit: "1" }));
      if (!sl) fail(400, "Esse horário não está mais disponível.");
      const sv = first(await get("services", { select: "id", id: idFilter(input.service_id), provider_id: idFilter(me.id), limit: "1" }));
      if (!sv) fail(400, "Escolha um serviço seu.");
      const updated = await patch("slots", { id: idFilter(sl.id), provider_id: idFilter(me.id), booked: "eq.false", available: "eq.true" }, { booked: true });
      if (!updated.length) fail(400, "Esse horário acabou de ser reservado.");
      await post("bookings", { slot_id: sl.id, service_id: sv.id, client_id: null, provider_id: me.id, manual_client_name: name, manual_client_whatsapp: whatsapp });
      return { ok: 1 };
    }
    case "payments": {
      const me = await auth(req, ["provider"]);
      const rows = await get("provider_payments", { select: "id,client_name,description,amount,method,paid_on,created_at", provider_id: idFilter(me.id), order: "paid_on.desc,created_at.desc", limit: "1000" });
      const paymentMethods: Record<string, string> = { pix: "pix", dinheiro: "dinheiro", cartao_credito: "credito", cartao_debito: "debito", transferencia: "transferencia", outro: "outro" };
      return rows.map((payment: any) => ({ ...payment, payment_method: paymentMethods[String(payment.method)] || "outro", created: payment.created_at }));
    }
    case "payment_add": {
      const me = await auth(req, ["provider"]);
      const amount = Number(input.amount), paidOn = bodyString(input, "paid_on") || saoPauloNow().day;
      const method = bodyString(input, "payment_method");
      const paymentMethods: Record<string, string> = { pix: "pix", dinheiro: "dinheiro", credito: "cartao_credito", debito: "cartao_debito", transferencia: "transferencia", outro: "outro" };
      const description = bodyString(input, "description") || bodyString(input, "service_title");
      const validMethods = ["pix", "dinheiro", "credito", "debito", "transferencia", "outro"];
      if (!Number.isFinite(amount) || amount <= 0 || amount > 99999999.99) fail(400, "Informe um valor recebido válido.");
      if (!validISODate(paidOn) || paidOn > saoPauloNow().day) fail(400, "Informe uma data de recebimento válida.");
      if (!validMethods.includes(method)) fail(400, "Selecione uma forma de pagamento válida.");
      const clientName = bodyString(input, "client_name");
      if (clientName.length > 120 || description.length > 200) fail(400, "Confira o tamanho dos campos do lançamento.");
      await post("provider_payments", { provider_id: me.id, client_name: clientName, description, amount, method: paymentMethods[method], paid_on: paidOn });
      return { ok: 1 };
    }
    case "bookings": {
      const me = await auth(req, ["client","provider"]), client = me.role === "client";
      const rows = await get("bookings", { select: "id,status,slot_id,service_id,client_id,provider_id,manual_client_name,manual_client_whatsapp", [client ? "client_id" : "provider_id"]: idFilter(me.id), order: "created.desc", limit: "200" });
      const [slots, services, people, reviews] = await Promise.all([
        relatedSlots([...new Set<number>(rows.map((r: any) => Number(r.slot_id)))]),
        relatedServices([...new Set<number>(rows.map((r: any) => Number(r.service_id)))]),
        relatedUsers([...new Set<number>(rows.map((r: any) => Number(client ? r.provider_id : r.client_id))) ]),
        client ? get("reviews", { select: "booking_id,rating", client_id: idFilter(me.id) }) : Promise.resolve([]),
      ]);
      await completeExpiredBookings(rows, slots);
      return rows.map((b: any) => {
        const sl = slots.find((x: any) => Number(x.id) === Number(b.slot_id));
        const sv = services.find((x: any) => Number(x.id) === Number(b.service_id));
        const other = people.find((x: any) => Number(x.id) === Number(client ? b.provider_id : b.client_id));
        const reviewed = reviews.some((review: any) => Number(review.booking_id) === Number(b.id));
        return { id: b.id, status: b.status, day: sl?.day, hour: sl?.hour, title: sv?.title, price: sv?.price, provider_id: b.provider_id, other_name: other?.name ?? b.manual_client_name, other_whatsapp: other?.whatsapp ?? b.manual_client_whatsapp, reviewed, can_review: client && b.status === "concluido" && !reviewed };
      }).sort((a: any,b: any) => `${b.day} ${b.hour}`.localeCompare(`${a.day} ${a.hour}`));
    }
    case "booking_status": {
      const me = await auth(req, ["client","provider"]), status = ["confirmado","cancelado"].includes(input.status) ? input.status : "pendente";
      const client = me.role === "client";
      if (client && status !== "cancelado") fail(403, "Sem permissão");
      const b = first(await get("bookings", { select: "slot_id", id: idFilter(input.id), [client ? "client_id" : "provider_id"]: idFilter(me.id), limit: "1" }));
      if (b) {
        await patch("bookings", { id: idFilter(input.id), [client ? "client_id" : "provider_id"]: idFilter(me.id) }, { status });
        if (status === "cancelado") await patch("slots", { id: idFilter(b.slot_id) }, { booked: false });
      }
      return { ok: 1 };
    }
    case "review_add": {
      const me = await auth(req, ["client"]);
      const rating = Number(input.rating), comment = bodyString(input, "comment").slice(0, 500);
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) fail(400, "A nota precisa ser um número inteiro de 1 a 5.");
      const booking = first(await get("bookings", { select: "id,status,slot_id,provider_id", id: idFilter(input.booking_id), client_id: idFilter(me.id), limit: "1" }));
      if (!booking) fail(404, "Agendamento não encontrado.");
      const slot = first(await get("slots", { select: "day,hour", id: idFilter(booking.slot_id), limit: "1" }));
      if (booking.status === "confirmado" && appointmentPassed(slot?.day, slot?.hour)) {
        await patch("bookings", { id: idFilter(booking.id), status: "eq.confirmado" }, { status: "concluido" });
        booking.status = "concluido";
      }
      if (booking.status !== "concluido") fail(400, "A avaliação ficará disponível após o horário do atendimento.");
      if (first(await get("reviews", { select: "id", booking_id: idFilter(booking.id), limit: "1" }))) fail(400, "Este atendimento já foi avaliado.");
      await post("reviews", { booking_id: booking.id, client_id: me.id, provider_id: booking.provider_id, rating, comment });
      return { ok: 1 };
    }
    case "admin_users": {
      await auth(req,["admin"]);
      const [users, providers] = await Promise.all([
        get("users", { select: "id,role,name,email,whatsapp,created,is_demo", role: "neq.admin", order: "id.desc" }),
        get("providers", { select: "user_id,category,state,city" }),
      ]);
      return users.map((u: any) => ({ ...u, ...(providers.find((p: any) => Number(p.user_id) === Number(u.id)) ?? {}) }));
    }
    case "admin_password_change": {
      const me = await auth(req, ["admin"]);
      const currentPassword = String(input.current_password ?? "");
      const newPassword = String(input.new_password ?? "");
      const confirmation = String(input.confirm_password ?? "");
      if (newPassword.length < 8) fail(400, "A nova senha precisa ter pelo menos 8 caracteres.");
      if (newPassword !== confirmation) fail(400, "A confirmação da nova senha não confere.");
      const account = first(await get("users", { select: "id,pass", id: idFilter(me.id), role: "eq.admin", limit: "1" }));
      if (!account || !(await verifyPassword(currentPassword, account.pass))) fail(401, "A senha atual está incorreta.");
      const salt = crypto.getRandomValues(new Uint8Array(16));
      await patch("users", { id: idFilter(me.id), role: "eq.admin" }, { pass: await hashPassword(newPassword, toHex(salt)) });
      return { ok: 1 };
    }
    case "admin_user_del": {
      await auth(req,["admin"]);
      await del("users", { id: idFilter(input.id), role: "neq.admin" });
      return { ok: 1 };
    }
    case "admin_demo_del": {
      await auth(req,["admin"]);
      await del("users", { id: idFilter(input.id), role: "eq.provider", is_demo: "eq.true" });
      return { ok: 1 };
    }
    case "admin_cat_add": {
      await auth(req,["admin"]);
      const name = bodyString(input,"name"); if (!name) fail(400,"Informe o nome da categoria.");
      await db("categories", "POST", { on_conflict: "name" }, { name }, "resolution=ignore-duplicates,return=minimal");
      return { ok: 1 };
    }
    case "admin_cat_del": {
      await auth(req,["admin"]);
      await del("categories", { name: `eq.${bodyString(input,"name")}` });
      return { ok: 1 };
    }
    case "admin_bookings": {
      await auth(req,["admin"]);
      const rows = await get("bookings", { select: "id,status,slot_id,service_id,client_id,provider_id,manual_client_name", order: "id.desc", limit: "100" });
      const [slots, services, people] = await Promise.all([
        relatedSlots([...new Set<number>(rows.map((r: any) => Number(r.slot_id)))]),
        relatedServices([...new Set<number>(rows.map((r: any) => Number(r.service_id)))]),
        relatedUsers([...new Set<number>(rows.flatMap((r: any) => [Number(r.client_id),Number(r.provider_id)]))]),
      ]);
      await completeExpiredBookings(rows, slots);
      return rows.map((b: any) => ({ id:b.id, status:b.status, day:slots.find((x:any)=>Number(x.id)===Number(b.slot_id))?.day, hour:slots.find((x:any)=>Number(x.id)===Number(b.slot_id))?.hour, title:services.find((x:any)=>Number(x.id)===Number(b.service_id))?.title, client:people.find((x:any)=>Number(x.id)===Number(b.client_id))?.name ?? b.manual_client_name, provider:people.find((x:any)=>Number(x.id)===Number(b.provider_id))?.name }));
    }
    default: fail(404, "Ação inválida");
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return response({ ok: true });
  try {
    if (!SERVICE_KEY || !SUPABASE_URL) fail(503, "A configuração segura do banco Supabase está indisponível.");
    if (PUBLIC_KEY && !safeEq(req.headers.get("apikey") ?? "", PUBLIC_KEY)) fail(401, "Chave pública inválida.");
    return response(await handle(req));
  } catch (e) {
    if (e instanceof ApiError) return response({ error: e.message }, e.status);
    console.error("Conecta Ela's Edge Function error", e instanceof Error ? e.name : "UnknownError");
    return response({ error: "Erro interno do servidor." }, 500);
  }
});
