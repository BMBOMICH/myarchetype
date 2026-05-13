import React, { useEffect } from 'react';
import { Text, View } from 'react-native';
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { StyleSheet } from 'react-native-unistyles';
import { BAR_ANIM_MS, BAR_DELAY_MS } from '@/app/personality-quiz.data';
import type { TraitScore, TraitDef } from '@/app/personality-quiz.data';

interface Props {
  trait: TraitScore;
  def:   TraitDef;
  index: number;
}

export const TraitBar = React.memo(function TraitBar({ trait, def, index }: Props) {
  const progress = useSharedValue(0);
  const opacity  = useSharedValue(0);

  useEffect(() => {
    const id = setTimeout(() => {
      progress.value = withTiming(trait.score, { duration: BAR_ANIM_MS });
      opacity.value  = withTiming(1, { duration: BAR_ANIM_MS / 2 });
    }, index * BAR_DELAY_MS);
    return () => { clearTimeout(id); cancelAnimation(progress); cancelAnimation(opacity); };
  }, [trait.score, index, progress, opacity]);

  const containerStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const fillStyle      = useAnimatedStyle(() => ({ width: `${progress.value}%` as `${number}%` }));
  const dotStyle       = useAnimatedStyle(() => ({ left:  `${progress.value}%` as `${number}%` }));

  return (
    <Animated.View style={[st.trRow, containerStyle]} accessible accessibilityLabel={`${def.name}: ${trait.label}, ${trait.score}%`}>
      <View style={st.trLabels}>
        <Text style={st.trLow}>{def.lowEmoji} {def.lowLabel}</Text>
        <Text style={st.trHigh}>{def.highLabel} {def.highEmoji}</Text>
      </View>
      <View style={st.trBarBg}>
        <Animated.View style={[st.trBarFill, { backgroundColor: def.color }, fillStyle]} />
        <Animated.View style={[st.trDot,    { backgroundColor: def.color }, dotStyle]}  />
      </View>
      <View style={st.trBottom}>
        <Text style={[st.trLabel, { color: def.color }]}>{trait.label} ({trait.score}%)</Text>
        <Text style={st.trConsist}>{trait.consistency >= 80 ? '🎯' : trait.consistency >= 60 ? '🔄' : '🤷'} {trait.consistency}%</Text>
      </View>
    </Animated.View>
  );
});

const st = StyleSheet.create((theme) => ({
  trRow:    { marginBottom: 18 },
  trLabels: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 },
  trLow:    { color: theme.colors.textSecondary, fontSize: 11 },
  trHigh:   { color: theme.colors.textSecondary, fontSize: 11 },
  trBarBg:  { height: 12, backgroundColor: '#2a2a3e', borderRadius: 6, overflow: 'visible', position: 'relative' },
  trBarFill:{ height: '100%', borderRadius: 6 },
  trDot:    { position: 'absolute', top: -4, width: 20, height: 20, borderRadius: 10, marginLeft: -10, borderWidth: 3, borderColor: theme.colors.background },
  trBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 5 },
  trLabel:  { fontSize: 12, fontWeight: '600' },
  trConsist:{ fontSize: 10, color: '#888' },
}));