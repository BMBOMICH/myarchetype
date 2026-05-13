import React, { useMemo } from 'react';
import Animated from 'react-native-reanimated';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BrandLogo } from './BrandLogo';
import { GradientButton } from './GradientButton';
import { InputField } from './InputField';
import { LockoutBanner } from './LockoutBanner';
import { s } from './styles';
import type { InnerContentProps } from './types';

export const InnerContent = React.memo(({
  C, state, IS_SMALL,
  screenStyle, headerStyle, formStyle, footerStyle,
  emailRef, passwordRef, canSubmit, logoPaused,
  validateEmail, validatePassword,
  onEmailFocus, onEmailBlur, onPasswordFocus, onPasswordBlur,
  togglePassword, handleLogin, handleEmailSubmit,
  handleForgotPassword, handleResendVerification, handleSignUp, handleKeyPress,
}: InnerContentProps) => {
  const contentStyle = useMemo(() => [s.content, { maxWidth: 440 }, screenStyle], [screenStyle]);
  const headerContainerStyle = useMemo(() => [s.headerContainer, { marginBottom: IS_SMALL ? 28 : 40 }, headerStyle], [IS_SMALL, headerStyle]);
  const titleStyle    = useMemo(() => [s.title,    { color: C.textPrimary,   fontSize: IS_SMALL ? 28 : 36 }], [C.textPrimary,   IS_SMALL]);
  const subtitleStyle = useMemo(() => [s.subtitle, { color: C.textSecondary, fontSize: IS_SMALL ? 14 : 16 }], [C.textSecondary, IS_SMALL]);
  const formCardStyle = useMemo(() => [s.formCard, { backgroundColor: C.card, borderColor: C.cardBorder, padding: IS_SMALL ? 24 : 34 }, formStyle], [C.card, C.cardBorder, IS_SMALL, formStyle]);
  const capsLockRowStyle  = useMemo(() => [s.capsLockRow,  { backgroundColor: C.errorGlow, borderColor: C.warn }], [C.errorGlow, C.warn]);
  const capsLockTextStyle = useMemo(() => [s.capsLockText, { color: C.warn }], [C.warn]);
  const forgotTextStyle   = useMemo(() => [s.forgotText,   { color: C.warn }], [C.warn]);
  const footerContainerStyle = useMemo(() => [s.footer, footerStyle], [footerStyle]);
  const resendButtonStyle = useMemo(() => [s.resendButton, { borderColor: C.separator, backgroundColor: C.accentGlow }], [C.separator, C.accentGlow]);
  const resendTextStyle   = useMemo(() => [s.resendText,   { color: C.accent }], [C.accent]);
  const separatorLineStyle = useMemo(() => [s.separatorLine, { backgroundColor: C.separator }], [C.separator]);
  const separatorTextStyle = useMemo(() => [s.separatorText, { color: C.textMuted }], [C.textMuted]);
  const signUpTextStyle   = useMemo(() => [s.signUpText,   { color: C.textSecondary }], [C.textSecondary]);
  const signUpLinkStyle   = useMemo(() => [s.signUpLink,   { color: C.accent }], [C.accent]);

  const webFormProps = typeof window !== 'undefined' ? { role: 'form', 'aria-label': 'Login form' } : {};

  return (
    <Animated.View style={contentStyle}>
      <Animated.View style={headerContainerStyle}>
        <BrandLogo C={C} paused={logoPaused} />
        <Text style={titleStyle} accessibilityRole="header">Welcome Back</Text>
        <Text style={subtitleStyle}>Log in to find your perfect match</Text>
      </Animated.View>

      <LockoutBanner seconds={state.lockoutSeconds} C={C} />

      <Animated.View style={formCardStyle} {...webFormProps}>
        <InputField
          inputId="login-email" label="Email address" icon="mail-outline" placeholder="you@example.com"
          value={state.email} onChangeText={validateEmail} error={state.emailError} focused={state.emailFocused}
          onFocus={onEmailFocus} onBlur={onEmailBlur} keyboardType="email-address" autoComplete="email"
          webAutoComplete="username" webInputName="username" textContentType="emailAddress"
          returnKeyType="next" onSubmitEditing={handleEmailSubmit} inputRef={emailRef}
          editable={!state.loading} accessibilityLabel="Email address" C={C} onKeyPress={handleKeyPress}
        />
        <InputField
          inputId="login-password" label="Password" icon="lock-closed-outline" placeholder="Enter your password"
          value={state.password} onChangeText={validatePassword} error={state.passwordError} focused={state.passwordFocused}
          onFocus={onPasswordFocus} onBlur={onPasswordBlur} secureTextEntry showPassword={state.showPassword}
          onTogglePassword={togglePassword} autoComplete="current-password" webAutoComplete="current-password"
          webInputName="password" textContentType="password" returnKeyType="go" onSubmitEditing={handleLogin}
          inputRef={passwordRef} editable={!state.loading} accessibilityLabel="Password" C={C} onKeyPress={handleKeyPress}
        />
        {typeof window !== 'undefined' && state.capsLockOn && state.passwordFocused && (
          <View style={capsLockRowStyle} accessibilityLiveRegion="polite">
            <Ionicons name="warning-outline" size={14} color={C.warn} />
            <Text style={capsLockTextStyle}>Caps Lock is on</Text>
          </View>
        )}
        <Pressable onPress={handleForgotPassword} disabled={state.loading} style={s.forgotRow} accessibilityRole="link" accessibilityLabel="Forgot password" hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={forgotTextStyle}>Forgot Password?</Text>
        </Pressable>
        <View style={s.buttonSpacer} />
        <GradientButton onPress={handleLogin} disabled={!canSubmit} loading={state.loading} label="Log In" C={C} />
      </Animated.View>

      <Animated.View style={footerContainerStyle}>
        <Pressable onPress={handleResendVerification} disabled={state.loading} style={resendButtonStyle} accessibilityRole="button" accessibilityLabel="Resend verification email">
          <Ionicons name="mail-unread-outline" size={16} color={C.accent} accessibilityElementsHidden importantForAccessibility="no" />
          <Text style={resendTextStyle}>Resend Verification Email</Text>
        </Pressable>
        <View style={s.separatorRow} accessibilityElementsHidden importantForAccessibility="no">
          <View style={separatorLineStyle} />
          <Text style={separatorTextStyle}>or</Text>
          <View style={separatorLineStyle} />
        </View>
        <Pressable onPress={handleSignUp} disabled={state.loading} style={({ pressed }) => [s.signUpButton, { opacity: pressed ? 0.7 : 1 }]} accessibilityRole="button" accessibilityLabel="Create a new account">
          <Text style={signUpTextStyle}>Don&apos;t have an account? <Text style={signUpLinkStyle}>Sign Up</Text></Text>
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
});