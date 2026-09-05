/** @type {import('tailwindcss').Config} */

module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--sd-bg)',
        'bg-inset': 'var(--sd-bg-inset)',
        surface: 'var(--sd-surface)',
        'surface-raised': 'var(--sd-surface-raised)',

        ink: 'var(--sd-ink)',
        'ink-muted': 'var(--sd-ink-muted)',
        'ink-faint': 'var(--sd-ink-faint)',
        'ink-inverse': 'var(--sd-ink-inverse)',

        line: 'var(--sd-line)',
        'line-strong': 'var(--sd-line-strong)',

        accent: 'var(--sd-accent)',
        'accent-hover': 'var(--sd-accent-hover)',
        'accent-text': 'var(--sd-accent-text)',
        'accent-on': 'var(--sd-accent-on)',
        'accent-2': 'var(--sd-accent-2)',
        'accent-2-text': 'var(--sd-accent-2-text)',
        'accent-2-on': 'var(--sd-accent-2-on)',

        focus: 'var(--sd-focus)',

        'license-open': 'var(--sd-license-open)',
        'license-attribution': 'var(--sd-license-attribution)',
        'license-caution': 'var(--sd-license-caution)',
        'license-legacy': 'var(--sd-license-legacy)',

        ok: 'var(--sd-ok)',
        warn: 'var(--sd-warn)',
        error: 'var(--sd-error)',

        wave: 'var(--sd-wave)',
        'wave-played': 'var(--sd-wave-played)',
        playhead: 'var(--sd-playhead)',
      },
      fontFamily: {
        display: 'var(--sd-font-display)',
        ui: 'var(--sd-font-ui)',
        mono: 'var(--sd-font-mono)',
      },
      fontSize: {
        eyebrow: 'var(--sd-text-eyebrow)',
      },
      letterSpacing: {
        display: 'var(--sd-track-display)',
        heading: 'var(--sd-track-heading)',
        eyebrow: 'var(--sd-track-eyebrow)',
        mono: 'var(--sd-track-mono)',
      },
      borderRadius: {
        DEFAULT: 'var(--sd-radius-sm)',
        sd: 'var(--sd-radius-sm)',
        'sd-md': 'var(--sd-radius-md)',
      },
      boxShadow: {
        hard: 'var(--sd-shadow-hard)',
        'hard-sm': 'var(--sd-shadow-hard-sm)',
        bevel: 'var(--sd-bevel)',
        'bevel-pressed': 'var(--sd-bevel-pressed)',
      },
      transitionDuration: {
        hover: '80ms',
      },
    },
  },
  plugins: [],
}
