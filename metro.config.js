// metro.config.js
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Preserve class/function names in production (critical for Sentry/error tracking)
config.transformer.minifierConfig = {
  compress: { keep_classnames: true, keep_fnames: true },
  mangle: { keep_classnames: true, keep_fnames: true },
};

// Note: console.log stripping is already handled by babel.config.js
// inlineRequires is enabled by default in Expo 55 / RN 0.83+

module.exports = config;