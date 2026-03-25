// utils/logger.ts

const isDev = __DEV__;

export const logger = {
  log: (...args: unknown[]) => {
    if (isDev) console.log('[App]', ...args);
  },
  error: (...args: unknown[]) => {
    if (isDev) console.error('[App]', ...args);
    // In production you would send to Sentry/Crashlytics here
  },
  warn: (...args: unknown[]) => {
    if (isDev) console.warn('[App]', ...args);
  },
  info: (...args: unknown[]) => {
    if (isDev) console.info('[App]', ...args);
  },
};