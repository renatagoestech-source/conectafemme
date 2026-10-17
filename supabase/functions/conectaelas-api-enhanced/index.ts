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
    console.error("ConectaFemme specialties database error", res.status);
    fail(500, "Não foi possível salvar ou carregar as especialidades.");
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

  let specialties: string[] | null = null;
  if ((action === "register" && input.role === "provider") || action === "profile_save")
    specialties = await validateSpecialties(input);

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

  if (action === "register" && specialties && data?.user?.role === "provider" && data?.token) {
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
    const ids = data.filter((record: any) => record.role === "provider").map((record: any) => Number(record.id));
    data = withSpecialties(data, await providerRows(ids));
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
