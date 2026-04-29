import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        // Cohere-inspired palette (from the user-provided theme brief).
        brandBlack: '#000000',
        nearBlack: '#17171c',
        deepEnterpriseGreen: '#003c33',
        darkNavy: '#071829',
        actionBlue: '#1863dc',
        coral: '#ff7759',
        softCoral: '#ffad9b',

        // Surfaces
        canvas: '#ffffff',
        stone: '#eeece7',
        paleGreenWash: '#edfce9',
        paleBlueWash: '#f1f5ff',
        cardBorder: '#f2f2f2',

        // Text + rules
        ink: '#212121',
        mutedSlate: '#93939f',
        slate: '#75758a',
        hairline: '#d9d9dd',
        borderLight: '#e5e7eb',

        // Focus / semantic
        focusBlue: '#4c6ee6',
        formFocusViolet: '#9b60aa',
        errorRed: '#b30000',
      },
      fontFamily: {
        // Next/font will provide CSS variables in layout.tsx.
        display: ['var(--font-space-grotesk)', 'Inter', 'system-ui', 'sans-serif'],
        sans: ['var(--font-inter)', 'Arial', 'system-ui', 'sans-serif'],
        mono: ['var(--font-jetbrains-mono)', 'JetBrains Mono', 'Arial', 'ui-sans-serif', 'sans-serif'],
      },
      borderRadius: {
        xs: '4px',
        sm: '8px',
        md: '16px',
        lg: '22px',
        xl: '30px',
        pill: '32px',
        full: '9999px',
      },
      letterSpacing: {
        // For brief-accurate display headlines.
        displayTight: '-1.92px',
        displayProductTight: '-1.44px',
        sectionHeadingTight: '-0.48px',
      },
      fontSize: {
        hero: ['96px', { lineHeight: '1', letterSpacing: '-1.92px', fontWeight: '400' }],
        productDisplay: ['72px', { lineHeight: '1', letterSpacing: '-1.44px', fontWeight: '400' }],
        sectionDisplay: ['60px', { lineHeight: '1', letterSpacing: '-1.2px', fontWeight: '400' }],
        sectionHeading: ['48px', { lineHeight: '1.2', letterSpacing: '-0.48px', fontWeight: '400' }],
        cardHeading: ['32px', { lineHeight: '1.2', letterSpacing: '-0.32px', fontWeight: '400' }],
        featureHeading: ['24px', { lineHeight: '1.3', letterSpacing: '0px', fontWeight: '400' }],
        bodyLarge: ['18px', { lineHeight: '1.4', letterSpacing: '0px', fontWeight: '400' }],
        body: ['16px', { lineHeight: '1.5', letterSpacing: '0px', fontWeight: '400' }],
        button: ['14px', { lineHeight: '1.71', letterSpacing: '0px', fontWeight: '500' }],
        caption: ['14px', { lineHeight: '1.4', letterSpacing: '0px', fontWeight: '400' }],
        monoLabel: ['14px', { lineHeight: '1.4', letterSpacing: '0.28px', fontWeight: '400' }],
        micro: ['12px', { lineHeight: '1.4', letterSpacing: '0px', fontWeight: '400' }],
      },
      animation: {
        'pulse-slow': 'pulse 2.5s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
    },
  },
  plugins: [],
};

export default config;
