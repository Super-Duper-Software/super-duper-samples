/** The allowlisted failures the app reports as anonymous category counts. */
export type ErrorEventCode =
  | 'preview_failed'
  | 'search_failed'
  | 'download_failed'

/**
 * One anonymous error occurrence. Carries only closed-set slugs and a flag —
 * never a message, stack, path, query, URL, or identifier. The main process
 * aggregates these into counts before anything leaves the machine (see
 * `main/errorTelemetry.ts`).
 */
export interface ClientErrorEvent {
  code: ErrorEventCode
  /** Short closed-set slug: a preview trigger, or a `classifyError` kind. */
  subReason?: string
  /** Optional second closed-set slug, e.g. a `MEDIA_ERR_*` name. */
  secondary?: string
  /** `navigator.onLine` at the point of failure, when known. */
  online?: boolean
}

/**
 * Sink the core calls to record an error event. Omitted from `CoreDeps` → a
 * no-op. The real implementation batches and POSTs to the token Worker's
 * `/report` endpoint.
 */
export interface ErrorTelemetrySink {
  report(event: ClientErrorEvent): void
}
