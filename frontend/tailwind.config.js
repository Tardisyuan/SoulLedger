/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        canvas: '#010102',
        surface: {
          1: '#0f1011',
          2: '#141516',
          3: '#18191a',
          4: '#191a1b',
        },
        hairline: {
          DEFAULT: '#23252a',
          strong: '#34343a',
          tertiary: '#3e3e44',
        },
        ink: {
          DEFAULT: '#f7f8f8',
          muted: '#d0d6e0',
          subtle: '#8a8f98',
          tertiary: '#62666d',
        },
        border: "hsl(var(--border))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
      },
    },
  },
  plugins: [],
};
