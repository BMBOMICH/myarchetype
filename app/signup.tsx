import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { createUserWithEmailAndPassword, sendEmailVerification } from 'firebase/auth';
import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  AccessibilityInfo, ActivityIndicator, Alert, type AlertButton, Appearance, AppState,
  type AppStateStatus, BackHandler, Dimensions, I18nManager, Keyboard, Pressable, StatusBar,
  Text, TextInput, TouchableOpacity, useColorScheme, View,
} from 'react-native';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { KeyboardAwareScrollView } from '@/src/components/login/KeyboardAwareScrollView';
import { SafeAreaView } from 'react-native-safe-area-context';
import { auth } from '../firebaseConfig';
import { validateDateOfBirth } from '../utils/ageVerification';
import { logConsent, logPrivacyAccepted, logTermsAccepted, writeAuditLog } from '../utils/logger';
import { validateDisplayName } from '../utils/nameValidation';
import { checkUserBanned, trackAccountCreation } from '../utils/rateLimiter';
import { checkRegistration } from '../utils/safetyMiddleware';
import {
  darkTokens, ERROR_MESSAGES, IS_IOS, IS_RTL, IS_WEB, lightTokens, LOCKOUT_DURATION_MS,
  MAX_FORGOT_ATTEMPTS, MAX_PASSWORD_LENGTH, MAX_SIGNUP_ATTEMPTS, MIN_EMAIL_DISPLAY,
  RESIZE_DEBOUNCE_MS, ROUTES, SUCCESS_NAV_DELAY_MS,
} from '@/src/components/signup/constants';
import { BrandLogo } from '@/src/components/signup/BrandLogo';
import { CustomModal } from '@/src/components/signup/CustomModal';
import { formReducer, initialForm } from '@/src/components/signup/reducer';
import { GradientButton } from '@/src/components/signup/GradientButton';
import { InputField } from '@/src/components/signup/InputField';
import { LockoutBanner } from '@/src/components/signup/LockoutBanner';
import { PasswordRequirements } from '@/src/components/signup/PasswordRequirements';
import { s } from '@/src/components/signup/styles';
import { StrengthBar } from '@/src/components/signup/StrengthBar';
import { SuccessOverlay } from '@/src/components/signup/SuccessOverlay';
import { SignupErrorBoundary } from '@/src/components/signup/SignupErrorBoundary';
import {
  checkPasswordBreached, debounce, getAnimDuration, getDeviceFingerprint, getErrorCode,
  getErrorMessage, getScreenData, injectWebStyles, maskEmail, triggerHaptic, updatePrefersReducedMotion,
  validators,
} from '@/src/components/signup/utils';
import { useShake } from '@/src/components/signup/useShake';
import type { FormState, ModalConfig, Tokens } from '@/src/components/signup/types';

export default function SignupScreen() {
  const router  = useRouter();
  const scheme  = useColorScheme();
  const isDark  = scheme !== 'light';
  const C: Tokens = isDark ? darkTokens : lightTokens;

  const [state, dispatch]           = useReducer(formReducer, initialForm);
  const [screenData, setSD]         = useState(getScreenData);
  const [showSuccess, setShowSuccess] = useState(false);
  const [modal, setModal]           = useState<ModalConfig | null>(null);
  const [appActive, setAppActive]   = useState(true);

  const isMounted      = useRef(true);
  const signupAttempts = useRef(0);
  const lockoutUntil   = useRef(0);
  const lockoutTimer   = useRef<ReturnType<typeof setInterval>  | null>(null);
  const navTimeout     = useRef<ReturnType<typeof setTimeout>   | null>(null);
  const focusTimeout   = useRef<ReturnType<typeof setTimeout>   | null>(null);
  const scrollTimeout  = useRef<ReturnType<typeof setTimeout>   | null>(null);

  const nameRef     = useRef<TextInput>(null);
  const dobRef      = useRef<TextInput>(null);
  const emailRef    = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const confirmRef  = useRef<TextInput>(null);
  const scrollRef   = useRef<ScrollView>(null);

  const { shakeStyle, shake } = useShake();

  const fadeAnim    = useSharedValue(0);
  const slideAnim   = useSharedValue(getAnimDuration(1) ? 30 : 0);
  const headerFade  = useSharedValue(0);
  const headerSlide = useSharedValue(getAnimDuration(1) ? 16 : 0);
  const formFade    = useSharedValue(0);
  const formSlide   = useSharedValue(getAnimDuration(1) ? 16 : 0);
  const footerFade  = useSharedValue(0);

  const contentStyle = useAnimatedStyle(() => ({ opacity: fadeAnim.value, transform: [{ translateY: slideAnim.value }] }));
  const headerStyle  = useAnimatedStyle(() => ({ opacity: headerFade.value,  transform: [{ translateY: headerSlide.value }] }));
  const formStyle    = useAnimatedStyle(() => ({ opacity: formFade.value,    transform: [{ translateY: formSlide.value }] }));
  const footerStyle  = useAnimatedStyle(() => ({ opacity: footerFade.value }));

  const IS_SMALL = screenData.isSmall;

  const scrollContentStyle = useMemo(() => [
    s.scrollContent,
    { padding: IS_SMALL ? 20 : 28, paddingTop: IS_SMALL ? 16 : 24 },
  ], [IS_SMALL]);

  const webCursorStyle = useMemo(() => IS_WEB ? { cursor: 'pointer' } : {}, []);

  useEffect(() => { injectWebStyles(C, isDark ? 'dark' : 'light'); }, [C, isDark]);

  useEffect(() => {
    if (!IS_WEB || typeof window === 'undefined') return;
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const h  = (e: { matches: boolean }) => { updatePrefersReducedMotion(e.matches); };
    mq?.addEventListener?.('change', h);
    return () => mq?.removeEventListener?.('change', h);
  }, []);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      if (lockoutTimer.current)  clearInterval(lockoutTimer.current);
      if (navTimeout.current)    clearTimeout(navTimeout.current);
      if (focusTimeout.current)  clearTimeout(focusTimeout.current);
      if (scrollTimeout.current) clearTimeout(scrollTimeout.current);
      dispatch({ type: 'WIPE_SENSITIVE' });
    };
  }, []);

  useEffect(() => {
    if (!IS_WEB) return;
    const h = debounce(() => setSD(getScreenData()), RESIZE_DEBOUNCE_MS);
    window.addEventListener?.('resize', h as (e: unknown) => void);
    return () => { window.removeEventListener?.('resize', h as (e: unknown) => void); h.cancel(); };
  }, []);

  useEffect(() => {
    if (IS_WEB) return;
    const sub = AppState.addEventListener('change', (s: AppStateStatus) => setAppActive(s === 'active'));
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (IS_WEB) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => state.loading || showSuccess);
    return () => sub.remove();
  }, [state.loading, showSuccess]);

  useEffect(() => {
    const id = requestIdleCallback(() => {
      if (!isMounted.current) return;
      fadeAnim.value    = withTiming(1, { duration: getAnimDuration(400) });
      slideAnim.value   = withTiming(0, { duration: getAnimDuration(500) });
      headerFade.value  = withDelay(getAnimDuration(120), withTiming(1, { duration: getAnimDuration(600) }));
      headerSlide.value = withDelay(getAnimDuration(120), withTiming(0, { duration: getAnimDuration(600) }));
      formFade.value    = withDelay(getAnimDuration(240), withTiming(1, { duration: getAnimDuration(600) }));
      formSlide.value   = withDelay(getAnimDuration(240), withTiming(0, { duration: getAnimDuration(600) }));
      footerFade.value  = withDelay(getAnimDuration(360), withTiming(1, { duration: getAnimDuration(500) }));
    });
    return () => {
      cancelIdleCallback(id);
      cancelAnimation(fadeAnim);
      cancelAnimation(slideAnim);
      cancelAnimation(headerFade);
      cancelAnimation(headerSlide);
      cancelAnimation(formFade);
      cancelAnimation(formSlide);
      cancelAnimation(footerFade);
    };
  }, [fadeAnim, slideAnim, headerFade, headerSlide, formFade, formSlide, footerFade]);

  const startLockout = useCallback(() => {
    if (lockoutTimer.current) clearInterval(lockoutTimer.current);
    const tick = () => {
      if (!isMounted.current) return;
      const remaining = Math.ceil((lockoutUntil.current - Date.now()) / 1000);
      if (remaining <= 0) {
        dispatch({ type: 'SET_LOCKOUT', payload: 0 });
        if (lockoutTimer.current) { clearInterval(lockoutTimer.current); lockoutTimer.current = null; }
      } else {
        dispatch({ type: 'SET_LOCKOUT', payload: remaining });
      }
    };
    tick();
    lockoutTimer.current = setInterval(tick, 1000);
  }, []);

  const openModal  = useCallback((config: ModalConfig) => setModal(config), []);
  const closeModal = useCallback(() => setModal(null), []);

  const showAppAlert = useCallback((title: string, message: string, buttons?: AlertButton[]) => {
    if (IS_WEB) {
      openModal({
        title, message,
        buttons: (buttons ?? [{ text: 'OK' }]).map((b, _, arr) => ({
          label:   b.text ?? 'OK',
          onPress: b.onPress,
          primary: b.style !== 'cancel' && arr.length > 1,
        })),
      });
    } else {
      Alert.alert(title, message, buttons);
    }
  }, [openModal]);

  const handleKeyPress = useCallback((e: { nativeEvent?: { key?: string; getModifierState?: (name: string) => boolean } }) => {
    if (!IS_WEB || !e.nativeEvent?.key) return;
    dispatch({ type: 'SET_CAPS_LOCK', payload: !!e.nativeEvent.getModifierState?.('CapsLock') });
  }, []);

  const pwValidation   = useMemo(() => validators.password(state.password), [state.password]);
  const passwordsMatch = state.password === state.confirmPassword;
  const emailValid     = state.email.length >= MIN_EMAIL_DISPLAY && !validators.email(state.email);

  const canSubmit = useMemo(() => !!(
    state.name.trim() && !state.nameError && state.dob && !state.dobError &&
    state.email.trim() && emailValid && pwValidation.valid && passwordsMatch &&
    state.confirmPassword.length > 0 && !state.loading && state.lockoutSeconds === 0
  ), [state, emailValid, pwValidation.valid, passwordsMatch]);

  const validateName = useCallback((text: string) => {
    const v = text.slice(0, 50);
    dispatch({ type: 'SET_NAME', payload: v });
    if (!v.trim()) return dispatch({ type: 'SET_NAME_ERROR', payload: '' });
    const result = validateDisplayName(v);
    dispatch({ type: 'SET_NAME_ERROR', payload: result.valid ? '' : (result.reason ?? 'Invalid name') });
  }, []);

  const validateDOB = useCallback((text: string) => {
    dispatch({ type: 'SET_DOB', payload: text });
    if (!text) return dispatch({ type: 'SET_DOB_ERROR', payload: '' });
    const result = validateDateOfBirth(text);
    dispatch({ type: 'SET_DOB_ERROR', payload: result.valid ? '' : (result.reason ?? 'Invalid date') });
  }, []);

  const validateEmail = useCallback((text: string) => {
    const clean = text.trimStart().slice(0, MAX_EMAIL_LENGTH).replace(/[\n\r]/g, '');
    dispatch({ type: 'SET_EMAIL', payload: clean });
    if (clean.length < MIN_EMAIL_DISPLAY) return dispatch({ type: 'SET_EMAIL_ERROR', payload: '' });
    dispatch({ type: 'SET_EMAIL_ERROR', payload: validators.email(clean) });
  }, []);

  const validatePassword = useCallback((text: string) =>
    dispatch({ type: 'SET_PASSWORD', payload: text.slice(0, MAX_PASSWORD_LENGTH) }), []);
  const validateConfirm  = useCallback((text: string) =>
    dispatch({ type: 'SET_CONFIRM',  payload: text.slice(0, MAX_PASSWORD_LENGTH) }), []);
  const dismissKeyboard  = useCallback(() => { if (!IS_WEB) Keyboard.dismiss(); }, []);

  const handleSignup = useCallback(async () => {
    dismissKeyboard();
    dispatch({ type: 'CLEAR_ERRORS' });

    const nameResult = validateDisplayName(state.name.trim());
    if (!nameResult.valid) {
      dispatch({ type: 'SET_NAME_ERROR', payload: nameResult.reason ?? 'Invalid name' });
      shake(); return;
    }
    const dobResult = validateDateOfBirth(state.dob);
    if (!dobResult.valid) {
      dispatch({ type: 'SET_DOB_ERROR', payload: dobResult.reason ?? 'Invalid date of birth' });
      shake(); return;
    }
    const email      = state.email.trim().toLowerCase();
    const emailError = validators.email(email);
    if (emailError) { dispatch({ type: 'SET_EMAIL_ERROR', payload: emailError }); shake(); return; }

    if (!pwValidation.valid) {
      shake();
      showAppAlert('Password Requirements',
        `Your password must meet all requirements:\n\n${pwValidation.errors.map(e => `• ${e}`).join('\n')}`);
      return;
    }
    if (!passwordsMatch) {
      dispatch({ type: 'SET_CONFIRM_ERROR', payload: 'Passwords do not match' });
      shake(); return;
    }
    if (Date.now() < lockoutUntil.current) { startLockout(); shake(); return; }

    dispatch({ type: 'SET_LOADING', payload: true });
    const breached = await checkPasswordBreached(state.password);
    dispatch({ type: 'SET_LOADING', payload: false });

    if (breached) {
      dispatch({ type: 'SET_BREACHED_WARNING', payload: true });
      showAppAlert('⚠️ Password Found in Data Breach',
        'This password has appeared in a known data breach. Please choose a different, unique password.',
        [{ text: 'Choose Different Password' }]);
      shake(); return;
    }

    showAppAlert('Create Account', `Create account with:\n${email}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Create',
        onPress: async () => {
          dispatch({ type: 'SET_LOADING', payload: true });
          dispatch({ type: 'HIDE_PASSWORDS' });
          try {
            const fp = await getDeviceFingerprint();
            if (fp) {
              const creationCheck = await trackAccountCreation(fp);
              if (creationCheck.suspicious) {
                showAppAlert('Account Limit', 'Too many accounts created from this device. Please contact support.');
                dispatch({ type: 'SET_LOADING', payload: false });
                return;
              }
            }
            const bannedCheck = await checkUserBanned(email);
            if (bannedCheck.banned) {
              showAppAlert('Registration Blocked', bannedCheck.reason ?? 'This email is not eligible for registration. Contact support.');
              dispatch({ type: 'SET_LOADING', payload: false });
              return;
            }
            try {
              const regSafety = await checkRegistration(email, state.password, state.name.trim(), {
                serverUrl: '', enableRegistrationCheck: true, enableMessageCheck: false,
                enablePhotoCheck: false, enableLoginCheck: false, enableProfileCheck: false,
                autoBlockCritical: true, logAllChecks: false,
              });
              if (!regSafety.allowed) {
                showAppAlert('Registration Denied', regSafety.reasons.join('\n') || 'Registration blocked by safety system.');
                dispatch({ type: 'SET_LOADING', payload: false });
                shake(); return;
              }
            } catch (safetyErr: unknown) {
              if (__DEV__) console.warn('[Signup] Safety middleware check failed, continuing:', safetyErr);
            }
            const { user } = await createUserWithEmailAndPassword(auth, email, state.password);
            try { await sendEmailVerification(user); } catch { /* ignore */ }
            await logTermsAccepted('1.0');
            await logPrivacyAccepted('1.0');
            await logConsent('account_creation', true);
            await writeAuditLog('user.register', {
              maskedEmail:       maskEmail(email),
              emailDomain:       email.split('@')[1] ?? '',
              deviceFingerprint: fp,
              dobAge:            dobResult.age,
              nameDetector:      'passed',
            });
            await auth.signOut();
            dispatch({ type: 'WIPE_SENSITIVE' });
            await triggerHaptic('success');
            if (!isMounted.current) return;
            dispatch({ type: 'SET_LOADING', payload: false });
            setShowSuccess(true);
            navTimeout.current = setTimeout(() => {
              if (isMounted.current) router.replace(ROUTES.LOGIN);
            }, getAnimDuration(SUCCESS_NAV_DELAY_MS));
          } catch (error: unknown) {
            signupAttempts.current += 1;
            if (signupAttempts.current >= MAX_SIGNUP_ATTEMPTS) {
              lockoutUntil.current   = Date.now() + LOCKOUT_DURATION_MS;
              signupAttempts.current = 0;
              startLockout();
            }
            await triggerHaptic('error');
            shake();
            if (!isMounted.current) return;
            const code = getErrorCode(error);
            if (code === 'auth/email-already-in-use' || code === 'auth/invalid-email') {
              dispatch({ type: 'SET_EMAIL_ERROR', payload: getErrorMessage(code, ERROR_MESSAGES) });
              focusTimeout.current = setTimeout(() => emailRef.current?.focus(), 100);
            }
            showAppAlert('Signup Failed', getErrorMessage(code, ERROR_MESSAGES));
            dispatch({ type: 'SET_LOADING', payload: false });
          }
        },
      },
    ]);
  }, [state, pwValidation, passwordsMatch, dismissKeyboard, shake, showAppAlert, startLockout, router]);

  const handleLogin   = useCallback(() => { if (!state.loading) router.replace(ROUTES.LOGIN); }, [state.loading, router]);
  const handleTerms   = useCallback(() => router.push(ROUTES.TERMS),    [router]);
  const handlePrivacy = useCallback(() => router.push(ROUTES.PRIVACY),  [router]);

  const focusDOB      = useCallback(() => dobRef.current?.focus(),      []);
  const focusEmail    = useCallback(() => emailRef.current?.focus(),    []);
  const focusPassword = useCallback(() => passwordRef.current?.focus(), []);
  const focusConfirm  = useCallback(() => confirmRef.current?.focus(),  []);

  const onNameFocus    = useCallback(() => dispatch({ type: 'SET_NAME_FOCUSED',     payload: true  }), []);
  const onNameBlur     = useCallback(() => dispatch({ type: 'SET_NAME_FOCUSED',     payload: false }), []);
  const onDobFocus     = useCallback(() => dispatch({ type: 'SET_DOB_FOCUSED',      payload: true  }), []);
  const onDobBlur      = useCallback(() => dispatch({ type: 'SET_DOB_FOCUSED',      payload: false }), []);
  const onEmailFocus   = useCallback(() => dispatch({ type: 'SET_EMAIL_FOCUSED',    payload: true  }), []);
  const onEmailBlur    = useCallback(() => dispatch({ type: 'SET_EMAIL_FOCUSED',    payload: false }), []);
  const onPasswordBlur = useCallback(() => dispatch({ type: 'SET_PASSWORD_FOCUSED', payload: false }), []);
  const onConfirmBlur  = useCallback(() => dispatch({ type: 'SET_CONFIRM_FOCUSED',  payload: false }), []);

  const onPasswordFocus = useCallback(() => {
    dispatch({ type: 'SET_PASSWORD_FOCUSED',  payload: true });
    dispatch({ type: 'SET_SHOW_REQUIREMENTS', payload: true });
  }, []);

  const onConfirmFocus = useCallback(() => {
    dispatch({ type: 'SET_CONFIRM_FOCUSED', payload: true });
    scrollTimeout.current = setTimeout(
      () => scrollRef.current?.scrollToEnd({ animated: true }), 350,
    );
  }, []);

  const emailSuccessMsg = emailValid && !state.emailError ? 'Valid email' : '';
  const confirmError    = state.confirmPassword.length > 0 &&
    state.confirmPassword.length >= state.password.length && !passwordsMatch
    ? 'Passwords do not match'
    : state.confirmPasswordError;
  const confirmSuccessMsg = state.confirmPassword.length > 0 && passwordsMatch &&
    pwValidation.valid && !state.confirmPasswordError
    ? 'Passwords match'
    : '';
  const logoPaused = state.nameFocused || state.dobFocused || state.emailFocused ||
    state.passwordFocused || state.confirmFocused || state.loading || !appActive;

  const rootBgStyle         = useMemo(() => [s.rootBg,           { backgroundColor: C.bg }],                                    [C.bg]);
  const contentViewStyle    = useMemo(() => [s.content,           { maxWidth: 440 }, contentStyle],                              [contentStyle]);
  const backRowStyle        = useMemo(() => [s.backRow,           webCursorStyle],                                               [webCursorStyle]);
  const backTextStyle       = useMemo(() => [s.backText,          { color: C.accent }],                                         [C.accent]);
  const headerContainerStyle = useMemo(() => [s.headerContainer,  headerStyle],                                                  [headerStyle]);
  const titleStyle          = useMemo(() => [s.title,             { color: C.textPrimary, fontSize: IS_SMALL ? 30 : 36 }],      [C.textPrimary, IS_SMALL]);
  const subtitleStyle       = useMemo(() => [s.subtitle,          { color: C.textSecondary, fontSize: IS_SMALL ? 15 : 16 }],   [C.textSecondary, IS_SMALL]);
  const formCardStyle       = useMemo(() => [
    s.formCard,
    { backgroundColor: C.card, borderColor: C.cardBorder, padding: IS_SMALL ? 24 : 34 },
    formStyle, shakeStyle,
  ], [C.card, C.cardBorder, IS_SMALL, formStyle, shakeStyle]);
  const breachBannerStyle   = useMemo(() => [s.lockoutBanner,    { backgroundColor: C.errorGlow, borderColor: C.error, marginBottom: 12 }], [C.errorGlow, C.error]);
  const breachTextStyle     = useMemo(() => [s.lockoutText,      { color: C.error }],                                          [C.error]);
  const capsLockRowStyle    = useMemo(() => [s.capsLockRow,      { backgroundColor: C.errorGlow, borderColor: C.warn }],       [C.errorGlow, C.warn]);
  const capsLockTextStyle   = useMemo(() => [s.capsLockText,     { color: C.warn }],                                           [C.warn]);
  const footerViewStyle     = useMemo(() => [s.footer,           footerStyle],                                                  [footerStyle]);
  const legalTextStyle      = useMemo(() => [s.legalText,        { color: C.textMuted }],                                      [C.textMuted]);
  const legalLinkStyle      = useMemo(() => [s.legalLink,        { color: C.accentSoft }],                                     [C.accentSoft]);
  const loginTextStyle      = useMemo(() => [s.loginText,        { color: C.textSecondary }],                                  [C.textSecondary]);
  const loginLinkStyle      = useMemo(() => [s.loginLink,        { color: C.accent }],                                         [C.accent]);
  const loadingOverlayStyle = useMemo(() => [s.loadingOverlay,   { backgroundColor: C.overlay }],                              [C.overlay]);
  const loadingCardStyle    = useMemo(() => [s.loadingCard,      { backgroundColor: C.card, borderColor: C.cardBorder }],      [C.card, C.cardBorder]);
  const loadingTextStyle    = useMemo(() => [s.loadingText,      { color: C.textSecondary }],                                  [C.textSecondary]);

  return (
    <SignupErrorBoundary>
      <View style={rootBgStyle}>
        <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={C.bg} translucent={false} />
        <LinearGradient colors={[C.bgGradientStart, C.bgGradientMid, C.bgGradientEnd]} style={s.gradientFill} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} />
        <SafeAreaView style={s.safe}>
          <KeyboardAwareScrollView
            ref={scrollRef}
            style={s.fill}
            contentContainerStyle={scrollContentStyle}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            <Pressable style={s.fill} onPress={dismissKeyboard} accessibilityLabel="Dismiss keyboard">
              <Animated.View style={contentViewStyle}>
                <Pressable onPress={handleLogin} style={backRowStyle} disabled={state.loading} accessibilityRole="button" accessibilityLabel="Back to login">
                  <Ionicons name={IS_RTL ? 'chevron-forward' : 'chevron-back'} size={20} color={C.accent} />
                  <Text style={backTextStyle}>Back to Login</Text>
                </Pressable>

                <Animated.View style={headerContainerStyle}>
                  <BrandLogo C={C} paused={logoPaused} />
                  <Text style={titleStyle} accessibilityRole="header">Create Account</Text>
                  <Text style={subtitleStyle}>Start your journey with MyArchetype</Text>
                </Animated.View>

                <LockoutBanner seconds={state.lockoutSeconds} C={C} />

                <Animated.View style={formCardStyle}>
                  <InputField
                    inputId="signup-name" label="Display name" icon="person-outline"
                    placeholder="Your first name" value={state.name} onChangeText={validateName}
                    error={state.nameError} focused={state.nameFocused}
                    onFocus={onNameFocus} onBlur={onNameBlur}
                    autoComplete="name" webAutoComplete="given-name" webInputName="given-name"
                    textContentType="name" returnKeyType="next" onSubmitEditing={focusDOB}
                    inputRef={nameRef} editable={!state.loading} accessibilityLabel="Display name" C={C}
                  />
                  <InputField
                    inputId="signup-dob" label="Date of birth" icon="calendar-outline"
                    placeholder="YYYY-MM-DD" value={state.dob} onChangeText={validateDOB}
                    error={state.dobError} focused={state.dobFocused}
                    onFocus={onDobFocus} onBlur={onDobBlur}
                    autoComplete="bday" webAutoComplete="bday" webInputName="bday"
                    textContentType="birthdate" returnKeyType="next" onSubmitEditing={focusEmail}
                    inputRef={dobRef} editable={!state.loading}
                    accessibilityLabel="Date of birth (YYYY-MM-DD)" C={C}
                  />
                  <InputField
                    inputId="signup-email" label="Email address" icon="mail-outline"
                    placeholder="you@example.com" value={state.email} onChangeText={validateEmail}
                    error={state.emailError} successMsg={emailSuccessMsg} focused={state.emailFocused}
                    onFocus={onEmailFocus} onBlur={onEmailBlur}
                    keyboardType="email-address" autoComplete="email"
                    webAutoComplete="email" webInputName="email"
                    textContentType="emailAddress" returnKeyType="next" onSubmitEditing={focusPassword}
                    inputRef={emailRef} editable={!state.loading}
                    accessibilityLabel="Email address" C={C} onKeyPress={handleKeyPress}
                  />
                  <InputField
                    inputId="signup-password" label="Password" icon="lock-closed-outline"
                    placeholder="Create a strong password" value={state.password}
                    onChangeText={validatePassword} error={state.passwordError}
                    focused={state.passwordFocused}
                    onFocus={onPasswordFocus} onBlur={onPasswordBlur}
                    secureTextEntry showPassword={state.showPassword}
                    onTogglePassword={() => dispatch({ type: 'TOGGLE_PASSWORD' })}
                    autoComplete="password-new" webAutoComplete="new-password" webInputName="new-password"
                    textContentType="newPassword" returnKeyType="next" onSubmitEditing={focusConfirm}
                    inputRef={passwordRef} editable={!state.loading}
                    accessibilityLabel="Password" C={C} onKeyPress={handleKeyPress}
                  />

                  <StrengthBar password={state.password} C={C} />
                  {state.showRequirements && state.password.length > 0 &&
                    (state.passwordFocused || !pwValidation.valid) && (
                      <PasswordRequirements password={state.password} C={C} />
                    )
                  }

                  {state.breachedWarning && (
                    <View style={breachBannerStyle}>
                      <Ionicons name="warning-outline" size={16} color={C.error} />
                      <Text style={breachTextStyle}>This password was found in a data breach. Choose a different one.</Text>
                    </View>
                  )}

                  <InputField
                    inputId="signup-confirm" label="Confirm password" icon="lock-closed-outline"
                    placeholder="Re-enter your password" value={state.confirmPassword}
                    onChangeText={validateConfirm} error={confirmError} successMsg={confirmSuccessMsg}
                    focused={state.confirmFocused}
                    onFocus={onConfirmFocus} onBlur={onConfirmBlur}
                    secureTextEntry showPassword={state.showConfirmPassword}
                    onTogglePassword={() => dispatch({ type: 'TOGGLE_CONFIRM_PASSWORD' })}
                    autoComplete="password-new" webAutoComplete="new-password" webInputName="new-password"
                    textContentType="newPassword" returnKeyType="go"
                    onSubmitEditing={canSubmit ? handleSignup : undefined}
                    inputRef={confirmRef} editable={!state.loading}
                    accessibilityLabel="Confirm password" C={C} onKeyPress={handleKeyPress}
                  />

                  {IS_WEB && state.capsLockOn && (state.passwordFocused || state.confirmFocused) && (
                    <View style={capsLockRowStyle} accessibilityLiveRegion="polite">
                      <Ionicons name="warning-outline" size={14} color={C.warn} />
                      <Text style={capsLockTextStyle}>Caps Lock is on</Text>
                    </View>
                  )}

                  <View style={s.buttonSpacer} />
                  <GradientButton onPress={handleSignup} disabled={!canSubmit} loading={state.loading} label="Create Account" C={C} />
                </Animated.View>

                <Animated.View style={footerViewStyle}>
                  <Text style={legalTextStyle}>
                    By creating an account, you agree to our{' '}
                    <Text style={legalLinkStyle} onPress={handleTerms} accessibilityRole="link">Terms of Service</Text>
                    {' and '}
                    <Text style={legalLinkStyle} onPress={handlePrivacy} accessibilityRole="link">Privacy Policy</Text>
                  </Text>
                  <Pressable
                    onPress={handleLogin}
                    disabled={state.loading}
                    style={({ pressed }) => [s.loginButton, { opacity: pressed ? 0.7 : 1 }, webCursorStyle]}
                  >
                    <Text style={loginTextStyle}>
                      Already have an account?{' '}
                      <Text style={loginLinkStyle}>Log in</Text>
                    </Text>
                  </Pressable>
                </Animated.View>
              </Animated.View>
            </Pressable>
          </KeyboardAwareScrollView>

          {state.loading && !showSuccess && (
            <View style={loadingOverlayStyle} pointerEvents="box-only" accessibilityViewIsModal accessibilityLiveRegion="polite">
              <View style={loadingCardStyle} accessibilityRole="alert">
                <ActivityIndicator size="large" color={C.accent} />
                <Text style={loadingTextStyle}>Creating your account…</Text>
              </View>
            </View>
          )}

          {showSuccess && <SuccessOverlay C={C} />}
          {modal && IS_WEB && <CustomModal config={modal} onClose={closeModal} C={C} />}
        </SafeAreaView>
      </View>
    </SignupErrorBoundary>
  );
}