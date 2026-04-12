// metro.config.js
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.transformer.minifierConfig = {
  keep_classnames: true,
  keep_fnames: true,
  mangle: { keep_classnames: true, keep_fnames: true },
};

// Remove console.log in production
config.transformer.transform = {
  ...config.transformer.transform,
  inlineRequires: true,
};

module.exports = config;