import type {Config} from 'tailwindcss';
import animate from 'tailwindcss-animate';

export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    container: {center: true, padding: '2rem'},
    extend: {
      fontFamily: {
        sans: [
          'Geist',
          'PingFang SC',
          'Hiragino Sans GB',
          'Noto Sans SC',
          'Microsoft YaHei',
          'system-ui',
          'sans-serif',
        ],
        mono: ['Geist Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {DEFAULT: 'hsl(var(--primary))', foreground: 'hsl(var(--primary-foreground))'},
        secondary: {DEFAULT: 'hsl(var(--secondary))', foreground: 'hsl(var(--secondary-foreground))'},
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        success: {DEFAULT: 'hsl(var(--success))', foreground: 'hsl(var(--success-foreground))'},
        warning: {DEFAULT: 'hsl(var(--warning))', foreground: 'hsl(var(--warning-foreground))'},
        muted: {DEFAULT: 'hsl(var(--muted))', foreground: 'hsl(var(--muted-foreground))'},
        accent: {DEFAULT: 'hsl(var(--accent))', foreground: 'hsl(var(--accent-foreground))'},
        popover: {DEFAULT: 'hsl(var(--popover))', foreground: 'hsl(var(--popover-foreground))'},
        card: {DEFAULT: 'hsl(var(--card))', foreground: 'hsl(var(--card-foreground))'},
        sidebar: {
          DEFAULT: 'hsl(var(--sidebar))',
          foreground: 'hsl(var(--sidebar-foreground))',
          accent: 'hsl(var(--sidebar-accent))',
          'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
          border: 'hsl(var(--sidebar-border))',
        },
        chart: {
          1: 'hsl(var(--chart-1))',
          2: 'hsl(var(--chart-2))',
          3: 'hsl(var(--chart-3))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      keyframes: {
        pulse_dot: {'0%, 100%': {opacity: '1'}, '50%': {opacity: '0.35'}},
      },
      animation: {
        'pulse-dot': 'pulse_dot 1.4s ease-in-out infinite',
      },
    },
  },
  plugins: [animate],
} satisfies Config;
