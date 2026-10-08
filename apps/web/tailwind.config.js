/**
 * Colors are the tokens of src/styles/tokens.css: one class (bg-surface,
 * text-fg-3, border-line...) holds for both themes, so templates need no dark:
 * variant.
 *
 * @type {import('tailwindcss').Config}
 */
export default {
  content: ['./index.html', './src/**/*.{vue,js,ts}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        canvas: 'var(--bg)',
        surface: { DEFAULT: 'var(--surface)', 2: 'var(--surface-2)', hover: 'var(--surface-hover)' },
        overlay: 'var(--overlay)',
        line: { DEFAULT: 'var(--border)', strong: 'var(--border-strong)' },
        fg: { DEFAULT: 'var(--text)', 2: 'var(--text-2)', 3: 'var(--text-3)' },
        accent: {
          DEFAULT: 'var(--accent)',
          hover: 'var(--accent-hover)',
          fg: 'var(--accent-fg)',
          text: 'var(--accent-text)',
          soft: 'var(--accent-soft)',
          border: 'var(--accent-border)',
        },
        ok: { DEFAULT: 'var(--ok)', text: 'var(--ok-text)', soft: 'var(--ok-soft)', border: 'var(--ok-border)' },
        warn: { DEFAULT: 'var(--warn)', text: 'var(--warn-text)', soft: 'var(--warn-soft)', border: 'var(--warn-border)' },
        danger: { DEFAULT: 'var(--danger)', text: 'var(--danger-text)', soft: 'var(--danger-soft)', border: 'var(--danger-border)' },
        info: { DEFAULT: 'var(--info)', text: 'var(--info-text)', soft: 'var(--info-soft)', border: 'var(--info-border)' },
        sleep: { DEFAULT: 'var(--sleep)', text: 'var(--sleep-text)', soft: 'var(--sleep-soft)', border: 'var(--sleep-border)' },
        muted: { DEFAULT: 'var(--muted)', text: 'var(--muted-text)', soft: 'var(--muted-soft)', border: 'var(--muted-border)' },
        svc: {
          1: 'var(--svc-1)',
          2: 'var(--svc-2)',
          3: 'var(--svc-3)',
          4: 'var(--svc-4)',
          5: 'var(--svc-5)',
          6: 'var(--svc-6)',
          7: 'var(--svc-7)',
          8: 'var(--svc-8)',
        },
      },
      borderColor: { DEFAULT: 'var(--border)' },
      ringColor: { DEFAULT: 'var(--ring)' },
      fontFamily: {
        sans: ['"Geist Variable"', 'ui-sans-serif', 'system-ui', '-apple-system', '"Segoe UI"', 'sans-serif'],
        mono: ['"Geist Mono Variable"', 'ui-monospace', '"SF Mono"', 'Menlo', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
};
