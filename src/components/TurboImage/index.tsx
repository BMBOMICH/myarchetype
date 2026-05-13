import React from 'react';
import { Image, type ImageProps, type ImageStyle, type StyleProp } from 'react-native';

interface Props {
  source: { uri: string };
  style?: StyleProp<ImageStyle>;
  cachePolicy?: string; // ignored on web
  accessibilityLabel?: string;
  resizeMode?: ImageProps['resizeMode'];
}

export default function TurboImage({ source, style, accessibilityLabel, resizeMode }: Props) {
  return (
    <Image
      source={source}
      style={style}
      accessibilityLabel={accessibilityLabel}
      resizeMode={resizeMode}
    />
  );
}