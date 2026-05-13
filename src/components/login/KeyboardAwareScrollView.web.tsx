import React from 'react';
import { ScrollView } from 'react-native';
export const KeyboardAwareScrollView = React.forwardRef<any, any>((props, ref) =>
  React.createElement(ScrollView, { ref, ...props, style: [{ flex: 1 }, props.style] })
);