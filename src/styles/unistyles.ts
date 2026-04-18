// src/styles/unistyles.ts — FULL UPDATED FILE
import { StyleSheet } from 'react-native-unistyles';

const darkTheme = {
  colors: {
    // ── Core ──────────────────────────────────────────────────────────────
    background:    '#1a1a2e',
    surface:       '#16213e',
    surfaceAlt:    '#0f3460',
    text:          '#ffffff',
    textSecondary: '#aaaaaa',
    textMuted:     '#666666',
    primary:       '#53a8b6',
    primaryDark:   '#3a8a9a',
    accent:        '#e94560',
    border:        '#333333',
    error:         '#e74c3c',
    success:       '#2ecc71',
    warning:       '#f39c12',
    overlay:       'rgba(0,0,0,0.7)',

    // ── Home screen tokens ────────────────────────────────────────────────
    white:         '#ffffff',
    skeleton:      '#253454',
    orange:        '#e67e22',
    purple:        '#9b59b6',
    blue:          '#3498db',
    teal:          '#1abc9c',
    red:           '#e74c3c',
    gold:          '#f1c40f',
    danger:        '#d9534f',
    dim:           '#777777',
  },
  spacing: {
    xs:   4,
    sm:   8,
    md:   16,
    lg:   24,
    xl:   32,
    xxl:  48,
    xxxl: 64,
  },
  radius: {
    sm:   4,
    md:   8,
    lg:   16,
    xl:   24,
    full: 9999,
  },
  typography: {
    h1:      { fontSize: 32, fontWeight: '700' as const },
    h2:      { fontSize: 24, fontWeight: '700' as const },
    h3:      { fontSize: 20, fontWeight: '600' as const },
    body:    { fontSize: 16, fontWeight: '400' as const },
    caption: { fontSize: 12, fontWeight: '400' as const },
    label:   { fontSize: 14, fontWeight: '500' as const },
  },
};

const lightTheme = {
  colors: {
    // ── Core ──────────────────────────────────────────────────────────────
    background:    '#f5f5f7',
    surface:       '#ffffff',
    surfaceAlt:    '#e8e8ed',
    text:          '#1a1a2e',
    textSecondary: '#555555',
    textMuted:     '#888888',
    primary:       '#3a8a9a',
    primaryDark:   '#2a6a7a',
    accent:        '#c73652',
    border:        '#e0e0e0',
    error:         '#c0392b',
    success:       '#27ae60',
    warning:       '#e67e22',
    overlay:       'rgba(0,0,0,0.5)',

    // ── Home screen tokens ────────────────────────────────────────────────
    white:         '#ffffff',
    skeleton:      '#e0e0e0',
    orange:        '#e67e22',
    purple:        '#8e44ad',
    blue:          '#2979ff',
    teal:          '#00897b',
    red:           '#e53935',
    gold:          '#f9a825',
    danger:        '#ea4335',
    dim:           '#999999',
  },
  spacing:    darkTheme.spacing,
  radius:     darkTheme.radius,
  typography: darkTheme.typography,
};

StyleSheet.configure({
  themes:   { light: lightTheme, dark: darkTheme },
  settings: { initialTheme: 'dark' },
});

export type AppTheme = typeof darkTheme;

declare module 'react-native-unistyles' {
  interface UnistylesThemes {
    light: AppTheme;
    dark:  AppTheme;
  }
}