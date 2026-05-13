import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { getAnimDuration } from './utils';
import { s } from './styles';
import type { ModalConfig, Tokens, WebAriaProps, WebKeyEvent } from './types';

export const CustomModal = React.memo(({ config, onClose, C }: { config: ModalConfig; onClose: () => void; C: Tokens }) => {
  const opacity   = useSharedValue(0);
  const scale     = useSharedValue(0.92);
  const isClosing = useRef(false);

  const doClose = useCallback(async (btn?: ModalConfig['buttons'][number]) => {
    if (isClosing.current) return;
    isClosing.current = true;
    opacity.value = withTiming(0, { duration: getAnimDuration(150) }, (finished) => {
      if (finished) {
        if (typeof window === 'undefined') {
          if (btn?.onPress) btn.onPress();
          onClose();
        } else {
          Promise.resolve(btn?.onPress?.()).then(() => onClose());
        }
      }
    });
  }, [opacity, onClose]);

  const doCloseRef = useRef(doClose);
  const configRef  = useRef(config);
  useEffect(() => { doCloseRef.current = doClose; }, [doClose]);
  useEffect(() => { configRef.current  = config;  }, [config]);

  useEffect(() => {
    opacity.value = withTiming(1, { duration: getAnimDuration(200) });
    scale.value   = withSpring(1, { mass: 0.4, damping: 18, stiffness: 200 });

    if (typeof window === 'undefined') return;
    const handleKeyDown = (e: unknown) => {
      const key = typeof e === 'object' && e !== null && 'key' in e ? (e as WebKeyEvent).key : undefined;
      if (key === 'Escape') {
        const cancelBtn = configRef.current.buttons.find(b => !b.primary && !b.danger);
        void doCloseRef.current(cancelBtn);
      }
    };
    window.addEventListener?.('keydown', handleKeyDown);
    return () => window.removeEventListener?.('keydown', handleKeyDown);
  }, [opacity, scale]);

  const overlayStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const cardStyle    = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const modalOverlayStyle = useMemo(() => [s.modalOverlay, { backgroundColor: C.overlay }, overlayStyle], [C.overlay, overlayStyle]);
  const modalCardStyle    = useMemo(() => [s.modalCard, { backgroundColor: C.card, borderColor: C.cardBorder }, cardStyle], [C.card, C.cardBorder, cardStyle]);
  const modalTitleStyle   = useMemo(() => [s.modalTitle,   { color: C.textPrimary   }], [C.textPrimary]);
  const modalMessageStyle = useMemo(() => [s.modalMessage, { color: C.textSecondary }], [C.textSecondary]);

  const handleBackdropPress = useCallback(() => {
    const cancelBtn = config.buttons.find(b => !b.primary && !b.danger);
    void doClose(cancelBtn);
  }, [config.buttons, doClose]);

  const webDialogProps: WebAriaProps = typeof window !== 'undefined' ? { role: 'dialog', 'aria-modal': 'true' } : {};

  return (
    <Animated.View style={modalOverlayStyle} {...webDialogProps} accessibilityViewIsModal>
      <Pressable style={s.absoluteFill} onPress={handleBackdropPress} accessibilityLabel="Close dialog" />
      <Animated.View style={modalCardStyle}>
        <Text style={modalTitleStyle}>{config.title}</Text>
        <Text style={modalMessageStyle}>{config.message}</Text>
        <View style={s.modalButtons}>
          {config.buttons.map((btn, i) => {
            const modalBtnTextStyle = [
              s.modalButtonText,
              { color: btn.primary || btn.danger ? C.white : C.textSecondary, fontWeight: (btn.primary ? '700' : '500') as '700' | '500' },
            ];
            return (
              <Pressable
                key={btn.label + i}
                onPress={() => void doClose(btn)}
                style={({ pressed }) => [
                  s.modalButton,
                  { backgroundColor: btn.primary ? C.accent : btn.danger ? C.error : 'transparent', borderColor: btn.primary ? C.accent : btn.danger ? C.error : C.separator, opacity: pressed ? 0.8 : 1 },
                ]}
                accessibilityRole="button"
                accessibilityLabel={btn.label}
              >
                <Text style={modalBtnTextStyle}>{btn.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </Animated.View>
    </Animated.View>
  );
});