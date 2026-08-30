import { useEffect, useState } from 'react'
import type { SearchResult } from '../core/types'

type Status = 'idle' | 'loading' | 'ok' | 'error'

export default function App() {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [result, setResult] = useState<SearchResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const q = query.trim()
    if (q === '') {
      setStatus('idle')
      setResult(null)
      setError(null)
      return
    }

    setStatus('loading')
    // Real debounce/prefetch is ticket 05; a small timer is enough here.
    const timer = setTimeout(() => {
      window.core
        .search(q)
        .then((r) => {
          setResult(r)
          setError(null)
          setStatus('ok')
        })
        .catch((e: unknown) => {
          setError(e instanceof Error ? e.message : String(e))
          setResult(null)
          setStatus('error')
        })
    }, 250)

    return () => clearTimeout(timer)
  }, [query])

  return (
    <main className="p-4">
      <h1 className="mb-3 text-lg font-semibold">Freesound</h1>

      <input
        type="search"
        className="w-full border px-2 py-1"
        placeholder="Search sounds…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus
      />

      <div className="mt-3">
        {status === 'loading' && <p>Searching…</p>}

        {status === 'error' && (
          <p role="alert">Search failed: {error}</p>
        )}

        {status === 'ok' && result && result.sounds.length === 0 && (
          <p>Nothing matched. Try a looser query.</p>
        )}

        {status === 'ok' && result && result.sounds.length > 0 && (
          <>
            <p className="mb-2">{result.totalCount} results</p>
            <ul>
              {result.sounds.map((s) => (
                <li key={s.id}>{s.name}</li>
              ))}
            </ul>
          </>
        )}
      </div>
    </main>
  )
}
