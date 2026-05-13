import React, { useMemo } from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { AVATAR_SIZE } from './types';

interface SkeletonBoxProps {
  width: number | `${number}%`;
  height: number;
  radius?: number;
  style?: object;
}

export const SkeletonBox = React.memo(function SkeletonBox({
  width, height, radius, style,
}: SkeletonBoxProps) {
  const boxStyle = useMemo(
    () => [
      styles.box,
      { width, height, borderRadius: radius ?? styles.box.borderRadius },
      style,
    ],
    [width, height, radius, style],
  );
  return (
    <View
      style={boxStyle}
      importantForAccessibility="no"
      accessibilityElementsHidden
    />
  );
});

export const HomeScreenSkeleton = React.memo(function HomeScreenSkeleton({
  insets,
}: {
  insets: { top: number; bottom: number };
}) {
  const screenStyle = useMemo(
    () => [
      screenStyles.screen,
      { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 40 },
    ],
    [insets.top, insets.bottom],
  );
  return (
    <View style={screenStyle} accessibilityLabel="Loading home screen">
      <View style={screenStyles.header}>
        <SkeletonBox width={AVATAR_SIZE} height={AVATAR_SIZE} radius={9999} />
        <SkeletonBox width={140} height={18} style={{ marginTop: 16 }} />
        <SkeletonBox width={200} height={30} style={{ marginTop: 8 }} />
      </View>
      <SkeletonBox width="100%" height={120} style={{ marginTop: 20 }} />
      <SkeletonBox width="100%" height={70}  style={{ marginTop: 16 }} />
      <View style={screenStyles.grid}>
        {(['sk0','sk1','sk2','sk3','sk4','sk5'] as const).map((k) => (
          <SkeletonBox key={k} width="48%" height={56} radius={25} />
        ))}
      </View>
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  box: {
    borderRadius:    theme.radius.md,
    backgroundColor: theme.colors.surface,
  },
}));

const screenStyles = StyleSheet.create((theme) => ({
  screen: {
    flex:              1,
    backgroundColor:   theme.colors.background,
    alignItems:        'center',
    paddingHorizontal: theme.spacing.xl,
  },
  header: { alignItems: 'center' },
  grid: {
    flexDirection:  'row',
    flexWrap:       'wrap',
    justifyContent: 'space-between',
    width:          '100%',
    gap:            theme.spacing.sm,
    marginTop:      theme.spacing.xl,
  },
}));