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
	/**
	 * Optional. Per-IP-per-endpoint cap for the in-memory fallback limiter, used
	 * only when `SAMPLES_RATE_LIMITER` is unbound (local dev / tests). Default 30.
	 */
	RATE_LIMIT_PER_MINUTE?: string;
	/**
	 * Optional. Platform rate-limiting binding (wrangler.toml `[[ratelimits]]`).
	 * When present it is authoritative; when absent the in-memory bucket is used.
	 */
	SAMPLES_RATE_LIMITER?: {
		limit(options: { key: string }): Promise<{ success: boolean }>;
	};
	/**
	 * Optional. Analytics Engine dataset for the anonymous monthly-active-user
	 * count. Bound in wrangler.toml; absent in tests that don't exercise it.
	 */
	MAU_ANALYTICS?: AnalyticsEngineDataset;
	/**
	 * Optional. Secret salt mixed into the install-id hash before it is written
	 * to `MAU_ANALYTICS`. Without it, nothing is recorded (a raw install id is
	 * never written). `wrangler secret put MAU_HASH_SALT`.
	 */
	MAU_HASH_SALT?: string;
	/**
	 * Optional. Analytics Engine dataset for the anonymous error-category counts
	 * written by `POST /report`. Commented out in wrangler.toml by default; when
	 * absent, `/report` accepts the request and records nothing.
	 */
	ERROR_ANALYTICS?: AnalyticsEngineDataset;
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

/** In-memory per-key minute bucket. Fallback only — see `rateLimit`. */
function inMemoryRateLimit(key: string, limit: number): Response | null {
	const now = Date.now();
	const entry = RATE_BUCKET.get(key);
	if (!entry || now >= entry.resetAt) {
		RATE_BUCKET.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
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
 * Per-IP, per-endpoint rate limit. Uses the platform `SAMPLES_RATE_LIMITER`
 * binding when bound (authoritative and global across isolates); otherwise the
 * in-memory bucket, which only blunts a burst from a single isolate.
 */
async function rateLimit(
	request: Request,
	env: Env,
	path: string,
): Promise<Response | null> {
	const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
	const key = `${ip}:${path}`;

	if (env.SAMPLES_RATE_LIMITER) {
		try {
			const { success } = await env.SAMPLES_RATE_LIMITER.limit({ key });
			if (success) return null;
			return json(
				429,
				{ error: "rate_limited", hint: "retry after 60s" },
				{ "Retry-After": "60" },
			);
		} catch {
			// Limiter unavailable — fall through to the in-memory bucket.
		}
	}

	const limit = Number(env.RATE_LIMIT_PER_MINUTE ?? "30") || 30;
	return inMemoryRateLimit(key, limit);
}

/**
 * POST the form to Freesound and translate the outcome into a response the
 * client can branch on:
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

const INSTALL_ID_RE = /^[A-Za-z0-9._~-]{8,200}$/;

async function sha256Hex(input: string): Promise<string> {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(input),
	);
	return [...new Uint8Array(digest)]
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

/**
 * Record one anonymous monthly-active-user hit: a salted SHA-256 of the client's
 * random install id (never the id itself) plus which endpoint it came through.
 * Best-effort — a missing binding/salt, a malformed id, or a write failure is
 * swallowed so telemetry can never affect the token exchange.
 */
async function recordActiveUser(
	installId: unknown,
	endpoint: "/exchange" | "/refresh",
	env: Env,
): Promise<void> {
	if (!env.MAU_ANALYTICS || !env.MAU_HASH_SALT) return;
	if (typeof installId !== "string" || !INSTALL_ID_RE.test(installId)) return;
	try {
		const hashed = await sha256Hex(`${env.MAU_HASH_SALT}:${installId}`);
		env.MAU_ANALYTICS.writeDataPoint({
			indexes: [hashed],
			blobs: [endpoint],
		});
	} catch {
		// swallow — see doc comment
	}
}

const REPORT_EVENT_CODES = new Set([
	"preview_failed",
	"search_failed",
	"download_failed",
]);
const REPORT_MAX_EVENTS = 50;
const REPORT_MAX_COUNT = 10_000;
/** Reason slugs: a short lower/dash slug or a `MEDIA_ERR_*`-style name. */
const REPORT_SLUG_RE = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/;
/** Context strings: an app version, platform, arch, or OS release. */
const REPORT_CONTEXT_RE = /^[A-Za-z0-9][A-Za-z0-9 ._+-]{0,39}$/;

interface ReportEvent {
	code: string;
	subReason: string;
	secondary: string;
	online: number;
	count: number;
}

/**
 * Validate and record a batch of anonymous error-category counts from
 * `POST /report`. Every field is a closed-set enum, a short slug, or an integer
 * count — never a message, path, query, URL, or identifier. Returns a `400` on
 * any validation failure; on success writes one Analytics Engine data point per
 * bucket (best-effort, swallowed on failure) and returns `204`. With no
 * `ERROR_ANALYTICS` binding the request still validates and returns `204`.
 */
async function handleReport(request: Request, env: Env): Promise<Response> {
	const parsed = await readJsonObject(request);
	if (!parsed.ok) return parsed.response;
	const body = parsed.body;

	const ctxStr = (v: unknown): string | null => {
		if (v === undefined || v === null) return "unknown";
		if (typeof v !== "string" || !REPORT_CONTEXT_RE.test(v)) return null;
		return v;
	};
	const rawCtx = (body.context ?? {}) as Record<string, unknown>;
	const version = ctxStr(rawCtx.version);
	const platform = ctxStr(rawCtx.platform);
	const arch = ctxStr(rawCtx.arch);
	const osRelease = ctxStr(rawCtx.osRelease);
	if (!version || !platform || !arch || !osRelease) {
		return json(400, {
			error: "invalid_context",
			hint: "context fields must be short alphanumeric strings",
		});
	}

	const rawEvents = body.events;
	if (!Array.isArray(rawEvents) || rawEvents.length === 0) {
		return json(400, {
			error: "missing_parameter",
			hint: "'events' must be a non-empty array",
		});
	}
	if (rawEvents.length > REPORT_MAX_EVENTS) {
		return json(400, {
			error: "too_many_events",
			hint: `at most ${REPORT_MAX_EVENTS} events per request`,
		});
	}

	const slug = (v: unknown): string | null => {
		if (v === undefined || v === null) return "none";
		if (typeof v !== "string" || !REPORT_SLUG_RE.test(v)) return null;
		return v;
	};

	const events: ReportEvent[] = [];
	for (const raw of rawEvents) {
		if (!raw || typeof raw !== "object") {
			return json(400, {
				error: "invalid_event",
				hint: "each event must be an object",
			});
		}
		const e = raw as Record<string, unknown>;
		if (typeof e.code !== "string" || !REPORT_EVENT_CODES.has(e.code)) {
			return json(400, { error: "invalid_event", hint: "unknown event code" });
		}
		const subReason = slug(e.subReason);
		const secondary = slug(e.secondary);
		if (subReason === null || secondary === null) {
			return json(400, {
				error: "invalid_event",
				hint: "reason fields must be short slugs",
			});
		}
		let online = -1;
		if (e.online === 0 || e.online === false) online = 0;
		else if (e.online === 1 || e.online === true) online = 1;
		else if (e.online !== undefined && e.online !== null) {
			return json(400, {
				error: "invalid_event",
				hint: "'online' must be 0 or 1",
			});
		}
		const n = typeof e.count === "number" ? Math.floor(e.count) : NaN;
		if (!Number.isFinite(n) || n < 1) {
			return json(400, {
				error: "invalid_event",
				hint: "'count' must be a positive integer",
			});
		}
		events.push({
			code: e.code,
			subReason,
			secondary,
			online,
			count: Math.min(n, REPORT_MAX_COUNT),
		});
	}

	if (env.ERROR_ANALYTICS) {
		try {
			for (const e of events) {
				env.ERROR_ANALYTICS.writeDataPoint({
					indexes: [e.code],
					blobs: [
						e.code,
						version,
						platform,
						arch,
						osRelease,
						e.subReason,
						e.secondary,
					],
					doubles: [e.online, e.count],
				});
			}
		} catch {
			// swallow — best-effort, same contract as recordActiveUser
		}
	}

	return new Response(null, { status: 204, headers: corsHeaders() });
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

		const limited = await rateLimit(request, env, path);
		if (limited) return limited;

		if (path === "/report") {
			if (request.method !== "POST") {
				return json(405, { error: "method_not_allowed", hint: "use POST" });
			}
			return handleReport(request, env);
		}

		if (path !== "/exchange" && path !== "/refresh") {
			return json(404, {
				error: "not_found",
				hint: "POST /exchange, POST /refresh, or POST /report",
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

		await recordActiveUser(body.install_id, path, env);

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
