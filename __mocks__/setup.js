// __mocks__/setup.js
// Define globals that React Native / Expo expect but Jest doesn't provide

global.__DEV__ = true;
global.__EXPO_ENV__ = 'test';

// Prevent console noise during tests
global.console = {
  ...console,
  // Keep errors and warnings visible
  error: console.error,
  warn: console.warn,
  // Silence info and log in tests
  log: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
};

// Mock fetch globally
global.fetch = jest.fn().mockResolvedValue({
  ok: true,
  status: 200,
  json: jest.fn().mockResolvedValue({}),
  text: jest.fn().mockResolvedValue(''),
  headers: { get: jest.fn().mockReturnValue(null) },
});

// Mock crypto for Node environment
const { webcrypto } = require('crypto');
global.crypto = webcrypto;