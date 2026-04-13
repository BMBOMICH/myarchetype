// __mocks__/firebaseConfig.js
'use strict';

module.exports = {
  auth: {
    currentUser: { uid: 'test-uid', email: 'test@test.com' },
    onAuthStateChanged: jest.fn(),
  },
  db: {},
  storage: {},
  app: {},
};