// __mocks__/expo-modules-core.js
'use strict';

module.exports = {
  EventEmitter: jest.fn().mockImplementation(() => ({
    addListener: jest.fn(() => ({ remove: jest.fn() })),
    removeAllListeners: jest.fn(),
    emit: jest.fn(),
  })),
  NativeModule: {},
  SharedObject: jest.fn(),
  Platform: {
    OS: 'ios',
    select: (obj) => obj.ios ?? obj.default,
  },
  CodedError: class CodedError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  },
  UnavailabilityError: class UnavailabilityError extends Error {
    constructor(moduleName, propName) {
      super(`${moduleName}.${propName} is not available`);
    }
  },
  requireNativeModule: jest.fn(() => ({})),
  requireOptionalNativeModule: jest.fn(() => null),
  NativeModulesProxy: {},
  LegacyEventEmitter: jest.fn().mockImplementation(() => ({
    addListener: jest.fn(() => ({ remove: jest.fn() })),
    removeAllListeners: jest.fn(),
  })),
};