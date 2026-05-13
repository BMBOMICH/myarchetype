const { getDefaultConfig } = require('expo/metro-config');

const defaultConfig = getDefaultConfig(__dirname);

const metroConfig = {
  ...defaultConfig,
  transformer: {
    ...defaultConfig.transformer,
    inlineRequires: true,
    minifierConfig: {
      compress: { keep_classnames: true, keep_fnames: true },
      mangle: { keep_classnames: true, keep_fnames: true },
    },
  },
  resolver: {
    ...defaultConfig.resolver,
    unstable_enablePackageExports: true,
    extraNodeModules: (() => {
      const base = defaultConfig.resolver.extraNodeModules || {};
      try {
        return {
          ...base,
          crypto: require.resolve('react-native-quick-crypto'),
        };
      } catch {
        return base;
      }
    })(),
  },
};

module.exports = metroConfig;