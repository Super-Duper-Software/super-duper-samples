import { describe, expect, it, vi } from 'vitest'
import { createErrorTelemetry } from '../src/main/errorTelemetry'

const CONTEXT = {
  version: '0.3.1',
  platform: 'win32',
  arch: 'x64',
  osRelease: '10.0.19045',
}

interface Sent {
  url: string
  body: { context: unknown; events: Array<Record<string, unknown>> }
}

/** Create a recording fetch stub with a caller-controlled response status. */
function stubFetch(status: () => number = () => 204) {
  const sent: Sent[] = []
  const fetchImpl = vi.fn(async (input: string | URL, init?: RequestInit) => {
    sent.push({
      url: String(input),
      body: JSON.parse(String(init?.body ?? '{}')),
    })
    return new Response(null, { status: status() })
  }) as unknown as typeof fetch
  return { fetchImpl, sent }
}

describe('error telemetry aggregator', () => {
  it('is a no-op when disabled', async () => {
    const { fetchImpl, sent } = stubFetch()
    const t = createErrorTelemetry({
      reportUrl: 'https://w.example',
      enabled: false,
      context: CONTEXT,
      fetchImpl,
    })
    t.report({ code: 'preview_failed' })
    await t.flush()
    expect(sent).toHaveLength(0)
    t.stop()
  })

  it('is a no-op when no report URL is configured', async () => {
    const { fetchImpl, sent } = stubFetch()
    const t = createErrorTelemetry({
      reportUrl: undefined,
      enabled: true,
      context: CONTEXT,
      fetchImpl,
    })
    t.report({ code: 'search_failed' })
    await t.flush()
    expect(sent).toHaveLength(0)
    t.stop()
  })

  it('collapses repeats into one bucket with a count and POSTs to /report', async () => {
    const { fetchImpl, sent } = stubFetch()
    const t = createErrorTelemetry({
      reportUrl: 'https://w.example/',
      enabled: true,
      context: CONTEXT,
      fetchImpl,
    })
    t.report({
      code: 'preview_failed',
      subReason: 'element-error',
      secondary: 'MEDIA_ERR_NETWORK',
      online: true,
    })
    t.report({
      code: 'preview_failed',
      subReason: 'element-error',
      secondary: 'MEDIA_ERR_NETWORK',
      online: true,
    })
    t.report({ code: 'preview_failed', subReason: 'stall-timeout', online: false })
    await t.flush()

    expect(sent).toHaveLength(1)
    expect(sent[0]!.url).toBe('https://w.example/report')
    expect(sent[0]!.body.context).toEqual(CONTEXT)
    expect(sent[0]!.body.events).toEqual([
      {
        code: 'preview_failed',
        subReason: 'element-error',
        secondary: 'MEDIA_ERR_NETWORK',
        online: 1,
        count: 2,
      },
      {
        code: 'preview_failed',
        subReason: 'stall-timeout',
        secondary: 'none',
        online: 0,
        count: 1,
      },
    ])
    t.stop()
  })

  it('does not POST when nothing is buffered', async () => {
    const { fetchImpl, sent } = stubFetch()
    const t = createErrorTelemetry({
      reportUrl: 'https://w.example',
      enabled: true,
      context: CONTEXT,
      fetchImpl,
    })
    await t.flush()
    expect(sent).toHaveLength(0)
    t.stop()
  })

  it('coerces a non-slug subReason (e.g. a path) to "none"', async () => {
    const { fetchImpl, sent } = stubFetch()
    const t = createErrorTelemetry({
      reportUrl: 'https://w.example',
      enabled: true,
      context: CONTEXT,
      fetchImpl,
    })
    t.report({ code: 'download_failed', subReason: '/Users/alice/x.wav' })
    await t.flush()
    expect(sent[0]!.body.events[0]!.subReason).toBe('none')
    t.stop()
  })

  it('re-queues after a 5xx and drops after a 4xx', async () => {
    let code = 500
    const { fetchImpl, sent } = stubFetch(() => code)
    const t = createErrorTelemetry({
      reportUrl: 'https://w.example',
      enabled: true,
      context: CONTEXT,
      fetchImpl,
    })
    t.report({ code: 'search_failed', subReason: 'network' })

    await t.flush() // 500 → re-queue
    await t.flush() // retried
    expect(sent).toHaveLength(2)

    code = 400
    await t.flush() // 400 → drop
    await t.flush() // nothing left to send
    expect(sent).toHaveLength(3)
    t.stop()
  })
})
