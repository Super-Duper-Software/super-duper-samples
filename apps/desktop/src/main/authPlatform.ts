// The real `AuthPlatform` — the ONLY place in the app that touches Electron's
// `shell`, `safeStorage`, and a raw HTTP server. Everything it exposes is a
// capability the core cannot implement itself; all auth *behaviour* is in
// `src/core/auth/` and is tested with the fake in `test/helpers/`.
//
// `keytar` is deliberately NOT used: the refresh token is encrypted with
// Electron's OS-backed `safeStorage` and the ciphertext is stored by the core in
// the SQLite `auth` table.

import { createServer } from 'node:http'
import { safeStorage, shell } from 'electron'
import type { AuthPlatform, AwaitLoopbackCodeOptions, LoopbackResult } from '../core'

const CLOSE_TAB_HTML = `<!doctype html><html><head><meta charset="utf-8">
<title>Signed in</title></head><body style="font-family:system-ui,sans-serif;padding:3rem;text-align:center">
<h1 style="font-size:1.1rem">You're signed in to Freesound.</h1>
<p style="color:#666">You can close this tab now and return to the app.</p>
<script>setTimeout(function(){window.close()},400)</script>
</body></html>`

export function createElectronAuthPlatform(): AuthPlatform {
  return {
    async openExternal(url: string): Promise<void> {
      await shell.openExternal(url)
    },

    awaitLoopbackCode(opts: AwaitLoopbackCodeOptions): Promise<LoopbackResult> {
      const { port, path, signal } = opts
      return new Promise<LoopbackResult>((resolve, reject) => {
        let settled = false

        const server = createServer((req, res) => {
          const requestUrl = new URL(
            req.url ?? '/',
            `http://localhost:${port}`,
          )
          if (requestUrl.pathname !== path) {
            res.statusCode = 404
            res.end('Not found')
            return
          }
          res.statusCode = 200
          res.setHeader('Content-Type', 'text/html; charset=utf-8')
          res.end(CLOSE_TAB_HTML)
          finish({
            code: requestUrl.searchParams.get('code') ?? undefined,
            state: requestUrl.searchParams.get('state') ?? undefined,
            error: requestUrl.searchParams.get('error') ?? undefined,
          })
        })

        function cleanup(): void {
          signal.removeEventListener('abort', onAbort)
          server.close()
        }
        function finish(result: LoopbackResult): void {
          if (settled) return
          settled = true
          cleanup()
          resolve(result)
        }
        function onAbort(): void {
          // Timed out waiting for the user to authorize in the browser.
          finish({ error: 'timeout' })
        }

        signal.addEventListener('abort', onAbort)

        server.on('error', (err: NodeJS.ErrnoException) => {
          if (settled) return
          settled = true
          signal.removeEventListener('abort', onAbort)
          // EADDRINUSE is surfaced verbatim so the core can raise the specific
          // "port 8910 is already in use" error (requirement 11).
          reject(err)
        })

        server.listen(port, '127.0.0.1')
      })
    },

    encrypt(data: Buffer): Buffer {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error(
          'safeStorage encryption is unavailable on this system — cannot store the sign-in securely.',
        )
      }
      return safeStorage.encryptString(data.toString('utf8'))
    },

    decrypt(data: Buffer): Buffer {
      return Buffer.from(safeStorage.decryptString(data), 'utf8')
    },
  }
}
