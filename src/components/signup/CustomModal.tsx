import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { IS_WEB } from './constants';
import { getAnimDuration } from './utils';
import { s } from './styles';
import type { ModalConfig, Tokens, WebAriaProps, WebKeyEvent } from './types';

const ModalButton = React.memo(function ModalButton({
  btn, onClose, C,
}: {
  btn: ModalConfig['buttons'][0];
  onClose: (btn?: ModalConfig['buttons'][0]) => Promise<void>;
  C: Tokens;
}) {
  const btnTextStyle = useMemo(() => [
    s.modalButtonText,
    { color: btn.primary ? C.white : C.textSecondary, fontWeight: btn.primary ? '700' as const : '500' as const },
  ], [btn.primary, C.white, C.textSecondary]);

  return (
    <Pressable
      onPress={() => void onClose(btn)}
      style={({ pressed }) => [
        s.modalButton,
        {
          backgroundColor: btn.primary ? C.accent : 'transparent',
          borderColor:     btn.primary ? C.accent : C.separator,
          opacity:         pressed ? 0.8 : 1,
        },
      ]}
      accessibilityRole="button"
      accessibilityLabel={btn.label}
    >
      <Text style={btnTextStyle}>{btn.label}</Text>
    </Pressable>
  );
});

export const CustomModal = React.memo(function CustomModal({
  config, onClose, C,
}: { config: ModalConfig; onClose: () => void; C: Tokens }) {
  const opacity = useSharedValue(0);
  const scale   = useSharedValue(0.92);
  const closing = useRef(false);

  const overlayStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const cardStyle    = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const doClose = useCallback(async (btn?: ModalConfig['buttons'][0]) => {
    if (closing.current) return;
    closing.current = true;
    opacity.value = withTiming(0, { duration: getAnimDuration(150) });
    setTimeout(async () => {
      if (btn?.onPress) await btn.onPress();
      onClose();
    }, getAnimDuration(160));
  }, [opacity, onClose]);

  useEffect(() => {
    opacity.value = withTiming(1, { duration: getAnimDuration(200) });
    scale.value   = withSpring(1, { speed: 20, damping: 10 });

    if (!IS_WEB) return;
    const h = (e: unknown) => {
      const key = typeof e === 'object' && e !== null && 'key' in e
        ? (e as WebKeyEvent).key : undefined;
      if (key === 'Escape') void doClose();
    };
    window.addEventListener?.('keydown', h);
    return () => window.removeEventListener?.('keydown', h);
  }, [opacity, scale, doClose]);

  const modalOverlayStyle = useMemo(() => [s.modalOverlay, { backgroundColor: C.overlay },     overlayStyle], [C.overlay, overlayStyle]);
  const modalCardStyle    = useMemo(() => [s.modalCard,    { backgroundColor: C.card, borderColor: C.cardBorder }, cardStyle], [C.card, C.cardBorder, cardStyle]);
  const modalTitleStyle   = useMemo(() => [s.modalTitle,   { color: C.textPrimary }],           [C.textPrimary]);
  const modalMessageStyle = useMemo(() => [s.modalMessage, { color: C.textSecondary }],         [C.textSecondary]);

  const webDialogProps: WebAriaProps = IS_WEB ? { role: 'dialog', 'aria-modal': 'true' } : {};

  return (
    <Animated.View style={modalOverlayStyle} {...webDialogProps} accessibilityViewIsModal>
      <Pressable style={s.modalBackdrop} onPress={() => void doClose()} accessibilityLabel="Close dialog" />
      <Animated.View style={modalCardStyle}>
        <Text style={modalTitleStyle}>{config.title}</Text>
        <Text style={modalMessageStyle}>{config.message}</Text>
        <View style={s.modalButtons}>
          {config.buttons.map((btn, i) => (
            <ModalButton key={i} btn={btn} onClose={doClose} C={C} />
          ))}
        </View>
      </Animated.View>
    </Animated.View>
  );
});