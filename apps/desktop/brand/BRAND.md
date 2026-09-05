# Super Duper Software - brand definition

`brand.css` + `fonts.css` + `fonts/` are the **single source of truth** for the
Super Duper brand. Copy the whole `brand/` directory into any product. Nothing
in here depends on a framework, a build step, or a Tailwind version.

---

## The direction

**Early-1990s graphic design.** Bold expanded type, flat saturated colour, hard
geometry - the visual language of software packaging, Emigre, and MTV-era print.

It is deliberately **not**:

| Not this | Why not |
|---|---|
| OS skeuomorphism (Win95 bevels everywhere) | A costume. Charming for eight seconds, exhausting for a three-hour session, and it fights every modern UX affordance. |
| Terminal / CRT / phosphor green | The single most-used indie-dev look of the last five years. Near-zero distinctiveness. |
| GeoCities / early web | Directly contradicts "sleek". |

The distinction that matters: **this is a system, those are costumes.** The
brand is expressible as tokens - a type scale, a palette, a radius, a border
treatment - which is why it survives being ported into a dense virtualised list
with waveforms and licence chips. Try to port bevelled window chrome into a
result row and you get a Fisher-Price audio tool.

---

## Typography

One variable family, two voices:

| Voice | Face | Settings |
|---|---|---|
| **Display** | Archivo Variable | `font-stretch: 125%`, weight 900, tracking `-0.035em`, uppercase |
| **UI / body** | Archivo Variable | `font-stretch: 100%`, weight 400–600, tracking 0 |
| **Data / labels** | IBM Plex Mono | 400 / 600, tabular numerals |

**Archivo carries both the weight and width axes in a single file.** The display
face and the UI face are literally the same font - one request, one token set,
and a brand definition that ports cleanly. This was the reason the family was
chosen over Space Grotesk (overused) or Inter (invisible).

### The load-bearing rule

> **Expanded type must be tracked in.** Archivo Expanded set at default tracking
> just looks *wide*. It does not look designed. `--sd-track-display` is not a
> nicety - it is the difference between the brand working and not.

Never go below `wdth: 100%`. Condensed reads 2010s startup, not 1993 software.

IBM Plex Mono is the honest computing reference - it is IBM's, it carries the
period without pretending to be a terminal, and it is a genuinely excellent
face for tabular data (durations, sample rates, bit depth, file sizes).

---

## Colour

### Primary - hot orange-red `#FF5A1F`

Chosen because it is simultaneously:

- **period-correct** - early-90s packaging ran warm: orange, red, ochre
- **category-correct** - audio has been orange-amber since the VU meter
- **technically compliant** - around 60% luminance it holds up on both
  `#0A0A0A` and near-white, so one accent value serves both modes
- **not blue-violet** - which every developer tool has defaulted to

### Secondary - desktop teal

The 1995 default-desktop nod. Orange/teal is unmistakably of the era. Use it for
**state** (selection, playhead, focus), never for primary action.

### Neutrals

Warm on the light end (paper), true on the dark end. Two deliberate details:

- `--sd-gray-300: #C3BEB6` is a wink at Win95 silver `#C0C0C0`.
- `--sd-gray-950: #0A0A0A` **is** Tailwind `neutral-950`, which Super Duper
  Samples already ships. The app's existing ground stays valid on port.

### Licence colours are not brand colours

They carry legal consequence. CC-BY-NC makes commercial use unlawful, and it has
to read as caution to someone scanning a moving list.

> **HARD RULE: licence chips must differ by label *and* shape, never by hue
> alone.** The caution amber sits close enough to the brand orange that hue
> alone is not a safe signal - and roughly 1 in 12 men cannot separate them at
> chip size. Always set the licence code in mono; give caution a heavier border.

This is the constraint that the orange primary buys us, and it is not
negotiable. It also means the app should spend orange sparingly in dense UI.

---

## Light and dark

**Both are first-class.** Dark is the primary mode for Super Duper Samples - it
lives next to a DAW, and every DAW on earth is dark. The marketing site runs
light.

`brand.css` defines light on bare `:root`, then overrides twice:

```css
@media (prefers-color-scheme: dark) { :root:not([data-sd-theme='light']) { … } }
:root[data-sd-theme='dark'] { … }
```

Both are required: the media query handles "system" (which stamps no attribute),
the attribute handles an explicit user choice, so a toggle wins in both
directions. **Never give a colour its only definition inside one of those
blocks.**

---

## Rationing period ornament

The whole system contains exactly **three** skeuomorphic borrowings, and they
are rationed on purpose. Nostalgia works best as a detail you notice *second*,
after the thing already looks good.

1. **The primary button** - hard bevel, solid offset shadow, presses on
   `:active`. The most skeuomorphic object on the site, and deliberately the one
   thing people are meant to click.
2. **The demo window frame** - `.sd-window` + `.sd-titlebar` around the product
   video.
3. **Section rules set like a menu bar** - `.sd-menubar`.

> Before adding a fourth, delete one. A brand that bevels everything is a
> costume, and the whole direction was chosen to avoid exactly that.

**In the app, ornament goes to near-zero.** `--sd-bevel` should appear on
approximately nothing inside a result list.

---

## Motion

Near-zero, by policy.

Pre-2000s UI had **no transitions** - things appeared. Instant state change is
more 1993 than any easing curve, and it costs nothing.

More importantly: on the marketing site the hero asset is an eight-second video
of a file being dragged into a DAW. **That video is the proof, and stillness is
what makes it loud.** If type is rising into view on every scroll, the demo
becomes one moving thing among many.

Scroll-hijacking (Lenis, Locomotive) is **banned**. It works by putting latency
between a user's gesture and the response - on a brand whose thesis is *don't
break the flow*, that is writing the counter-argument into your own page.

`prefers-reduced-motion` is honoured at the brand level, so every consumer
inherits it.

---

## Porting into a product

### Tailwind v4 (this site)

```css
@import './brand/fonts.css';
@import './brand/brand.css';
@import 'tailwindcss';

@theme inline {
  --color-ink: var(--sd-ink);
  --font-display: var(--sd-font-display);
  /* … */
}
```

`inline` matters: it makes utilities emit `var(--sd-*)` directly, so the
light/dark overrides cascade at runtime instead of being frozen at build time.

### Tailwind v3 (Super Duper Samples)

```js
// tailwind.config.mjs
export default {
  theme: {
    extend: {
      colors: {
        ink: 'var(--sd-ink)',
        accent: 'var(--sd-accent)',
        // …
      },
      fontFamily: {
        display: 'var(--sd-font-display)',
        mono: 'var(--sd-font-mono)',
      },
    },
  },
}
```

…and `@import` the two brand files at the top of `src/renderer/index.css`,
above the Tailwind directives.

**Why variables and not a shared Tailwind config:** this site is on Tailwind v4
(CSS-first `@theme`) and the app is on v3 (JS config). A shared config file
would not port at all. Variables port to both - and to neither, if a future
Super Duper product drops Tailwind entirely.

---

## Licences

- **Archivo** - SIL OFL 1.1, Omnibus-Type
- **IBM Plex Mono** - SIL OFL 1.1, IBM

Both are self-hosted. No CDN request, no Google Fonts request - on a page whose
thesis is speed, a third-party font request is self-refuting.
