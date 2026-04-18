const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.transformer = {
  ...config.transformer,
  inlineRequires: true,
  minifierConfig: {
    compress: { keep_classnames: true, keep_fnames: true },
    mangle:   { keep_classnames: true, keep_fnames: true },
  },
};

config.resolver = {
  ...config.resolver,
  unstable_enablePackageExports: true,
};

module.exports = config;