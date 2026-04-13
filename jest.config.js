// jest.config.js
'use strict';

/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',

  // Define globals that React Native / Expo expect
  globals: {
    __DEV__: true,
    'ts-jest': {
      tsconfig: {
        jsx: 'react-jsx',
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
        // Disable verbatimModuleSyntax for tests — it breaks CommonJS Jest
        verbatimModuleSyntax: false,
        module: 'commonjs',
        moduleResolution: 'node',
      },
      diagnostics: {
        warnOnly: true,
      },
    },
  },

  transform: {
    '^.+\\.(ts|tsx)$': 'ts-jest',
    '^.+\\.(js|jsx)$': 'babel-jest',
  },

  transformIgnorePatterns: [
    'node_modules/(?!(' +
      'react-native|' +
      '@react-native|' +
      '@react-native-community|' +
      'expo|' +
      '@expo|' +
      'expo-router|' +
      'expo-camera|' +
      'expo-location|' +
      'expo-notifications|' +
      'expo-secure-store|' +
      'expo-crypto|' +
      'expo-modules-core|' +
      'expo-av|' +
      '@unimodules|' +
      'react-navigation|' +
      '@react-navigation|' +
      'react-native-reanimated|' +
      'react-native-svg|' +
      '@gorhom|' +
      '@sentry/react-native' +
    '))',
  ],

  moduleNameMapper: {
    // Static assets
    '\\.(jpg|jpeg|png|gif|webp|svg|ttf|woff|woff2|eot|otf)$':
      '<rootDir>/__mocks__/fileMock.js',

    // Path aliases
    '^@/(.*)$': '<rootDir>/$1',

    // Mock ALL expo modules to avoid __DEV__ / native module crashes
    '^expo-crypto$': '<rootDir>/__mocks__/expo-crypto.js',
    '^expo-secure-store$': '<rootDir>/__mocks__/expo-secure-store.js',
    '^expo-camera$': '<rootDir>/__mocks__/expo-camera.js',
    '^expo-location$': '<rootDir>/__mocks__/expo-location.js',
    '^expo-av$': '<rootDir>/__mocks__/expo-av.js',
    '^expo-modules-core$': '<rootDir>/__mocks__/expo-modules-core.js',
    '^expo-notifications$': '<rootDir>/__mocks__/expo-notifications.js',
    '^expo-router$': '<rootDir>/__mocks__/expo-router.js',

    // Mock react-native
    '^react-native$': '<rootDir>/__mocks__/react-native.js',
    '^react-native/(.*)$': '<rootDir>/__mocks__/react-native.js',

    // Mock firebase
    '^firebase/(.*)$': '<rootDir>/__mocks__/firebase.js',
    '^@firebase/(.*)$': '<rootDir>/__mocks__/firebase.js',

    // Mock firebaseConfig
    '^../firebaseConfig$': '<rootDir>/__mocks__/firebaseConfig.js',
    '^./firebaseConfig$': '<rootDir>/__mocks__/firebaseConfig.js',
    '^../../firebaseConfig$': '<rootDir>/__mocks__/firebaseConfig.js',
  },

  testMatch: [
    '**/__tests__/**/*.test.ts',
    '**/__tests__/**/*.test.tsx',
    '**/__tests__/**/*.spec.ts',
    '**/__tests__/**/*.spec.tsx',
  ],

  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],

  // Setup file to define globals before tests run
  setupFiles: ['<rootDir>/__mocks__/setup.js'],

  collectCoverageFrom: [
    'utils/**/*.{ts,tsx}',
    'app/**/*.{ts,tsx}',
    '!**/*.d.ts',
    '!**/node_modules/**',
    '!**/__mocks__/**',
  ],
};