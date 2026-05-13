import React from 'react';
import { View } from 'react-native';

export const CameraView = React.forwardRef<any, any>((props, ref) =>
  React.createElement(View, { style: props.style, ref }, props.children)
);

export const useCameraPermissions = () =>
  [{ granted: true }, () => Promise.resolve({ granted: true })] as const;