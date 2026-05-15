/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        canvas: 'hsl(var(--color-canvas))',
        surface: {
          1: 'hsl(var(--color-surface-1))',
          2: 'hsl(var(--color-surface-2))',
          3: 'hsl(var(--color-surface-3))',
          4: 'hsl(var(--color-surface-4))',
        },
        hairline: {
          DEFAULT: 'hsl(var(--color-hairline))',
          strong: 'hsl(var(--color-hairline-strong))',
          tertiary: 'hsl(var(--color-hairline-tertiary))',
        },
        ink: {
          DEFAULT: 'hsl(var(--color-ink))',
          muted: 'hsl(var(--color-ink-muted))',
          subtle: 'hsl(var(--color-ink-subtle))',
          tertiary: 'hsl(var(--color-ink-tertiary))',
        },
        accent: {
          DEFAULT: 'hsl(var(--color-accent))',
          hover: 'hsl(var(--color-accent-hover))',
        },
        // Keep existing amber palette for direct usage
        amber: {
          400: '#fcd34d',
          500: '#fbbf24',
          600: '#f59e0b',
        },
      },
    },
  },
  plugins: [],
};
