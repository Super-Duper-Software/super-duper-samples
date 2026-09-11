import type { ClientErrorEvent, ErrorTelemetrySink } from "../core";

const FLUSH_INTERVAL_MS = 5 * 60_000;
const MAX_BUCKETS = 100;
const MAX_COUNT = 10_000;
const MAX_EVENTS_PER_FLUSH = 50;

/** Accept only closed-set slugs; anything else collapses to `'none'`. */
const SLUG_RE = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/;

export interface ErrorTelemetryContext {
	version: string;
	platform: string;
	arch: string;
	osRelease: string;
}

export interface ErrorTelemetry extends ErrorTelemetrySink {
	/** POST the accumulated buckets now. Best-effort; failed sends are re-queued. */
	flush(): Promise<void>;
	/** Stop the periodic flush timer. */
	stop(): void;
}

interface Bucket {
	code: string;
	subReason: string;
	secondary: string;
	online: number;
	count: number;
}

const NOOP: ErrorTelemetry = {
	report() {},
	flush: async () => {},
	stop() {},
};

/** Build the stable aggregation key for one anonymous error bucket. */
const bucketKey = (
	b: Pick<Bucket, "code" | "subReason" | "secondary" | "online">,
): string => `${b.code} ${b.subReason} ${b.secondary} ${b.online}`;

/**
 * Aggregate allowlisted failures into anonymous counts and POST them to the
 * token Worker's `/report` endpoint every few minutes. Nothing per-event, no
 * identifier, no message/path/query/URL — see `worker/README.md` "Error
 * reports". Returns a no-op sink when telemetry is disabled or no Worker URL is
 * configured.
 */
export function createErrorTelemetry(opts: {
	reportUrl: string | undefined;
	enabled: boolean;
	context: ErrorTelemetryContext;
	fetchImpl?: typeof fetch;
	flushIntervalMs?: number;
}): ErrorTelemetry {
	if (!opts.enabled || !opts.reportUrl) return NOOP;

	const url = `${opts.reportUrl.replace(/\/+$/, "")}/report`;
	const doFetch = opts.fetchImpl ?? fetch;
	const buckets = new Map<string, Bucket>();

	const slug = (s: string | undefined): string =>
		s && SLUG_RE.test(s) ? s : "none";
	const onlineNum = (b: boolean | undefined): number =>
		b === true ? 1 : b === false ? 0 : -1;

	/** Add one allowlisted event to its bounded in-memory aggregation bucket. */
	function report(event: ClientErrorEvent): void {
		const b: Bucket = {
			code: event.code,
			subReason: slug(event.subReason),
			secondary: slug(event.secondary),
			online: onlineNum(event.online),
			count: 1,
		};
		const key = bucketKey(b);
		const existing = buckets.get(key);
		if (existing) {
			existing.count = Math.min(existing.count + 1, MAX_COUNT);
			return;
		}
		if (buckets.size >= MAX_BUCKETS) {
			const oldest = buckets.keys().next().value;
			if (oldest !== undefined) buckets.delete(oldest);
		}
		buckets.set(key, b);
	}

	/** Send the current batch, re-queuing it only after a transient failure. */
	async function flush(): Promise<void> {
		if (buckets.size === 0) return;
		const events = [...buckets.values()].slice(0, MAX_EVENTS_PER_FLUSH);
		for (const event of events) buckets.delete(bucketKey(event));
		try {
			const res = await doFetch(url, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ context: opts.context, events }),
			});
			// 4xx except 429 means the batch is malformed and will never succeed — drop it.
			// 429 / 5xx / network error is transient — re-queue for the next flush.
			if (!res.ok && (res.status === 429 || res.status >= 500))
				throw new Error(`report HTTP ${res.status}`);
		} catch {
			for (const b of events) {
				const key = bucketKey(b);
				const cur = buckets.get(key);
				if (cur) cur.count = Math.min(cur.count + b.count, MAX_COUNT);
				else if (buckets.size < MAX_BUCKETS) buckets.set(key, b);
			}
		}
	}

	const timer = setInterval(
		() => void flush(),
		opts.flushIntervalMs ?? FLUSH_INTERVAL_MS,
	);
	timer.unref?.();

	return {
		report,
		flush,
		stop() {
			clearInterval(timer);
		},
	};
}
