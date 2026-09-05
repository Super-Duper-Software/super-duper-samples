import { appendFileSync, mkdirSync, readFileSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'

export type LogLevel = 'info' | 'warn' | 'error'

export interface Logger {
  info(message: string, meta?: Record<string, unknown>): void
  warn(message: string, meta?: Record<string, unknown>): void
  error(message: string, meta?: Record<string, unknown>): void
  /** The on-disk log path, or `null` when logging to nowhere (tests). */
  path(): string | null
  /** The most recent `maxLines` lines, oldest first. `[]` when there is no sink. */
  read(maxLines: number): string[]
}

/**
 * Where formatted log lines go. `append` takes one already-formatted line
 * (no trailing newline). `read` returns whole lines, oldest first.
 */
export interface LogSink {
  append(line: string): void
  read(maxLines: number): string[]
  path: string | null
}

/** Discards everything; `read` is always empty. The default when no sink is wired. */
export const NULL_LOG_SINK: LogSink = {
  append() {},
  read() {
    return []
  },
  path: null,
}

/** Format one line: `2026-08-31T12:00:00.000Z  WARN  message  {"k":1}`. */
export function formatLogLine(
  level: LogLevel,
  message: string,
  meta: Record<string, unknown> | undefined,
  now: number,
): string {
  const ts = new Date(now).toISOString()
  const tag = level.toUpperCase().padEnd(5)
  let line = `${ts}  ${tag}  ${message}`
  if (meta && Object.keys(meta).length > 0) {
    try {
      line += `  ${JSON.stringify(meta)}`
    } catch {
      line += '  {unserialisable meta}'
    }
  }
  return line
}

export function createLogger(sink: LogSink, clock: () => number = Date.now): Logger {
  const write = (level: LogLevel, message: string, meta?: Record<string, unknown>) => {
    try {
      sink.append(formatLogLine(level, message, meta, clock()))
    } catch {
      // A logger that throws is worse than a missing log line.
    }
  }
  return {
    info: (m, meta) => write('info', m, meta),
    warn: (m, meta) => write('warn', m, meta),
    error: (m, meta) => write('error', m, meta),
    path: () => sink.path,
    read: (maxLines) => {
      try {
        return sink.read(maxLines)
      } catch {
        return []
      }
    },
  }
}

/** Roll the log over once it passes this size, keeping a single `.1` back-file. */
export const LOG_ROTATE_BYTES = 1024 * 1024

/**
 * A file sink at `<dir>/app.log`. Creates `<dir>` on first write, appends
 * synchronously (log volume is tiny — a line per surfaced error), and rotates
 * to `app.log.1` past `LOG_ROTATE_BYTES` so the file cannot grow without bound.
 */
export function createFileLogSink(dir: string): LogSink {
  const file = join(dir, 'app.log')
  const backup = join(dir, 'app.log.1')
  let ensured = false

  const ensureDir = () => {
    if (ensured) return
    mkdirSync(dir, { recursive: true })
    ensured = true
  }

  return {
    path: file,
    append(line) {
      ensureDir()
      try {
        if (statSync(file).size > LOG_ROTATE_BYTES) renameSync(file, backup)
      } catch {
        // No file yet, or the rename lost a race — either way, just append.
      }
      appendFileSync(file, line + '\n', 'utf8')
    },
    read(maxLines) {
      const chunks: string[] = []
      for (const p of [backup, file]) {
        try {
          chunks.push(readFileSync(p, 'utf8'))
        } catch {
          // Missing back-file / not written yet.
        }
      }
      const lines = chunks.join('').split('\n').filter(Boolean)
      return maxLines > 0 && lines.length > maxLines
        ? lines.slice(lines.length - maxLines)
        : lines
    },
  }
}
