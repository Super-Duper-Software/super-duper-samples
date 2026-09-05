/**
 * @superduper/token-worker
 *
 * A stateless Cloudflare Worker whose only job is to hold the Freesound OAuth2
 * `client_secret` and perform the two exchanges a public desktop client cannot
 * do for itself (ADR-0004):
 *
 *   POST /exchange  { code, redirect_uri? }  -> Freesound token JSON
 *   POST /refresh   { refresh_token }        -> Freesound token JSON
 *
 * It persists nothing. No KV, no D1, no Durable Objects, no R2, no cache writes.
 * `client_secret` is never placed in a response body, header, or error message,
 * and is never logged.
 *
 * The handler is exported as a plain object so tests can call `worker.fetch()`
 * directly with a mock `env` and a stubbed global `fetch`.
 */

const FREESOUND_TOKEN_ENDPOINT =
  "https://freesound.org/apiv2/oauth2/access_token/";

export interface Env {
  /** OAuth client id (public). Set in wrangler.toml [vars]. */
  FREESOUND_CLIENT_ID: string;
  /** OAuth client secret. Worker secret only: `wrangler secret put FREESOUND_CLIENT_SECRET`. */
  FREESOUND_CLIENT_SECRET: string;
  /** Optional, soft. Comma-separated list of allowed `Origin` header values. */
  ALLOWED_ORIGINS?: string;
  /** Optional, soft. Comma-separated list of `User-Agent` substrings to allow. */
  ALLOWED_USER_AGENTS?: string;
  /** Optional. Per-IP requests per minute for the in-memory limiter. Default 30. */
  RATE_LIMIT_PER_MINUTE?: string;
}

/** Fields we pass through from Freesound's token response. Nothing else is echoed. */
interface FreesoundTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
}

function corsHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    ...extra,
  };
}

function json(
  status: number,
  data: unknown,
  extraHeaders?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(extraHeaders),
    },
  });
}

/**
 * Defensively remove the client secret from any text we forward from upstream.
 * Freesound should never echo the secret, but if it ever did (or echoed the
 * request body in an error), this strips both the literal secret value and any
 * `client_secret=...` / `"client_secret": "..."` token, then caps the length.
 */
function stripSecrets(text: string, secret: string): string {
  let out = text;
  if (secret) {
    out = out.split(secret).join("[redacted]");
  }
  out = out.replace(
    /client_secret["']?\s*[:=]\s*["']?[^"'&,\s}]+/gi,
    "client_secret=[redacted]",
  );
  out = out.replace(/client_secret/gi, "[redacted]");
  return out.slice(0, 500);
}

function parseList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Honour an optional expected Origin / User-Agent allowlist. Soft: if the env
 * vars are unset nothing is enforced. Mismatches are logged and denied.
 */
function checkAbuse(request: Request, env: Env): Response | null {
  const allowedOrigins = parseList(env.ALLOWED_ORIGINS);
  const allowedUserAgents = parseList(env.ALLOWED_USER_AGENTS);

  const origin = request.headers.get("Origin");
  const userAgent = request.headers.get("User-Agent") ?? "";

  if (allowedOrigins.length > 0 && origin && !allowedOrigins.includes(origin)) {
    console.warn(JSON.stringify({ msg: "origin_mismatch", origin }));
    return json(403, { error: "forbidden", hint: "origin not allowed" });
  }

  if (
    allowedUserAgents.length > 0 &&
    !allowedUserAgents.some((allowed) => userAgent.includes(allowed))
  ) {
    console.warn(JSON.stringify({ msg: "user_agent_mismatch", userAgent }));
    return json(403, { error: "forbidden", hint: "client not allowed" });
  }

  return null;
}

const RATE_BUCKET = new Map<string, { count: number; resetAt: number }>();
const RATE_WINDOW_MS = 60_000;

function rateLimit(request: Request, env: Env): Response | null {
  const limit = Number(env.RATE_LIMIT_PER_MINUTE ?? "30") || 30;
  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  const now = Date.now();

  const entry = RATE_BUCKET.get(ip);
  if (!entry || now >= entry.resetAt) {
    RATE_BUCKET.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return null;
  }

  entry.count += 1;
  if (entry.count > limit) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    return json(
      429,
      { error: "rate_limited", hint: `retry after ${retryAfter}s` },
      { "Retry-After": String(retryAfter) },
    );
  }
  return null;
}

/**
 * POST the form to Freesound and translate the outcome into a response the
 * ticket-07 client can branch on:
 *
 *   { error: "retry",       upstream_status, detail }  -> transient; try again
 *   { error: "reauthorize", upstream_status, detail }  -> code/token dead; sign in again
 *
 * On success, only the whitelisted token fields are returned.
 */
async function exchangeWithFreesound(
  form: URLSearchParams,
  env: Env,
): Promise<Response> {
  let upstream: Response;
  try {
    upstream = await fetch(FREESOUND_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
  } catch {
    return json(503, {
      error: "retry",
      upstream_status: 0,
      detail: "network error contacting Freesound",
    });
  }

  if (!upstream.ok) {
    const raw = await upstream.text().catch(() => "");
    const detail = stripSecrets(raw, env.FREESOUND_CLIENT_SECRET);
    const status = upstream.status;

    if (status >= 500 || status === 429) {
      return json(
        503,
        { error: "retry", upstream_status: status, detail },
        { "Retry-After": "5" },
      );
    }
    return json(401, { error: "reauthorize", upstream_status: status, detail });
  }

  let data: FreesoundTokenResponse | null = null;
  try {
    data = (await upstream.json()) as FreesoundTokenResponse;
  } catch {
    data = null;
  }
  if (!data || typeof data !== "object") {
    return json(502, {
      error: "retry",
      upstream_status: upstream.status,
      detail: "unexpected token response from Freesound",
    });
  }

  return json(200, {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_in: data.expires_in,
    scope: data.scope,
    token_type: data.token_type,
  });
}

type JsonBodyResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; response: Response };

async function readJsonObject(request: Request): Promise<JsonBodyResult> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return {
      ok: false,
      response: json(400, {
        error: "invalid_json",
        hint: "request body must be valid JSON",
      }),
    };
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {
      ok: false,
      response: json(400, {
        error: "invalid_json",
        hint: "request body must be a JSON object",
      }),
    };
  }
  return { ok: true, body: body as Record<string, unknown> };
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    const abuse = checkAbuse(request, env);
    if (abuse) return abuse;

    const limited = rateLimit(request, env);
    if (limited) return limited;

    if (path !== "/exchange" && path !== "/refresh") {
      return json(404, {
        error: "not_found",
        hint: "POST /exchange or POST /refresh",
      });
    }

    if (request.method !== "POST") {
      return json(405, {
        error: "method_not_allowed",
        hint: "use POST",
      });
    }

    const parsed = await readJsonObject(request);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body;

    const form = new URLSearchParams();
    form.set("client_id", env.FREESOUND_CLIENT_ID);
    form.set("client_secret", env.FREESOUND_CLIENT_SECRET);

    if (path === "/exchange") {
      const code = body.code;
      if (typeof code !== "string" || code.length === 0) {
        return json(400, {
          error: "missing_parameter",
          hint: "'code' (string) is required",
        });
      }
      form.set("grant_type", "authorization_code");
      form.set("code", code);
      if (
        typeof body.redirect_uri === "string" &&
        body.redirect_uri.length > 0
      ) {
        form.set("redirect_uri", body.redirect_uri);
      }
      return exchangeWithFreesound(form, env);
    }

    const refreshToken = body.refresh_token;
    if (typeof refreshToken !== "string" || refreshToken.length === 0) {
      return json(400, {
        error: "missing_parameter",
        hint: "'refresh_token' (string) is required",
      });
    }
    form.set("grant_type", "refresh_token");
    form.set("refresh_token", refreshToken);
    return exchangeWithFreesound(form, env);
  },
};

export default worker;
