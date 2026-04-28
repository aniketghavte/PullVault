import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        // Vault palette: deep indigo + neon yellow accents.
        vault: {
          bg: '#0b0d14',
          surface: '#13162199',
          card: '#1a1d2b',
          border: '#262a3d',
          accent: '#facc15',
          danger: '#ef4444',
          success: '#22c55e',
        },
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
      },
      animation: {
        'pulse-slow': 'pulse 2.5s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
    },
  },
  plugins: [],
};

export default config;
