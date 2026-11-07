import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
const SERVICE_KEY = secretKeys.default ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const publicKeys = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "{}");
const PUBLIC_KEY = publicKeys.default ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const EXISTING_API = `${SUPABASE_URL}/functions/v1/conectaelas-api-enhanced`;
const CONFIRMATION_URL = "https://conectafemme.vercel.app/confirmar-email.html";
const PASSWORD_RECOVERY_URL = "https://conectafemme.vercel.app/recuperar-senha.html";
const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type, apikey, x-token, authorization",
  "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "cache-control": "no-store",
};

class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
function fail(status: number, message: string): never { throw new ApiError(status, message); }
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS_HEADERS, "content-type": "application/json; charset=utf-8" } });
}
function bodyString(body: any, key: string) { return String(body?.[key] ?? "").trim(); }
function toHex(bytes: Uint8Array) { return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join(""); }
async function hashPassword(password: string, saltHex: string) {
  const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map((value) => Number.parseInt(value, 16)));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 310000, hash: "SHA-256" }, key, 256);
  return `pbkdf2:310000:${saltHex}:${toHex(new Uint8Array(bits))}`;
}

async function db(table: string, method = "GET", params: Record<string, string> = {}, payload?: unknown) {
  if (!SUPABASE_URL || !SERVICE_KEY) fail(503, "A configuração segura do banco Supabase está indisponível.");
  const url = new URL(`/rest/v1/${table}`, SUPABASE_URL);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const headers: Record<string, string> = {
    apikey: SERVICE_KEY,
    authorization: `Bearer ${SERVICE_KEY}`,
    accept: "application/json",
  };
  if (payload !== undefined) headers["content-type"] = "application/json";
  const result = await fetch(url, { method, headers, body: payload === undefined ? undefined : JSON.stringify(payload) });
  const text = await result.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!result.ok) {
    console.error("Email gateway database request failed", result.status);
    fail(500, "Não foi possível concluir a operação no ConectaFemme.");
  }
  return data;
}

async function sendConfirmationEmail(email: string): Promise<boolean> {
  const url = new URL("/auth/v1/otp", SUPABASE_URL);
  url.searchParams.set("redirect_to", CONFIRMATION_URL);
  try {
    const result = await fetch(url, {
      method: "POST",
      headers: { apikey: PUBLIC_KEY, "content-type": "application/json" },
      body: JSON.stringify({ email, create_user: true }),
    });
    if (!result.ok) {
      console.error("Supabase confirmation email request failed", result.status);
      return false;
    }
    return true;
  } catch (error) {
    console.error("Supabase confirmation email request failed", error instanceof Error ? error.name : "UnknownError");
    return false;
  }
}

async function sendPasswordRecoveryEmail(email: string): Promise<boolean> {
  const url = new URL("/auth/v1/recover", SUPABASE_URL);
  url.searchParams.set("redirect_to", PASSWORD_RECOVERY_URL);
  try {
    const result = await fetch(url, {
      method: "POST",
      headers: { apikey: PUBLIC_KEY, "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });
    if (!result.ok) {
      console.error("Supabase password recovery request failed", result.status);
      return false;
    }
    return true;
  } catch (error) {
    console.error("Supabase password recovery request failed", error instanceof Error ? error.name : "UnknownError");
    return false;
  }
}

async function proxyToExistingApi(req: Request, incomingUrl: URL, rawBody: string | undefined) {
  const target = new URL(EXISTING_API);
  target.search = incomingUrl.search;
  const headers: Record<string, string> = { apikey: req.headers.get("apikey") ?? PUBLIC_KEY };
  const token = req.headers.get("x-token");
  const contentType = req.headers.get("content-type");
  if (token) headers["x-token"] = token;
  if (contentType) headers["content-type"] = contentType;
  const authorization = req.headers.get("authorization");
  if (authorization) headers.authorization = authorization;
  const upstream = await fetch(target, {
    method: req.method,
    headers,
    body: ["GET", "HEAD", "OPTIONS"].includes(req.method) ? undefined : rawBody,
  });
  const text = await upstream.text();
  const responseHeaders = new Headers(CORS_HEADERS);
  const contentTypeHeader = upstream.headers.get("content-type");
  if (contentTypeHeader) responseHeaders.set("content-type", contentTypeHeader);
  return new Response(text || null, { status: upstream.status, headers: responseHeaders });
}

async function confirmEmail(req: Request) {
  if (req.method !== "POST") fail(405, "Método não permitido.");
  const authorization = req.headers.get("authorization") ?? "";
  const accessToken = authorization.match(/^Bearer\s+(.+)$/i)?.[1] ?? "";
  if (!accessToken) fail(401, "Link de confirmação inválido ou expirado.");
  const authResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: PUBLIC_KEY, authorization: `Bearer ${accessToken}` },
  });
  if (!authResponse.ok) fail(401, "Link de confirmação inválido ou expirado.");
  const authUser: any = await authResponse.json();
  const email = String(authUser?.email ?? "").trim().toLowerCase();
  const confirmedAt = String(authUser?.email_confirmed_at ?? "");
  if (!email || !confirmedAt) fail(400, "Confirme o e-mail pelo link recebido.");
  const accounts = await db("users", "GET", { select: "id,is_demo", email: `eq.${email}`, limit: "1" });
  const account = Array.isArray(accounts) ? accounts[0] : null;
  if (!account || account.is_demo) fail(404, "Cadastro não encontrado.");
  await db("users", "PATCH", { id: `eq.${Number(account.id)}` }, {
    email_confirmed_at: confirmedAt,
    confirmation_required: false,
  });
  return json({ ok: true });
}

async function resetCustomPassword(req: Request, input: any) {
  if (req.method !== "POST") fail(405, "Método não permitido.");
  const authorization = req.headers.get("authorization") ?? "";
  const accessToken = authorization.match(/^Bearer\s+(.+)$/i)?.[1] ?? "";
  if (!accessToken) fail(401, "Link de recuperação inválido ou expirado.");
  const password = String(input?.password ?? "");
  if (password.length < 8 || password.length > 128) fail(400, "A nova senha deve ter entre 8 e 128 caracteres.");

  const authResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: PUBLIC_KEY, authorization: `Bearer ${accessToken}` },
  });
  if (!authResponse.ok) fail(401, "Link de recuperação inválido ou expirado.");
  const authUser: any = await authResponse.json();
  const email = String(authUser?.email ?? "").trim().toLowerCase();
  if (!email) fail(401, "Link de recuperação inválido ou expirado.");

  const accounts = await db("users", "GET", { select: "id,is_demo", email: `eq.${email}`, limit: "1" });
  const account = Array.isArray(accounts) ? accounts[0] : null;
  if (!account || account.is_demo) fail(404, "Cadastro não encontrado.");

  const saltHex = toHex(crypto.getRandomValues(new Uint8Array(16)));
  const passwordHash = await hashPassword(password, saltHex);
  const updates: Record<string, unknown> = { pass: passwordHash };
  const confirmedAt = String(authUser?.email_confirmed_at ?? "");
  if (confirmedAt) {
    updates.email_confirmed_at = confirmedAt;
    updates.confirmation_required = false;
  }
  await db("users", "PATCH", { id: `eq.${Number(account.id)}` }, updates);
  return json({ ok: true });
}

async function handle(req: Request) {
  if (req.method === "OPTIONS") return json({ ok: true });
  if (!SUPABASE_URL || !SERVICE_KEY || !PUBLIC_KEY) fail(503, "A configuração segura do Supabase está incompleta.");
  if (req.headers.get("apikey") !== PUBLIC_KEY) fail(401, "Chave pública inválida.");

  const incomingUrl = new URL(req.url);
  const action = incomingUrl.searchParams.get("a") ?? "";
  const rawBody = ["GET", "HEAD"].includes(req.method) ? undefined : await req.text();
  let input: any = {};
  if (rawBody) {
    try { input = JSON.parse(rawBody); } catch { input = {}; }
  }

  if (action === "confirm_email") return await confirmEmail(req);

  if (action === "request_password_reset") {
    const email = bodyString(input, "email").toLowerCase();
    if (/^\S+@\S+\.\S+$/.test(email)) {
      const accounts = await db("users", "GET", { select: "id,is_demo", email: `eq.${email}`, limit: "1" });
      const account = Array.isArray(accounts) ? accounts[0] : null;
      if (account && !account.is_demo) await sendPasswordRecoveryEmail(email);
    }
    return json({ ok: true });
  }

  if (action === "reset_password") return await resetCustomPassword(req, input);

  if (action === "resend_verification") {
    const email = bodyString(input, "email").toLowerCase();
    if (/^\S+@\S+\.\S+$/.test(email)) {
      const accounts = await db("users", "GET", { select: "id,is_demo", email: `eq.${email}`, limit: "1" });
      const account = Array.isArray(accounts) ? accounts[0] : null;
      if (account && !account.is_demo) await sendConfirmationEmail(email);
    }
    return json({ ok: true });
  }

  const upstreamResponse = await proxyToExistingApi(req, incomingUrl, rawBody);
  if (!upstreamResponse.ok) return upstreamResponse;
  if (!["register", "login"].includes(action)) return upstreamResponse;

  const upstreamText = await upstreamResponse.text();
  let data: any;
  try { data = upstreamText ? JSON.parse(upstreamText) : null; } catch { data = null; }
  if (!data || typeof data !== "object") return json(data, upstreamResponse.status);

  if (action === "register" && data?.user?.id && data?.token) {
    const userId = Number(data.user.id);
    const email = bodyString(input, "email").toLowerCase();
    if (!Number.isSafeInteger(userId) || userId < 1) fail(500, "Não foi possível concluir o cadastro.");
    await db("users", "PATCH", { id: `eq.${userId}` }, { confirmation_required: true });
    const email_sent = /^\S+@\S+\.\S+$/.test(email) ? await sendConfirmationEmail(email) : false;
    return json({ user: data.user, verification_required: true, email_sent }, upstreamResponse.status);
  }

  if (action === "login" && data?.user?.id && ["client", "provider"].includes(String(data.user.role))) {
    const accounts = await db("users", "GET", {
      select: "confirmation_required,email_confirmed_at",
      id: `eq.${Number(data.user.id)}`,
      limit: "1",
    });
    const account = Array.isArray(accounts) ? accounts[0] : null;
    if (account?.confirmation_required && !account.email_confirmed_at)
      return json({ error: "Confirme seu e-mail pelo link enviado para concluir o cadastro. Se não recebeu, use Reenviar confirmação." }, 403);
  }
  return json(data, upstreamResponse.status);
}

Deno.serve(async (req: Request) => {
  try {
    return await handle(req);
  } catch (error) {
    if (error instanceof ApiError) return json({ error: error.message }, error.status);
    console.error("ConectaFemme email gateway error", error instanceof Error ? error.name : "UnknownError");
    return json({ error: "Erro interno do servidor." }, 500);
  }
});
