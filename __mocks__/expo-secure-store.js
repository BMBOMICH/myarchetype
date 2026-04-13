// __mocks__/expo-secure-store.js
'use strict';

const store = new Map();

module.exports = {
  setItemAsync: jest.fn(async (key, value) => { store.set(key, value); }),
  getItemAsync: jest.fn(async (key) => store.get(key) ?? null),
  deleteItemAsync: jest.fn(async (key) => { store.delete(key); }),
  isAvailableAsync: jest.fn(async () => true),
};