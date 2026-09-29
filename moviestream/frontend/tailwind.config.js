/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        stream: {
          dark: '#080b13',
          card: '#0f172a',
          border: '#1e293b',
          accent: '#6366f1',
          neon: '#06b6d4',
          glow: '#a855f7'
        }
      }
    },
  },
  plugins: [],
}
