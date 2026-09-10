import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker, { type Env } from "../src/index.ts";

const CLIENT_SECRET = "s3cr3t-freesound-client-secret-VALUE";
const CLIENT_ID = "test-client-id";

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    FREESOUND_CLIENT_ID: CLIENT_ID,
    FREESOUND_CLIENT_SECRET: CLIENT_SECRET,
    RATE_LIMIT_PER_MINUTE: "100000",
    ...overrides,
  };
}

function post(path: string, body: unknown, init: RequestInit = {}): Request {
  return new Request(`https://worker.example.com${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
    ...init,
  });
}

/** The last upstream request the stub saw, for assertions on the form body. */
let lastUpstream: { url: string; body: string } | null = null;

/**
 * Install a fake global fetch that only answers the Freesound token endpoint.
 * `responder` returns the Response (or throws to simulate a network error).
 */
function stubFreesound(responder: (form: URLSearchParams) => Response): void {
  lastUpstream = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (!url.startsWith("https://freesound.org/apiv2/oauth2/access_token/")) {
        throw new Error(`unexpected fetch to ${url}`);
      }
      const bodyText = String(init?.body ?? "");
      lastUpstream = { url, body: bodyText };
      return responder(new URLSearchParams(bodyText));
    }),
  );
}

function jsonResponse(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Assert that nothing a caller can observe — status line, headers, or body —
 * contains the secret value or the literal substring "client_secret".
 * Clones defensively so callers may also read the body themselves.
 */
async function expectNoSecret(res: Response): Promise<void> {
  const view = res.bodyUsed ? res : res.clone();
  const parts: string[] = [String(view.status)];
  view.headers.forEach((value, key) => parts.push(`${key}: ${value}`));
  parts.push(await view.text().catch(() => ""));
  const text = parts.join("\n");
  expect(text).not.toContain(CLIENT_SECRET);
  expect(text.toLowerCase()).not.toContain("client_secret");
}

const HAPPY_TOKENS = {
  access_token: "access-abc",
  refresh_token: "refresh-def",
  expires_in: 86400,
  scope: "read write",
  token_type: "Bearer",
};

beforeEach(() => {
  stubFreesound(() => jsonResponse(200, HAPPY_TOKENS));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("/exchange", () => {
  it("exchanges a valid code for access + refresh tokens", async () => {
    const res = await worker.fetch(
      post("/exchange", { code: "auth-code-123" }),
      makeEnv(),
    );
    const snapshot = res.clone();

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.access_token).toBe("access-abc");
    expect(body.refresh_token).toBe("refresh-def");
    expect(body.expires_in).toBe(86400);
    expect(body.token_type).toBe("Bearer");

    const form = new URLSearchParams(lastUpstream!.body);
    expect(form.get("grant_type")).toBe("authorization_code");
    expect(form.get("code")).toBe("auth-code-123");
    expect(form.get("client_id")).toBe(CLIENT_ID);
    expect(form.get("client_secret")).toBe(CLIENT_SECRET);

    await expectNoSecret(snapshot);
  });

  it("forwards redirect_uri when the client sends one", async () => {
    await worker.fetch(
      post("/exchange", {
        code: "auth-code-123",
        redirect_uri: "http://localhost:8910/callback",
      }),
      makeEnv(),
    );
    const form = new URLSearchParams(lastUpstream!.body);
    expect(form.get("redirect_uri")).toBe("http://localhost:8910/callback");
  });

  it("does not send redirect_uri when the client omits it", async () => {
    await worker.fetch(post("/exchange", { code: "x" }), makeEnv());
    const form = new URLSearchParams(lastUpstream!.body);
    expect(form.has("redirect_uri")).toBe(false);
  });
});

describe("/refresh", () => {
  it("exchanges a valid refresh token for a new access token", async () => {
    stubFreesound(() =>
      jsonResponse(200, { ...HAPPY_TOKENS, access_token: "fresh-access" }),
    );

    const res = await worker.fetch(
      post("/refresh", { refresh_token: "refresh-def" }),
      makeEnv(),
    );
    const snapshot = res.clone();

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.access_token).toBe("fresh-access");

    const form = new URLSearchParams(lastUpstream!.body);
    expect(form.get("grant_type")).toBe("refresh_token");
    expect(form.get("refresh_token")).toBe("refresh-def");
    expect(form.get("client_secret")).toBe(CLIENT_SECRET);

    await expectNoSecret(snapshot);
  });
});

describe("anonymous MAU recording", () => {
  const SALT = "test-mau-salt";
  const INSTALL_ID = "11111111-2222-3333-4444-555555555555";

  /** Own IP so these calls don't spend the shared "unknown" rate-limit bucket. */
  const mauPost = (path: string, body: unknown): Request =>
    post(path, body, { headers: { "cf-connecting-ip": "198.51.100.42" } });

  /** A stand-in Analytics Engine dataset that captures every writeDataPoint. */
  function fakeAnalytics(): {
    binding: NonNullable<Env["MAU_ANALYTICS"]>;
    points: Array<{ indexes?: unknown[]; blobs?: unknown[] }>;
  } {
    const points: Array<{ indexes?: unknown[]; blobs?: unknown[] }> = [];
    return {
      points,
      binding: {
        writeDataPoint(event) {
          points.push({ indexes: event?.indexes, blobs: event?.blobs });
        },
      } as NonNullable<Env["MAU_ANALYTICS"]>,
    };
  }

  /** SHA-256 hex of `${salt}:${id}`, the exact value the Worker should write. */
  async function expectedHash(id: string): Promise<string> {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`${SALT}:${id}`),
    );
    return [...new Uint8Array(digest)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  it("writes one salted-hash data point per /exchange, tagged with the endpoint", async () => {
    const mau = fakeAnalytics();
    const res = await worker.fetch(
      mauPost("/exchange", { code: "c", install_id: INSTALL_ID }),
      makeEnv({ MAU_ANALYTICS: mau.binding, MAU_HASH_SALT: SALT }),
    );

    expect(res.status).toBe(200);
    expect(mau.points).toHaveLength(1);
    expect(mau.points[0]!.indexes).toEqual([await expectedHash(INSTALL_ID)]);
    expect(mau.points[0]!.blobs).toEqual(["/exchange"]);
  });

  it("writes for /refresh too", async () => {
    const mau = fakeAnalytics();
    await worker.fetch(
      mauPost("/refresh", { refresh_token: "rt", install_id: INSTALL_ID }),
      makeEnv({ MAU_ANALYTICS: mau.binding, MAU_HASH_SALT: SALT }),
    );
    expect(mau.points[0]!.blobs).toEqual(["/refresh"]);
  });

  it("never writes or forwards the raw install id", async () => {
    const mau = fakeAnalytics();
    await worker.fetch(
      mauPost("/exchange", { code: "c", install_id: INSTALL_ID }),
      makeEnv({ MAU_ANALYTICS: mau.binding, MAU_HASH_SALT: SALT }),
    );
    expect(JSON.stringify(mau.points)).not.toContain(INSTALL_ID);
    expect(lastUpstream!.body).not.toContain(INSTALL_ID);
    expect(lastUpstream!.body).not.toContain("install_id");
  });

  it("records nothing when the client sends no install id", async () => {
    const mau = fakeAnalytics();
    await worker.fetch(
      mauPost("/exchange", { code: "c" }),
      makeEnv({ MAU_ANALYTICS: mau.binding, MAU_HASH_SALT: SALT }),
    );
    expect(mau.points).toHaveLength(0);
  });

  it("records nothing for a malformed install id", async () => {
    const mau = fakeAnalytics();
    await worker.fetch(
      mauPost("/exchange", { code: "c", install_id: "nope!" }),
      makeEnv({ MAU_ANALYTICS: mau.binding, MAU_HASH_SALT: SALT }),
    );
    expect(mau.points).toHaveLength(0);
  });

  it("records nothing when MAU_HASH_SALT is unset", async () => {
    const mau = fakeAnalytics();
    await worker.fetch(
      mauPost("/exchange", { code: "c", install_id: INSTALL_ID }),
      makeEnv({ MAU_ANALYTICS: mau.binding }),
    );
    expect(mau.points).toHaveLength(0);
  });

  it("a failing writeDataPoint never breaks the token exchange", async () => {
    const res = await worker.fetch(
      mauPost("/exchange", { code: "c", install_id: INSTALL_ID }),
      makeEnv({
        MAU_HASH_SALT: SALT,
        MAU_ANALYTICS: {
          writeDataPoint() {
            throw new Error("analytics down");
          },
        } as NonNullable<Env["MAU_ANALYTICS"]>,
      }),
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as Record<string, unknown>).access_token).toBe(
      "access-abc",
    );
  });
});

describe("client_secret never leaks — success and every error path", () => {
  it("success path", async () => {
    const res = await worker.fetch(
      post("/exchange", { code: "ok" }),
      makeEnv(),
    );
    expect(res.status).toBe(200);
    await expectNoSecret(res);
  });

  it("malformed JSON body", async () => {
    const res = await worker.fetch(
      post("/exchange", "{ not json"),
      makeEnv(),
    );
    expect(res.status).toBe(400);
    await expectNoSecret(res);
  });

  it("missing params", async () => {
    const res = await worker.fetch(post("/exchange", {}), makeEnv());
    expect(res.status).toBe(400);
    await expectNoSecret(res);
  });

  it("upstream 400 invalid_grant", async () => {
    stubFreesound(() =>
      jsonResponse(400, {
        error: "invalid_grant",
        error_description: "expired or invalid authorization code",
      }),
    );
    const res = await worker.fetch(
      post("/exchange", { code: "dead" }),
      makeEnv(),
    );
    expect(res.status).toBe(401);
    await expectNoSecret(res);
  });

  it("upstream 500", async () => {
    stubFreesound(() => new Response("upstream boom", { status: 500 }));
    const res = await worker.fetch(
      post("/exchange", { code: "x" }),
      makeEnv(),
    );
    expect(res.status).toBe(503);
    await expectNoSecret(res);
  });

  it("upstream echoes the secret back in its error body", async () => {
    stubFreesound(
      () =>
        new Response(
          `invalid request: client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}&grant_type=authorization_code`,
          { status: 400 },
        ),
    );
    const res = await worker.fetch(
      post("/exchange", { code: "x" }),
      makeEnv(),
    );
    const snapshot = res.clone();
    expect(res.status).toBe(401);
    const body = await res.text();
    expect(body).toContain("[redacted]");
    await expectNoSecret(snapshot);
  });

  it("network failure reaching Freesound", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
    const res = await worker.fetch(
      post("/refresh", { refresh_token: "x" }),
      makeEnv(),
    );
    expect(res.status).toBe(503);
    await expectNoSecret(res);
  });
});

describe("malformed requests / wrong method / unknown path", () => {
  it("rejects malformed JSON with a clear non-leaking error", async () => {
    const res = await worker.fetch(
      post("/exchange", "not-json-at-all"),
      makeEnv(),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe("invalid_json");
    expect(typeof body.hint).toBe("string");
    expect(body).not.toHaveProperty("stack");
  });

  it("rejects a JSON array body", async () => {
    const res = await worker.fetch(post("/exchange", [1, 2, 3]), makeEnv());
    expect(res.status).toBe(400);
    expect(((await res.json()) as Record<string, unknown>).error).toBe(
      "invalid_json",
    );
  });

  it("rejects /exchange without a code", async () => {
    const res = await worker.fetch(
      post("/exchange", { redirect_uri: "http://localhost:8910/callback" }),
      makeEnv(),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as Record<string, unknown>).error).toBe(
      "missing_parameter",
    );
  });

  it("rejects /refresh without a refresh_token", async () => {
    const res = await worker.fetch(post("/refresh", {}), makeEnv());
    expect(res.status).toBe(400);
    expect(((await res.json()) as Record<string, unknown>).error).toBe(
      "missing_parameter",
    );
  });

  it("rejects a non-POST method with 405", async () => {
    const res = await worker.fetch(
      new Request("https://worker.example.com/exchange", { method: "GET" }),
      makeEnv(),
    );
    expect(res.status).toBe(405);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe("method_not_allowed");
    expect(typeof body.hint).toBe("string");
  });

  it("returns 404 for an unknown path", async () => {
    const res = await worker.fetch(post("/nope", {}), makeEnv());
    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe("not_found");
    expect(typeof body.hint).toBe("string");
  });
});

describe("upstream failure classification", () => {
  it("invalid_grant tells the client to re-authorize", async () => {
    stubFreesound(() => jsonResponse(400, { error: "invalid_grant" }));
    const res = await worker.fetch(
      post("/exchange", { code: "expired" }),
      makeEnv(),
    );
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe("reauthorize");
    expect(body.upstream_status).toBe(400);
    expect(body).toHaveProperty("detail");
  });

  it("401 from upstream tells the client to re-authorize", async () => {
    stubFreesound(() => jsonResponse(401, { detail: "invalid token" }));
    const res = await worker.fetch(
      post("/refresh", { refresh_token: "revoked" }),
      makeEnv(),
    );
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe("reauthorize");
    expect(body.upstream_status).toBe(401);
  });

  it("5xx from upstream tells the client to retry", async () => {
    stubFreesound(() => new Response("bad gateway", { status: 502 }));
    const res = await worker.fetch(
      post("/exchange", { code: "x" }),
      makeEnv(),
    );
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe("retry");
    expect(body.upstream_status).toBe(502);
  });

  it("429 from upstream tells the client to retry", async () => {
    stubFreesound(() => new Response("slow down", { status: 429 }));
    const res = await worker.fetch(
      post("/exchange", { code: "x" }),
      makeEnv(),
    );
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe("retry");
    expect(body.upstream_status).toBe(429);
  });
});

describe("CORS", () => {
  it("answers OPTIONS preflight with permissive headers", async () => {
    const res = await worker.fetch(
      new Request("https://worker.example.com/exchange", { method: "OPTIONS" }),
      makeEnv(),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("POST");
  });

  it("sets CORS headers on normal responses", async () => {
    const res = await worker.fetch(
      post("/exchange", { code: "ok" }),
      makeEnv(),
    );
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});

describe("soft abuse protection", () => {
  it("does not enforce anything when the allowlists are unset", async () => {
    const res = await worker.fetch(
      post("/exchange", { code: "ok" }, { headers: { Origin: "https://evil.example" } }),
      makeEnv(),
    );
    expect(res.status).toBe(200);
  });

  it("denies a disallowed Origin when an allowlist is configured", async () => {
    const res = await worker.fetch(
      post("/exchange", { code: "ok" }, { headers: { Origin: "https://evil.example" } }),
      makeEnv({ ALLOWED_ORIGINS: "https://app.super-duper-samples.example" }),
    );
    expect(res.status).toBe(403);
    await expectNoSecret(res);
  });

  it("allows a matching User-Agent substring", async () => {
    const res = await worker.fetch(
      post("/exchange", { code: "ok" }, { headers: { "User-Agent": "super-duper-samples/1.0 Electron" } }),
      makeEnv({ ALLOWED_USER_AGENTS: "super-duper-samples" }),
    );
    expect(res.status).toBe(200);
  });
});

describe("rate limiting", () => {
  it("returns 429 once the per-IP minute budget is exceeded", async () => {
    const env = makeEnv({ RATE_LIMIT_PER_MINUTE: "3" });
    const ip = "203.0.113.7";
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await worker.fetch(
        post("/exchange", { code: "ok" }, { headers: { "cf-connecting-ip": ip } }),
        env,
      );
      statuses.push(res.status);
    }
    expect(statuses.filter((s) => s === 200).length).toBe(3);
    expect(statuses.filter((s) => s === 429).length).toBe(2);
  });

  it("uses the SAMPLES_RATE_LIMITER binding when bound", async () => {
    const res = await worker.fetch(
      post("/exchange", { code: "ok" }, { headers: { "cf-connecting-ip": "203.0.113.9" } }),
      makeEnv({ SAMPLES_RATE_LIMITER: { limit: async () => ({ success: false }) } }),
    );
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
  });

  it("falls back to the in-memory bucket when the binding throws", async () => {
    const res = await worker.fetch(
      post("/exchange", { code: "ok" }, { headers: { "cf-connecting-ip": "203.0.113.10" } }),
      makeEnv({
        RATE_LIMIT_PER_MINUTE: "1000",
        SAMPLES_RATE_LIMITER: {
          limit: async () => {
            throw new Error("limiter unavailable");
          },
        },
      }),
    );
    expect(res.status).toBe(200);
  });
});

describe("error reports (/report)", () => {
  const reportPost = (body: unknown): Request =>
    post("/report", body, { headers: { "cf-connecting-ip": "198.51.100.77" } });

  const CONTEXT = {
    version: "0.3.1",
    platform: "win32",
    arch: "x64",
    osRelease: "10.0.19045",
  };

  function fakeErrorAnalytics(): {
    binding: NonNullable<Env["ERROR_ANALYTICS"]>;
    points: Array<{ indexes?: unknown[]; blobs?: unknown[]; doubles?: unknown[] }>;
  } {
    const points: Array<{
      indexes?: unknown[];
      blobs?: unknown[];
      doubles?: unknown[];
    }> = [];
    return {
      points,
      binding: {
        writeDataPoint(event) {
          points.push({
            indexes: event?.indexes,
            blobs: event?.blobs,
            doubles: event?.doubles,
          });
        },
      } as NonNullable<Env["ERROR_ANALYTICS"]>,
    };
  }

  it("writes one data point per bucket and returns 204", async () => {
    const ae = fakeErrorAnalytics();
    const res = await worker.fetch(
      reportPost({
        context: CONTEXT,
        events: [
          {
            code: "preview_failed",
            subReason: "element-error",
            secondary: "MEDIA_ERR_NETWORK",
            online: 1,
            count: 4,
          },
          { code: "search_failed", subReason: "network", count: 2 },
        ],
      }),
      makeEnv({ ERROR_ANALYTICS: ae.binding }),
    );
    expect(res.status).toBe(204);
    expect(ae.points).toHaveLength(2);
    expect(ae.points[0]!.indexes).toEqual(["preview_failed"]);
    expect(ae.points[0]!.blobs).toEqual([
      "preview_failed",
      "0.3.1",
      "win32",
      "x64",
      "10.0.19045",
      "element-error",
      "MEDIA_ERR_NETWORK",
    ]);
    expect(ae.points[0]!.doubles).toEqual([1, 4]);
    expect(ae.points[1]!.blobs).toEqual([
      "search_failed",
      "0.3.1",
      "win32",
      "x64",
      "10.0.19045",
      "network",
      "none",
    ]);
    expect(ae.points[1]!.doubles).toEqual([-1, 2]);
  });

  it("accepts the batch and records nothing when ERROR_ANALYTICS is unbound", async () => {
    const res = await worker.fetch(
      reportPost({
        context: CONTEXT,
        events: [{ code: "preview_failed", count: 1 }],
      }),
      makeEnv(),
    );
    expect(res.status).toBe(204);
  });

  it("rejects an unknown event code", async () => {
    const ae = fakeErrorAnalytics();
    const res = await worker.fetch(
      reportPost({
        context: CONTEXT,
        events: [{ code: "keystroke_logged", count: 1 }],
      }),
      makeEnv({ ERROR_ANALYTICS: ae.binding }),
    );
    expect(res.status).toBe(400);
    expect(ae.points).toHaveLength(0);
  });

  it("rejects a free-text reason slug (e.g. a path)", async () => {
    const res = await worker.fetch(
      reportPost({
        context: CONTEXT,
        events: [
          { code: "preview_failed", subReason: "C:\\Users\\alice\\clip.wav", count: 1 },
        ],
      }),
      makeEnv({ ERROR_ANALYTICS: fakeErrorAnalytics().binding }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects an over-long events array", async () => {
    const events = Array.from({ length: 51 }, () => ({
      code: "preview_failed",
      count: 1,
    }));
    const res = await worker.fetch(
      reportPost({ context: CONTEXT, events }),
      makeEnv({ ERROR_ANALYTICS: fakeErrorAnalytics().binding }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects an empty events array", async () => {
    const res = await worker.fetch(
      reportPost({ context: CONTEXT, events: [] }),
      makeEnv({ ERROR_ANALYTICS: fakeErrorAnalytics().binding }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects an invalid context field", async () => {
    const res = await worker.fetch(
      reportPost({
        context: { ...CONTEXT, osRelease: "not a version; rm -rf /" },
        events: [{ code: "preview_failed", count: 1 }],
      }),
      makeEnv({ ERROR_ANALYTICS: fakeErrorAnalytics().binding }),
    );
    expect(res.status).toBe(400);
  });

  it("clamps count to 10000", async () => {
    const ae = fakeErrorAnalytics();
    await worker.fetch(
      reportPost({
        context: CONTEXT,
        events: [{ code: "download_failed", count: 999999 }],
      }),
      makeEnv({ ERROR_ANALYTICS: ae.binding }),
    );
    expect(ae.points[0]!.doubles).toEqual([-1, 10000]);
  });

  it("a failing writeDataPoint still returns 204", async () => {
    const res = await worker.fetch(
      reportPost({
        context: CONTEXT,
        events: [{ code: "preview_failed", count: 1 }],
      }),
      makeEnv({
        ERROR_ANALYTICS: {
          writeDataPoint() {
            throw new Error("analytics down");
          },
        } as NonNullable<Env["ERROR_ANALYTICS"]>,
      }),
    );
    expect(res.status).toBe(204);
  });

  it("GET /report is 405", async () => {
    const res = await worker.fetch(
      new Request("https://worker.example.com/report", {
        method: "GET",
        headers: { "cf-connecting-ip": "198.51.100.78" },
      }),
      makeEnv(),
    );
    expect(res.status).toBe(405);
  });
});

describe("statelessness", () => {
  it("runs with an env that has only the two credential vars", async () => {
    const res = await worker.fetch(post("/exchange", { code: "ok" }), {
      FREESOUND_CLIENT_ID: CLIENT_ID,
      FREESOUND_CLIENT_SECRET: CLIENT_SECRET,
    });
    expect(res.status).toBe(200);
  });

  it("source references no storage bindings", () => {
    const src = readFileSync(
      fileURLToPath(new URL("../src/index.ts", import.meta.url)),
      "utf8",
    );
    expect(src).not.toMatch(/KVNamespace|kv_namespaces/);
    expect(src).not.toMatch(/D1Database|d1_databases/);
    expect(src).not.toMatch(/DurableObject|durable_objects/);
    expect(src).not.toMatch(/R2Bucket|r2_buckets/);
    expect(src).not.toMatch(/caches\.\w+\.put/);
  });

  it("wrangler.toml declares no storage bindings", () => {
    const toml = readFileSync(
      fileURLToPath(new URL("../wrangler.toml", import.meta.url)),
      "utf8",
    );
    expect(toml).not.toMatch(/\[\[kv_namespaces\]\]/);
    expect(toml).not.toMatch(/\[\[d1_databases\]\]/);
    expect(toml).not.toMatch(/\[\[durable_objects/);
    expect(toml).not.toMatch(/\[\[r2_buckets\]\]/);
  });
});
