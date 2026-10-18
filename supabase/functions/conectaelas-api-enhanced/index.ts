import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
const SERVICE_KEY = secretKeys.default ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const publicKeys = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "{}");
const PUBLIC_KEY = publicKeys.default ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const API_URL = `${SUPABASE_URL}/functions/v1/conectaelas-api`;
const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type, apikey, x-token",
  "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "cache-control": "no-store",
};

class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
function fail(status: number, message: string): never { throw new ApiError(status, message); }
function response(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS_HEADERS, "content-type": "application/json; charset=utf-8" } });
}
function bodyString(body: any, key: string) { return String(body?.[key] ?? "").trim(); }

const BRAZIL_STATES = new Set(["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"]);
function normalizeClientLocation(input: any) {
  const state = bodyString(input, "state").toUpperCase();
  const city = bodyString(input, "city");
  if (state && !BRAZIL_STATES.has(state)) fail(400, "Selecione um estado válido.");
  if (city.length > 80) fail(400, "A cidade deve ter no máximo 80 caracteres.");
  if (city && !state) fail(400, "Selecione o estado para informar a cidade.");
  return { state, city };
}

async function db(table: string, method = "GET", params: Record<string, string> = {}, payload?: unknown) {
  if (!SUPABASE_URL || !SERVICE_KEY) fail(503, "A configuração segura do banco Supabase está indisponível.");
  const url = new URL(`/rest/v1/${table}`, SUPABASE_URL);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const headers: Record<string, string> = { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, accept: "application/json" };
  if (payload !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(url, { method, headers, body: payload === undefined ? undefined : JSON.stringify(payload) });
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    console.error("ConectaFemme enhanced API database error", res.status);
    fail(500, "Não foi possível concluir a operação no ConectaFemme.");
  }
  return data;
}

async function validateSpecialties(input: any): Promise<string[]> {
  const primary = bodyString(input, "category");
  if (!primary) fail(400, "Selecione uma especialidade principal.");
  const raw = Array.isArray(input?.specialties) ? input.specialties : [primary];
  const specialties: string[] = raw.map((value: unknown) => String(value ?? "").trim()).filter(Boolean);
  if (!specialties.length || specialties.length > 2 || specialties[0] !== primary)
    fail(400, "Escolha uma especialidade principal e, se desejar, uma segunda.");
  if (new Set(specialties).size !== specialties.length)
    fail(400, "Escolha duas especialidades diferentes.");
  const rows = await db("categories", "GET", { select: "name", limit: "100" });
  const available = new Set((Array.isArray(rows) ? rows : []).map((row: any) => String(row.name)));
  if (specialties.some((specialty) => !available.has(specialty)))
    fail(400, "Selecione especialidades disponíveis na lista.");
  return specialties;
}

function tokenUserId(token: string): number {
  try {
    const payload = token.split(".")[0];
    const data = JSON.parse(atob(payload));
    const id = Number(data.id);
    if (!Number.isSafeInteger(id) || id < 1) throw new Error("invalid id");
    return id;
  } catch {
    fail(401, "Sessão inválida.");
  }
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
async function signature(payload: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SERVICE_KEY), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function authenticatedClient(token: string) {
  const parts = token.split(".");
  const [payload, sig] = parts;
  if (parts.length !== 2) fail(401, "Faça login novamente.");
  if (!payload || !sig || !safeEqual(await signature(payload), sig)) fail(401, "Faça login novamente.");
  let user: any;
  try { user = JSON.parse(atob(payload)); } catch { fail(401, "Sessão inválida."); }
  if (!Number.isSafeInteger(Number(user.id)) || !Number.isFinite(Number(user.exp)) || Number(user.exp) < Math.floor(Date.now() / 1000)) fail(401, "Sessão expirada.");
  if (user.role !== "client") fail(403, "Esta ação está disponível apenas para clientes.");
  return { id: Number(user.id), role: "client" };
}

async function providerRows(ids: number[]) {
  const safeIds = [...new Set(ids.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))];
  if (!safeIds.length) return [];
  return await db("providers", "GET", {
    select: "user_id,category,specialties",
    user_id: `in.(${safeIds.join(",")})`,
    limit: String(safeIds.length),
  });
}

async function saveSpecialties(userId: number, specialties: string[]) {
  const rows = await db("providers", "PATCH", { user_id: `eq.${userId}` }, {
    category: specialties[0],
    specialties,
  });
  if (Array.isArray(rows) && rows.length === 0) fail(404, "Perfil profissional não encontrado.");
}

async function saveClientLocation(userId: number, location: { state: string; city: string }) {
  await db("users", "PATCH", { id: `eq.${userId}`, role: "eq.client" }, location);
}

function withSpecialties<T extends Record<string, any>>(records: T[], rows: any[]) {
  const byId = new Map((Array.isArray(rows) ? rows : []).map((row: any) => [Number(row.user_id), row]));
  return records.map((record) => {
    const id = Number(record.id ?? record.user_id);
    const profile = byId.get(id);
    const saved = Array.isArray(profile?.specialties) && profile.specialties.length
      ? profile.specialties
      : [profile?.category ?? record.category].filter(Boolean);
    const specialties = [...new Set(saved.map((value: unknown) => String(value).trim()).filter(Boolean))].slice(0, 2);
    return { ...record, category: profile?.category ?? record.category ?? specialties[0], specialties };
  });
}

async function handle(req: Request) {
  if (req.method === "OPTIONS") return response({ ok: true });
  if (!SUPABASE_URL || !SERVICE_KEY) fail(503, "A configuração segura do banco Supabase está indisponível.");
  const apiKey = req.headers.get("apikey") ?? "";
  if (PUBLIC_KEY && apiKey !== PUBLIC_KEY) fail(401, "Chave pública inválida.");

  const incomingUrl = new URL(req.url);
  const action = incomingUrl.searchParams.get("a") ?? "";
  const rawBody = ["GET", "HEAD"].includes(req.method) ? undefined : await req.text();
  let input: any = {};
  if (rawBody) {
    try { input = JSON.parse(rawBody); } catch { input = {}; }
  }

  if (action === "client_location") {
    const client = await authenticatedClient(req.headers.get("x-token") ?? "");
    if (req.method === "GET") {
      const rows = await db("users", "GET", { select: "state,city", id: `eq.${client.id}`, role: "eq.client", limit: "1" });
      return response(Array.isArray(rows) && rows[0] ? rows[0] : { state: "", city: "" });
    }
    if (req.method !== "POST") fail(405, "Método não permitido.");
    const location = normalizeClientLocation(input);
    await saveClientLocation(client.id, location);
    return response({ ok: true, ...location });
  }

  let specialties: string[] | null = null;
  if ((action === "register" && input.role === "provider") || action === "profile_save")
    specialties = await validateSpecialties(input);
  const clientLocation = action === "register" && input.role === "client" ? normalizeClientLocation(input) : null;

  const upstreamUrl = new URL(API_URL);
  upstreamUrl.search = incomingUrl.search;
  const requestedCategory = action === "providers" ? incomingUrl.searchParams.get("cat") ?? "" : "";
  if (requestedCategory) upstreamUrl.searchParams.set("cat", "");
  const upstreamHeaders: Record<string, string> = { apikey: apiKey };
  const token = req.headers.get("x-token") ?? "";
  if (token) upstreamHeaders["x-token"] = token;
  const contentType = req.headers.get("content-type");
  if (contentType) upstreamHeaders["content-type"] = contentType;

  const upstream = await fetch(upstreamUrl, {
    method: req.method,
    headers: upstreamHeaders,
    body: rawBody,
  });
  const upstreamText = await upstream.text();
  let data: any;
  try { data = upstreamText ? JSON.parse(upstreamText) : null; } catch { data = upstreamText; }
  if (!upstream.ok) return response(data, upstream.status);

  if (action === "register" && clientLocation && data?.user?.role === "client" && data?.token) {
    await saveClientLocation(tokenUserId(String(data.token)), clientLocation);
  } else if (action === "register" && specialties && data?.user?.role === "provider" && data?.token) {
    await saveSpecialties(tokenUserId(String(data.token)), specialties);
  } else if (action === "profile_save" && specialties) {
    await saveSpecialties(tokenUserId(token), specialties);
  } else if (action === "providers" && Array.isArray(data)) {
    const rows = await providerRows(data.map((record: any) => Number(record.id)));
    data = withSpecialties(data, rows);
    if (requestedCategory) data = data.filter((record: any) => record.specialties.includes(requestedCategory));
  } else if (action === "provider" && data && typeof data === "object") {
    const id = Number(incomingUrl.searchParams.get("id"));
    data = withSpecialties([data], await providerRows([id]))[0];
  } else if (action === "my_profile" && data && typeof data === "object") {
    data = withSpecialties([data], await providerRows([tokenUserId(token)]))[0];
  } else if (action === "admin_users" && Array.isArray(data)) {
    const clientIds = data.filter((record: any) => record.role === "client").map((record: any) => Number(record.id));
    if (clientIds.length) {
      const locations = await db("users", "GET", {
        select: "id,state,city",
        id: `in.(${clientIds.join(",")})`,
        role: "eq.client",
        limit: String(clientIds.length),
      });
      const byId = new Map((Array.isArray(locations) ? locations : []).map((row: any) => [Number(row.id), row]));
      data = data.map((record: any) => record.role === "client"
        ? { ...record, state: byId.get(Number(record.id))?.state ?? "", city: byId.get(Number(record.id))?.city ?? "" }
        : record);
    }
    const providerIds = data.filter((record: any) => record.role === "provider").map((record: any) => Number(record.id));
    data = withSpecialties(data, await providerRows(providerIds));
  }
  return response(data, upstream.status);
}

Deno.serve(async (req: Request) => {
  try {
    return await handle(req);
  } catch (error) {
    if (error instanceof ApiError) return response({ error: error.message }, error.status);
    console.error("ConectaFemme specialties proxy error", error instanceof Error ? error.name : "UnknownError");
    return response({ error: "Erro interno do servidor." }, 500);
  }
});
