const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  ...expoConfig,
  {
    ignores: [
      'node_modules/**',
      'functions/**',
      'dist/**',
      'web-build/**',
      '.expo/**',
    ],
  },
  {
    rules: {
      'no-unused-vars': 'warn',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
]);