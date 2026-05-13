/* global module */
'use strict';

/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',

  // ✅ FIXED: ts-jest config moved here (eliminates deprecated `globals` warning)
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', {
      tsconfig: {
        jsx: 'react-jsx',
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
        verbatimModuleSyntax: false,
        module: 'commonjs',
        moduleResolution: 'node',
      },
      diagnostics: { warnOnly: true },
    }],
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
    '\\.(jpg|jpeg|png|gif|webp|svg|ttf|woff|woff2|eot|otf)$':
      '<rootDir>/__mocks__/fileMock.js',
    '^@/(.*)$': '<rootDir>/$1',
    '^expo-crypto$': '<rootDir>/__mocks__/expo-crypto.js',
    '^expo-secure-store$': '<rootDir>/__mocks__/expo-secure-store.js',
    '^expo-camera$': '<rootDir>/__mocks__/expo-camera.js',
    '^expo-location$': '<rootDir>/__mocks__/expo-location.js',
    '^expo-av$': '<rootDir>/__mocks__/expo-av.js',
    '^expo-modules-core$': '<rootDir>/__mocks__/expo-modules-core.js',
    '^expo-notifications$': '<rootDir>/__mocks__/expo-notifications.js',
    '^expo-router$': '<rootDir>/__mocks__/expo-router.js',
    '^react-native$': '<rootDir>/__mocks__/react-native.js',
    '^react-native/(.*)$': '<rootDir>/__mocks__/react-native.js',
    '^firebase/(.*)$': '<rootDir>/__mocks__/firebase.js',
    '^@firebase/(.*)$': '<rootDir>/__mocks__/firebase.js',
    '^../firebaseConfig$': '<rootDir>/__mocks__/firebaseConfig.js',
    '^./firebaseConfig$': '<rootDir>/__mocks__/firebaseConfig.js',
    '^../../firebaseConfig$': '<rootDir>/__mocks__/firebaseConfig.js',
  },

  testMatch: [
    '**/__tests__/**/*.test.ts',
    '**/__tests__/**/*.test.tsx',
    '**/__tests__/**/*.spec.ts',
    '**/__tests__/**/*.spec.tsx',
    '**/scripts/**/*.test.ts', // ✅ Discovers audit-core tests
  ],

  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],

  setupFiles: ['<rootDir>/__mocks__/setup.js'],

  collectCoverageFrom: [
    'utils/**/*.{ts,tsx}',
    'app/**/*.{ts,tsx}',
    '!**/*.d.ts',
    '!**/node_modules/**',
    '!**/__mocks__/**',
  ],
};