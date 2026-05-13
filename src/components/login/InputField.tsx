import React, { useEffect, useMemo } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { IS_WEB } from './constants';
import { getAnimDuration } from './utils';
import { AnimatedError } from './AnimatedError';
import { s } from './styles';
import type { TextKeyPressLike, Tokens, WebAriaProps, WebInputProps, WebStyleProps } from './types';

const buildWebInputStyle = (C: Tokens): WebStyleProps => ({
  outline:'none', outlineWidth:0, boxShadow:'none', border:'none',
  WebkitTextFillColor:C.textPrimary, caretColor:C.accent, backgroundColor:'transparent',
  paddingTop:18, paddingBottom:18, paddingLeft:4, flex:1, fontSize:16, letterSpacing:0.2,
  color:C.textPrimary,
});

export const InputField = React.memo(({
  label, icon, placeholder, value, onChangeText, error, focused, onFocus, onBlur, secureTextEntry,
  showPassword, onTogglePassword, keyboardType, autoComplete, textContentType, webAutoComplete, webInputName,
  returnKeyType, onSubmitEditing, inputRef, editable, accessibilityLabel, inputId, C, onKeyPress,
}: {
  label: string; icon: keyof typeof Ionicons.glyphMap; placeholder: string; value: string;
  onChangeText: (t: string) => void; error: string; focused: boolean; onFocus: () => void; onBlur: () => void;
  secureTextEntry?: boolean; showPassword?: boolean; onTogglePassword?: () => void;
  keyboardType?: 'default' | 'email-address'; autoComplete?: 'email' | 'current-password';
  textContentType?: 'emailAddress' | 'password'; webAutoComplete?: string; webInputName?: string;
  returnKeyType?: 'next' | 'go'; onSubmitEditing?: () => void; inputRef?: React.RefObject<TextInput | null>;
  editable?: boolean; accessibilityLabel: string; inputId: string; C: Tokens; onKeyPress?: (e: TextKeyPressLike) => void;
}) => {
  const borderProgress = useSharedValue(0);
  const hasError       = !!error;
  const webStyle       = useMemo(() => buildWebInputStyle(C), [C]);

  useEffect(() => {
    borderProgress.value = withTiming(focused ? 1 : 0, { duration: getAnimDuration(200) });
  }, [focused, borderProgress]);

  const borderStyle = useAnimatedStyle(() => {
    const t    = borderProgress.value;
    const from = hasError ? C.error : C.inputBorder;
    const to   = hasError ? C.error : C.accent;
    return { borderColor: t > 0.5 ? to : from, shadowOpacity: focused ? 0.15 * t : 0 };
  });

  const inputLabelStyle = useMemo(() => [s.inputLabel, { color: C.textMuted }, focused && { color: C.accent }, hasError && { color: C.error }], [C.textMuted, C.accent, C.error, focused, hasError]);
  const inputWrapperStyle = useMemo(() => [s.inputWrapper, { backgroundColor: hasError ? C.errorGlow : C.inputBg, shadowColor: C.inputShadow }, focused && s.inputWrapperFocused, borderStyle], [hasError, C.errorGlow, C.inputBg, C.inputShadow, focused, borderStyle]);
  const inputNativeStyle = useMemo(() => [s.inputNative, { color: C.textPrimary }], [C.textPrimary]);

  const webNameProp: WebInputProps  = webInputName ? { name: webInputName } : {};
  const webErrorProps: WebAriaProps = hasError
    ? { 'aria-describedby': `${inputId}-error`, 'aria-invalid': 'true', 'aria-required': 'true' }
    : { 'aria-required': 'true' };

  return (
    <View style={s.inputContainer}>
      <Text style={inputLabelStyle} accessibilityElementsHidden importantForAccessibility="no">{label}</Text>
      <Animated.View style={inputWrapperStyle}>
        <Ionicons name={icon} size={20} color={hasError ? C.error : focused ? C.accent : C.textMuted} style={s.inputIcon} accessibilityElementsHidden importantForAccessibility="no" />
        {IS_WEB ? (
          <TextInput
            ref={inputRef}
            nativeID={inputId}
            {...webNameProp}
            style={webStyle as WebStyleProps}
            placeholder={placeholder}
            placeholderTextColor={C.textMuted}
            value={value}
            onChangeText={onChangeText}
            secureTextEntry={secureTextEntry && !showPassword}
            keyboardType={keyboardType ?? 'default'}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete={(webAutoComplete ?? autoComplete) as TextInput['props']['autoComplete']}
            textContentType={textContentType}
            editable={editable !== false}
            returnKeyType={returnKeyType}
            onFocus={onFocus}
            onBlur={onBlur}
            onSubmitEditing={onSubmitEditing}
            onKeyPress={onKeyPress}
            accessibilityLabel={accessibilityLabel}
            selectionColor={C.accent}
            {...webErrorProps}
          />
        ) : (
          <TextInput
            ref={inputRef}
            nativeID={inputId}
            style={inputNativeStyle}
            placeholder={placeholder}
            placeholderTextColor={C.textMuted}
            value={value}
            onChangeText={onChangeText}
            secureTextEntry={secureTextEntry && !showPassword}
            keyboardType={keyboardType ?? 'default'}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete={autoComplete}
            textContentType={textContentType}
            editable={editable !== false}
            returnKeyType={returnKeyType}
            onFocus={onFocus}
            onBlur={onBlur}
            onSubmitEditing={onSubmitEditing}
            onKeyPress={onKeyPress}
            accessibilityLabel={accessibilityLabel}
            accessibilityHint={hasError ? error : undefined}
            selectionColor={C.accent}
            allowFontScaling
            maxFontSizeMultiplier={1.1}
          />
        )}
        {onTogglePassword && (
          <Pressable onPress={onTogglePassword} hitSlop={12} style={s.eyeButton} accessibilityRole="button" accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}>
            <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={22} color={focused ? C.accent : C.textMuted} />
          </Pressable>
        )}
      </Animated.View>
      <AnimatedError message={error} inputId={inputId} C={C} />
    </View>
  );
});