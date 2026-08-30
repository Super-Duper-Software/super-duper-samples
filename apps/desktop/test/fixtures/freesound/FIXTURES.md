# Freesound gateway fixtures

These JSON files feed `FakeFreesoundGateway` in the test suite. Each is a recorded
`GET https://freesound.org/apiv2/search/text/` response page.

| File | Represents |
|---|---|
| `search-rain.json` | A normal multi-result page (`count` far larger than `results.length`, `next` set). Covers CC-BY, CC-BY-NC and CC0 licenses and wav/flac/aiff types. |
| `search-thunder.json` | A small fully-contained page (`count` equals `results.length`, `next` null). |
| `search-empty.json` | An empty result set (`count: 0`, `results: []`) — distinct from a failure. |

## Status: hand-crafted

There is no committed API key in this repo, so these were **written by hand to
Freesound's documented `search/text` schema** (`id, name, username, license,
duration, tags[], filesize, type, samplerate, channels, bitdepth, previews{},
images{waveform_m, waveform_l, spectral_m, spectral_l}, url, num_downloads,
avg_rating, created`), not captured from the live API.

They should be **re-recorded against a real key** the first time one is available:

```sh
curl -s -H "Authorization: Token $FREESOUND_API_KEY" \
  "https://freesound.org/apiv2/search/text/?query=rain&page_size=15&fields=id,name,username,license,duration,tags,filesize,type,samplerate,channels,bitdepth,previews,images,url,num_downloads,avg_rating,created" \
  | python3 -m json.tool > search-rain.json
```

The `fields` list above must stay identical to `SEARCH_FIELDS` in
`src/core/gateway/index.ts`.
