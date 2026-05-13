import React, { useMemo } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { IS_WEB } from './constants';
import { buildWebInputStyle } from './utils';
import { AnimatedError } from './AnimatedError';
import { SuccessText } from './SuccessText';
import { s } from './styles';
import type { KeyPressEvent, Tokens, WebAriaProps, WebInputProps, WebPressableStyle, WebStyleProps } from './types';

export const InputField = React.memo(function InputField({
  label, icon, placeholder, value, onChangeText, error, successMsg, focused, onFocus, onBlur,
  secureTextEntry, showPassword, onTogglePassword, keyboardType, autoComplete, textContentType,
  webAutoComplete, webInputName, returnKeyType, onSubmitEditing, inputRef, editable,
  accessibilityLabel, inputId, C, onKeyPress,
}: {
  label: string; icon: keyof typeof Ionicons.glyphMap; placeholder: string; value: string;
  onChangeText: (t: string) => void; error: string; successMsg?: string; focused: boolean;
  onFocus: () => void; onBlur: () => void; secureTextEntry?: boolean; showPassword?: boolean;
  onTogglePassword?: () => void; keyboardType?: 'default' | 'email-address';
  autoComplete?: string; textContentType?: string; webAutoComplete?: string; webInputName?: string;
  returnKeyType?: 'next' | 'go'; onSubmitEditing?: () => void;
  inputRef?: React.RefObject<TextInput | null>; editable?: boolean;
  accessibilityLabel: string; inputId: string; C: Tokens; onKeyPress?: (e: KeyPressEvent) => void;
}) {
  const hasError    = !!error;
  const webStyle    = useMemo(() => buildWebInputStyle(C), [C]);
  const borderColor = hasError  ? C.error
    : successMsg               ? C.success
    : focused                  ? C.accent
    : C.inputBorder;

  const webNameProp: WebInputProps  = webInputName ? { name: webInputName } : {};
  const webErrorProps: WebAriaProps = hasError
    ? { 'aria-describedby': `${inputId}-error`, 'aria-invalid': 'true', 'aria-required': 'true' }
    : { 'aria-required': 'true' };

  const webCursorStyle = useMemo<WebPressableStyle>(() => IS_WEB ? { cursor: 'pointer' } : {}, []);

  const inputLabelStyle = useMemo(() => [
    s.inputLabel,
    { color: C.textMuted },
    focused  && { color: C.accent },
    hasError && { color: C.error },
  ], [C.textMuted, C.accent, C.error, focused, hasError]);

  const inputWrapperStyle = useMemo(() => [
    s.inputWrapper,
    { borderColor, backgroundColor: hasError ? C.errorGlow : C.inputBg },
    focused && [s.inputWrapperFocused, { shadowColor: C.inputShadow }],
  ], [borderColor, hasError, C.errorGlow, C.inputBg, focused, C.inputShadow]);

  const inputNativeStyle = useMemo(() => [s.inputNative, { color: C.textPrimary }], [C.textPrimary]);
  const eyeButtonStyle   = useMemo(() => [s.eyeButton, webCursorStyle],             [webCursorStyle]);

  return (
    <View style={s.inputContainer}>
      <Text style={inputLabelStyle} accessibilityElementsHidden importantForAccessibility="no" allowFontScaling maxFontSizeMultiplier={1.2}>{label}</Text>
      <View style={inputWrapperStyle}>
        <Ionicons name={icon} size={20} color={hasError ? C.error : focused ? C.accent : C.textMuted} style={s.inputIcon} accessibilityElementsHidden importantForAccessibility="no" />
        {IS_WEB ? (
          <TextInput
            ref={inputRef} nativeID={inputId} {...webNameProp}
            style={webStyle as WebStyleProps}
            placeholder={placeholder} placeholderTextColor={C.textMuted}
            value={value} onChangeText={onChangeText}
            secureTextEntry={secureTextEntry && !showPassword}
            keyboardType={keyboardType ?? 'default'}
            autoCapitalize="none" autoCorrect={false}
            autoComplete={(webAutoComplete ?? autoComplete) as TextInput['props']['autoComplete']}
            textContentType={textContentType as TextInput['props']['textContentType']}
            editable={editable !== false} returnKeyType={returnKeyType}
            onFocus={onFocus} onBlur={onBlur} onSubmitEditing={onSubmitEditing}
            onKeyPress={onKeyPress} accessibilityLabel={accessibilityLabel}
            selectionColor={C.accent} {...webErrorProps}
          />
        ) : (
          <TextInput
            ref={inputRef} nativeID={inputId}
            style={inputNativeStyle}
            placeholder={placeholder} placeholderTextColor={C.textMuted}
            value={value} onChangeText={onChangeText}
            secureTextEntry={secureTextEntry && !showPassword}
            keyboardType={keyboardType ?? 'default'}
            autoCapitalize="none" autoCorrect={false}
            autoComplete={autoComplete as TextInput['props']['autoComplete']}
            textContentType={textContentType as TextInput['props']['textContentType']}
            editable={editable !== false} returnKeyType={returnKeyType}
            onFocus={onFocus} onBlur={onBlur} onSubmitEditing={onSubmitEditing}
            onKeyPress={onKeyPress} accessibilityLabel={accessibilityLabel}
            accessibilityHint={hasError ? error : undefined}
            selectionColor={C.accent} allowFontScaling maxFontSizeMultiplier={1.1}
          />
        )}
        {onTogglePassword && (
          <Pressable onPress={onTogglePassword} hitSlop={12} style={eyeButtonStyle} accessibilityRole="button" accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}>
            <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={22} color={focused ? C.accent : C.textMuted} />
          </Pressable>
        )}
      </View>
      <AnimatedError message={error} inputId={inputId} C={C} />
      {!error && successMsg ? <SuccessText message={successMsg} C={C} /> : null}
    </View>
  );
});