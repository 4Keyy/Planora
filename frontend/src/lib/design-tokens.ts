/**
 * 🎨 DESIGN SYSTEM - Single Source of Truth
 * Production-grade design tokens for Planora
 * 
 * ALL visual styles MUST reference these tokens.
 * NO inline colors, shadows, or arbitrary values in components.
 */

export const designTokens = {
  // ============ COLORS ============
  colors: {
    // Base neutrals
    white: '#ffffff',
    black: '#000000',
    
    // Gray scale (single source)
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
    
    // Primary (black-based for premium feel)
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
    
    // Priority colors (for todos)
    priority: {
      veryLow: { bg: '#fafafa', text: '#737373', border: '#e5e5e5' },
      low: { bg: '#f0fdf4', text: '#059669', border: '#bbf7d0' },
      medium: { bg: '#eff6ff', text: '#2563eb', border: '#bfdbfe' },
      high: { bg: '#fff7ed', text: '#ea580c', border: '#fed7aa' },
      urgent: { bg: '#fef2f2', text: '#dc2626', border: '#fecaca' },
    },
  },

  // ============ SPACING ============
  spacing: {
    // 4px base scale
    0: '0',
    1: '0.25rem',   // 4px
    2: '0.5rem',    // 8px
    3: '0.75rem',   // 12px
    4: '1rem',      // 16px
    5: '1.25rem',   // 20px
    6: '1.5rem',    // 24px
    8: '2rem',      // 32px
    10: '2.5rem',   // 40px
    12: '3rem',     // 48px
    16: '4rem',     // 64px
    20: '5rem',     // 80px
    24: '6rem',     // 96px
  },

  // ============ BORDER RADIUS ============
  radius: {
    none: '0',
    sm: '6px',
    md: '10px',
    lg: '14px',
    xl: '16px',
    '2xl': '20px',
    '3xl': '24px',
    full: '9999px',
  },

  // ============ SHADOWS (Premium layered system) ============
  shadows: {
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

  // ============ Z-INDEX (Hierarchy control) ============
  zIndex: {
    base: 0,
    dropdown: 1000,
    sticky: 1100,
    overlay: 1200,
    modal: 1300,
    popover: 1400,
    toast: 1500,
    tooltip: 1600,
  },

  // ============ TYPOGRAPHY ============
  typography: {
    fontFamily: {
      sans: 'var(--font-manrope), system-ui, -apple-system, sans-serif',
    },
    
    fontSize: {
      xs: ['0.75rem', { lineHeight: '1rem' }],      // 12px
      sm: ['0.875rem', { lineHeight: '1.25rem' }],  // 14px
      base: ['1rem', { lineHeight: '1.5rem' }],     // 16px
      lg: ['1.125rem', { lineHeight: '1.75rem' }],  // 18px
      xl: ['1.25rem', { lineHeight: '1.75rem' }],   // 20px
      '2xl': ['1.5rem', { lineHeight: '2rem' }],    // 24px
      '3xl': ['1.875rem', { lineHeight: '2.25rem' }], // 30px
      '4xl': ['2.25rem', { lineHeight: '2.5rem' }], // 36px
    },
    
    fontWeight: {
      normal: '400',
      medium: '500',
      semibold: '600',
      bold: '700',
    },
  },

  // ============ TRANSITIONS ============
  transitions: {
    duration: {
      fast: '150ms',
      normal: '250ms',
      slow: '350ms',
      slower: '500ms',
    },
    
    easing: {
      // Premium spring easing
      spring: 'cubic-bezier(0.16, 1, 0.3, 1)',
      // Standard easing
      smooth: 'cubic-bezier(0.4, 0, 0.2, 1)',
      // Bounce effect
      bounce: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
    },
  },

  // ============ COMPONENT SIZES ============
  components: {
    // Button heights
    button: {
      sm: '36px',
      md: '40px',
      lg: '48px',
    },
    
    // Input heights (match buttons for consistency)
    input: {
      sm: '36px',
      md: '40px',
      lg: '48px',
    },
    
    // Icon sizes
    icon: {
      xs: '14px',
      sm: '16px',
      md: '20px',
      lg: '24px',
      xl: '32px',
    },
  },
} as const

/**
 * Helper to get shadow with proper z-index
 */
export function getLayerStyles(layer: keyof typeof designTokens.zIndex) {
  return {
    zIndex: designTokens.zIndex[layer],
  }
}

/**
 * Helper to generate consistent focus styles
 */
export function getFocusStyles(variant: 'default' | 'accent' = 'default') {
  const shadow = variant === 'accent' 
    ? designTokens.shadows['focus-accent'] 
    : designTokens.shadows.focus
    
  return {
    outline: 'none',
    boxShadow: shadow,
  }
}

export type DesignTokens = typeof designTokens
