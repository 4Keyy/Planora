import type { Config } from "tailwindcss"

const config = {
  darkMode: ["class"],
  content: [
    './pages/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './app/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
  ],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "-apple-system", "sans-serif"],
      },
      colors: {
        // ===== UNIFIED COLOR SYSTEM =====
        white: '#ffffff',
        black: '#000000',
        
        // Gray scale (production-grade neutral palette)
        gray: {
          50: '#fafafa',
          100: '#f5f5f5',
          150: '#eeeeee',
          200: '#e5e5e5',
          300: '#d4d4d4',
          400: '#a3a3a3',
          500: '#737373',
          600: '#525252',
          700: '#404040',
          800: '#262626',
          900: '#171717',
        },
        
        // Primary (black-based premium)
        primary: {
          DEFAULT: '#000000',
          hover: '#1a1a1a',
          active: '#0a0a0a',
          foreground: '#ffffff',
        },
        
        // Secondary (warm gray)
        secondary: {
          DEFAULT: '#f5f5f5',
          hover: '#eeeeee',
          active: '#e5e5e5',
          foreground: '#171717',
        },
        
        // Accent (blue for CTAs)
        accent: {
          DEFAULT: '#0ea5e9',
          hover: '#0284c7',
          active: '#0369a1',
          foreground: '#ffffff',
        },
        
        // Status colors
        success: {
          DEFAULT: '#10b981',
          hover: '#059669',
          foreground: '#ffffff',
          bg: '#f0fdf4',
          border: '#bbf7d0',
        },
        
        error: {
          DEFAULT: '#ef4444',
          hover: '#dc2626',
          foreground: '#ffffff',
          bg: '#fef2f2',
          border: '#fecaca',
        },
        
        warning: {
          DEFAULT: '#f59e0b',
          hover: '#d97706',
          foreground: '#ffffff',
          bg: '#fffbeb',
          border: '#fde68a',
        },
        
        info: {
          DEFAULT: '#3b82f6',
          hover: '#2563eb',
          foreground: '#ffffff',
          bg: '#eff6ff',
          border: '#bfdbfe',
        },
        
        // Legacy support (mapped to new system)
        background: '#fafafa',
        foreground: '#171717',
        border: '#e5e5e5',
        input: '#e5e5e5',
        ring: '#000000',
        
        card: {
          DEFAULT: '#ffffff',
          foreground: '#171717',
        },
        popover: {
          DEFAULT: '#ffffff',
          foreground: '#171717',
        },
      },
      borderRadius: {
        none: '0',
        sm: '6px',
        md: '10px',
        lg: '14px',
        xl: '16px',
        '2xl': '20px',
        '3xl': '24px',
        full: '9999px',
      },
      boxShadow: {
        // ===== UNIFIED SHADOW SYSTEM =====
        none: 'none',
        
        // Soft shadows (default state)
        soft: '0 1px 2px rgba(0, 0, 0, 0.04), 0 2px 4px rgba(0, 0, 0, 0.02)',
        'soft-md': '0 2px 4px rgba(0, 0, 0, 0.04), 0 4px 8px rgba(0, 0, 0, 0.03)',
        'soft-lg': '0 4px 8px rgba(0, 0, 0, 0.04), 0 8px 16px rgba(0, 0, 0, 0.04)',
        'soft-xl': '0 8px 16px rgba(0, 0, 0, 0.06), 0 12px 24px rgba(0, 0, 0, 0.05)',
        
        // Hover shadows (elevated state)
        hover: '0 4px 12px rgba(0, 0, 0, 0.08), 0 8px 20px rgba(0, 0, 0, 0.06)',
        'hover-lg': '0 8px 20px rgba(0, 0, 0, 0.10), 0 16px 32px rgba(0, 0, 0, 0.08)',
        
        // Focus ring
        focus: '0 0 0 3px rgba(0, 0, 0, 0.08)',
        'focus-accent': '0 0 0 3px rgba(14, 165, 233, 0.20)',
        
        // Inner shadows
        inner: 'inset 0 2px 4px rgba(0, 0, 0, 0.06)',
      },
      transitionTimingFunction: {
        spring: 'cubic-bezier(0.16, 1, 0.3, 1)',
        smooth: 'cubic-bezier(0.4, 0, 0.2, 1)',
        bounce: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
      },
      transitionDuration: {
        fast: '150ms',
        normal: '250ms',
        slow: '350ms',
        slower: '500ms',
      },
      spacing: {
        '18': '4.5rem',
        '88': '22rem',
        '128': '32rem',
      },
      // ===== Z-INDEX HIERARCHY =====
      zIndex: {
        base: '0',
        dropdown: '1000',
        sticky: '1100',
        overlay: '1200',
        modal: '1300',
        popover: '1400',
        toast: '1500',
        tooltip: '1600',
      },
      keyframes: {
        // Premium animations
        "fade-in": {
          "0%": { opacity: "0", transform: "scale(0.98)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        "fade-out": {
          "0%": { opacity: "1", transform: "scale(1)" },
          "100%": { opacity: "0", transform: "scale(0.98)" },
        },
        "slide-in": {
          "0%": { transform: "translateY(-8px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
        "slide-out": {
          "0%": { transform: "translateY(0)", opacity: "1" },
          "100%": { transform: "translateY(-8px)", opacity: "0" },
        },
        // Smooth expand (for accordions, dropdowns)
        "expand": {
          "0%": { height: "0", opacity: "0" },
          "100%": { height: "var(--radix-accordion-content-height)", opacity: "1" },
        },
        "collapse": {
          "0%": { height: "var(--radix-accordion-content-height)", opacity: "1" },
          "100%": { height: "0", opacity: "0" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
        "fade-out": "fade-out 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
        "slide-in": "slide-in 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
        "slide-out": "slide-out 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
        "expand": "expand 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
        "collapse": "collapse 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config

export default config
