// __mocks__/expo-camera.js
'use strict';

module.exports = {
  Camera: {
    requestCameraPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
    getCameraPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  },
  CameraType: { front: 'front', back: 'back' },
  FlashMode: { off: 'off', on: 'on', auto: 'auto' },
};