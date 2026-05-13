import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { sendEmailVerification, sendPasswordResetEmail, signInWithEmailAndPassword } from 'firebase/auth';
import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  AccessibilityInfo, ActivityIndicator, Alert, Appearance, AppState, type AppStateStatus,
  BackHandler, Dimensions, I18nManager, Keyboard, Platform, Pressable, StatusBar, Text,
  TextInput, useColorScheme, View,
} from 'react-native';
import Animated, { Easing, FadeIn, FadeOut, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { KeyboardAwareScrollView } from '@/src/components/login/KeyboardAwareScrollView';
import { SafeAreaView } from 'react-native-safe-area-context';
import { auth } from '../firebaseConfig';
import { ensureMyE2EEIdentity, getLocalE2EEKeypair } from '../utils/e2ee';
import { writeAuditLog } from '../utils/logger';
import { checkDeviceMultiAccount, checkUserBanned, recordDeviceLogin } from '../utils/rateLimiter';
import { checkLogin } from '../utils/safetyMiddleware';
import {
  darkTokens, ERROR_MESSAGES, IS_IOS, IS_WEB, lightTokens, LOCKOUT_DURATION_MS,
  MAX_FORGOT_ATTEMPTS, MAX_LOGIN_ATTEMPTS, MAX_RESEND_ATTEMPTS, RATE_LIMIT_WINDOW_MS,
  RESIZE_DEBOUNCE_MS, ROUTES, SUCCESS_NAV_DELAY_MS,
} from '@/src/components/login/constants';
import { CustomModal } from '@/src/components/login/CustomModal';
import { formReducer, initialFormState } from '@/src/components/login/reducer';
import { InnerContent } from '@/src/components/login/InnerContent';
import { LoginErrorBoundary } from '@/src/components/login/LoginErrorBoundary';
import { s } from '@/src/components/login/styles';
import { SuccessOverlay } from '@/src/components/login/SuccessOverlay';
import {
  debounce, getAnimDuration, getDeviceFingerprint, getErrorCode, getErrorMessage,
  getScreenData, injectWebStyles, showNativeAlert, triggerHaptic, updatePrefersReducedMotion,
  useShake, validators,
} from '@/src/components/login/utils';
import type { FormState, ModalConfig, Tokens } from '@/src/components/login/types';

export default function LoginScreen() {
  const router      = useRouter();
  const colorScheme = useColorScheme();
  const isDark      = colorScheme !== 'light';
  const C: Tokens   = isDark ? darkTokens : lightTokens;

  useEffect(() => { injectWebStyles(C, isDark ? 'dark' : 'light'); }, [C, isDark]);

  useEffect(() => {
    if (!IS_WEB) return;
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const h  = (e: { matches: boolean }) => { updatePrefersReducedMotion(e.matches); };
    mq?.addEventListener?.('change', h);
    return () => mq?.removeEventListener?.('change', h);
  }, []);

  const [state, dispatch]     = useReducer(formReducer, initialFormState);
  const [screenData, setSD]   = useState(getScreenData);
  const [showSuccess, setSuccess]   = useState(false);
  const [successCountdown, setSuccessCountdown] = useState(Math.ceil(SUCCESS_NAV_DELAY_MS / 1000));
  const [modal,     setModal]   = useState<ModalConfig | null>(null);
  const [appActive, setAppActive] = useState(true);

  const isMounted       = useRef(true);
  const loginAttempts   = useRef(0);
  const lockoutUntil    = useRef(0);
  const lockoutTimer    = useRef<ReturnType<typeof setInterval>  | null>(null);
  const navTimeout      = useRef<ReturnType<typeof setTimeout>   | null>(null);
  const successTimer    = useRef<ReturnType<typeof setInterval>  | null>(null);
  const focusTimeout    = useRef<ReturnType<typeof setTimeout>   | null>(null);
  const passwordRef     = useRef<TextInput>(null);
  const emailRef        = useRef<TextInput>(null);
  const resendAttempts  = useRef(0);
  const resendLockUntil = useRef(0);
  const forgotAttempts  = useRef(0);
  const forgotLockUntil = useRef(0);

  const { translateX, shake } = useShake();

  const fadeProgress   = useSharedValue(0);
  const slideProgress  = useSharedValue(getAnimDuration(1) ? 1 : 0);
  const headerProgress = useSharedValue(0);
  const formProgress   = useSharedValue(0);
  const footerOpacity  = useSharedValue(0);

  const screenStyle = useAnimatedStyle(() => ({
    opacity:   fadeProgress.value,
    transform: [{ translateY: slideProgress.value * 40 }],
  }));
  const headerStyle = useAnimatedStyle(() => ({
    opacity:   headerProgress.value,
    transform: [{ translateY: (1 - headerProgress.value) * 20 }],
  }));
  const formStyle = useAnimatedStyle(() => ({
    opacity:   formProgress.value,
    transform: [
      { translateX: translateX.value },
      { translateY: (1 - formProgress.value) * 20 },
    ],
  }));
  const footerStyle = useAnimatedStyle(() => ({ opacity: footerOpacity.value }));

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      if (lockoutTimer.current)  { clearInterval(lockoutTimer.current);  lockoutTimer.current  = null; }
      if (navTimeout.current)    { clearTimeout(navTimeout.current);     navTimeout.current    = null; }
      if (successTimer.current)  { clearInterval(successTimer.current);  successTimer.current  = null; }
      if (focusTimeout.current)  { clearTimeout(focusTimeout.current);   focusTimeout.current  = null; }
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
    const sub = AppState.addEventListener('change', (st: AppStateStatus) => setAppActive(st === 'active'));
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (IS_WEB) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => state.loading || showSuccess);
    return () => sub.remove();
  }, [state.loading, showSuccess]);

  useEffect(() => {
    let cancelled = false;
    const runAnims = () => {
      if (cancelled || !isMounted.current) return;
      fadeProgress.value   = withTiming(1, { duration: getAnimDuration(300) });
      slideProgress.value  = withTiming(0, { duration: getAnimDuration(400) });
      headerProgress.value = withTiming(1, { duration: getAnimDuration(500) });

      const t1 = setTimeout(() => {
        if (cancelled || !isMounted.current) return;
        formProgress.value = withTiming(1, { duration: getAnimDuration(500) });
      }, getAnimDuration(150));

      const t2 = setTimeout(() => {
        if (cancelled || !isMounted.current) return;
        footerOpacity.value = withTiming(1, { duration: getAnimDuration(400) });
      }, getAnimDuration(300));

      return () => { clearTimeout(t1); clearTimeout(t2); };
    };

    let innerCleanup: (() => void) | undefined;
    if (typeof requestIdleCallback !== 'undefined') {
      const id = requestIdleCallback(() => { innerCleanup = runAnims() ?? undefined; });
      return () => { cancelled = true; cancelIdleCallback(id); innerCleanup?.(); };
    } else {
      const t = setTimeout(() => { innerCleanup = runAnims() ?? undefined; }, 0);
      return () => { cancelled = true; clearTimeout(t); innerCleanup?.(); };
    }
  }, [fadeProgress, slideProgress, headerProgress, formProgress, footerOpacity]);

  const startLockoutCountdown = useCallback(() => {
    if (lockoutTimer.current) clearInterval(lockoutTimer.current);
    const tick = () => {
      if (!isMounted.current) return;
      const r = Math.ceil((lockoutUntil.current - Date.now()) / 1000);
      if (r <= 0) {
        dispatch({ type: 'SET_LOCKOUT_SECONDS', payload: 0 });
        if (lockoutTimer.current) { clearInterval(lockoutTimer.current); lockoutTimer.current = null; }
      } else dispatch({ type: 'SET_LOCKOUT_SECONDS', payload: r });
    };
    tick();
    lockoutTimer.current = setInterval(tick, 1000);
  }, []);

  const startSuccessCountdown = useCallback(() => {
    const total = Math.ceil(SUCCESS_NAV_DELAY_MS / 1000);
    setSuccessCountdown(total);
    let rem = total;
    if (successTimer.current) clearInterval(successTimer.current);
    successTimer.current = setInterval(() => {
      rem -= 1;
      if (isMounted.current) setSuccessCountdown(rem);
      if (rem <= 0 && successTimer.current) { clearInterval(successTimer.current); successTimer.current = null; }
    }, 1000);
  }, []);

  const openModal  = useCallback((cfg: ModalConfig) => setModal(cfg), []);
  const closeModal = useCallback(() => setModal(null), []);

  const showAppAlert = useCallback((title: string, message: string, buttons?: { text: string; onPress?: () => void; style?: 'default' | 'cancel' | 'destructive' }[]) => {
    if (IS_WEB) {
      openModal({
        title, message,
        buttons: (buttons ?? [{ text: 'OK' }]).map((b, _, arr) => ({
          label: b.text, onPress: b.onPress,
          primary: b.style !== 'cancel' && arr.length > 1,
          danger:  b.style === 'destructive',
        })),
      });
    } else Alert.alert(title, message, buttons ?? [{ text: 'OK' }]);
  }, [openModal]);

  const handleKeyPress = useCallback((e: { nativeEvent?: { key?: string; getModifierState?: (key: string) => boolean } }) => {
    if (!IS_WEB || !e?.nativeEvent?.key) return;
    dispatch({ type: 'SET_CAPS_LOCK', payload: e.nativeEvent.getModifierState?.('CapsLock') ?? false });
  }, []);

  const canSubmit = useMemo(() => !!(
    state.email.trim() && state.password && !state.emailError && !state.passwordError &&
    !state.loading && state.lockoutSeconds === 0
  ), [state.email, state.password, state.emailError, state.passwordError, state.loading, state.lockoutSeconds]);

  const onEmailFocus    = useCallback(() => dispatch({ type: 'SET_EMAIL_FOCUSED',    payload: true }),  []);
  const onEmailBlur     = useCallback(() => dispatch({ type: 'SET_EMAIL_FOCUSED',    payload: false }), []);
  const onPasswordFocus = useCallback(() => dispatch({ type: 'SET_PASSWORD_FOCUSED', payload: true }),  []);
  const onPasswordBlur  = useCallback(() => {
    dispatch({ type: 'SET_PASSWORD_FOCUSED', payload: false });
    dispatch({ type: 'HIDE_PASSWORD' });
  }, []);
  const togglePassword  = useCallback(() => dispatch({ type: 'TOGGLE_PASSWORD' }), []);

  const validateEmail = useCallback((text: string) => {
    const s = text.trimStart().slice(0, 255).replace(/[\n\r]/g, '');
    dispatch({ type: 'SET_EMAIL', payload: s });
    if (s.length < 3) return dispatch({ type: 'SET_EMAIL_ERROR', payload: '' });
    dispatch({ type: 'SET_EMAIL_ERROR', payload: validators.email(s) });
  }, []);

  const validatePassword = useCallback((text: string) => {
    const s = text.slice(0, 129);
    dispatch({ type: 'SET_PASSWORD', payload: s });
    if (!s) return dispatch({ type: 'SET_PASSWORD_ERROR', payload: '' });
    dispatch({ type: 'SET_PASSWORD_ERROR', payload: validators.password(s) });
  }, []);

  const dismissKeyboard = useCallback(() => { if (!IS_WEB) Keyboard.dismiss(); }, []);

  const handleLogin = useCallback(async () => {
    dismissKeyboard();
    dispatch({ type: 'CLEAR_ERRORS' });
    const email    = state.email.trim().toLowerCase();
    const password = state.password;
    const emailErr = validators.email(email);
    const passErr  = validators.password(password);
    if (emailErr) { dispatch({ type: 'SET_EMAIL_ERROR',    payload: emailErr }); shake(); return; }
    if (passErr)  { dispatch({ type: 'SET_PASSWORD_ERROR', payload: passErr  }); shake(); return; }
    if (Date.now() < lockoutUntil.current) { startLockoutCountdown(); shake(); return; }

    dispatch({ type: 'SET_LOADING', payload: true });
    dispatch({ type: 'HIDE_PASSWORD' });

    try {
      const fp = await getDeviceFingerprint();
      if (fp) {
        const multiCheck = await checkDeviceMultiAccount(fp);
        if (multiCheck.suspicious) {
          if (!isMounted.current) return;
          dispatch({ type: 'SET_LOADING', payload: false });
          showAppAlert('Account Restricted', 'Multiple accounts detected from this device. Please contact support.');
          shake(); return;
        }
      }
      const bannedCheck = await checkUserBanned(email);
      if (bannedCheck.banned) {
        if (!isMounted.current) return;
        dispatch({ type: 'SET_LOADING', payload: false });
        showAppAlert('Account Suspended', bannedCheck.reason ?? 'This account has been suspended. Contact support.');
        shake(); return;
      }

      try {
        const loginSafety = await checkLogin(email, password, '', {
          serverUrl: '', enableLoginCheck: true, enableMessageCheck: false,
          enablePhotoCheck: false, enableRegistrationCheck: false, enableProfileCheck: false,
          autoBlockCritical: true, logAllChecks: false,
        });
        if (!loginSafety.allowed) {
          if (!isMounted.current) return;
          dispatch({ type: 'SET_LOADING', payload: false });
          showAppAlert('Access Denied', loginSafety.reasons.join('\n') || 'Login blocked by safety system.');
          shake(); return;
        }
      } catch (safetyErr) {
        if (__DEV__) console.warn('[Login] Safety middleware check failed, continuing:', safetyErr);
      }

      const hadLocalKeys    = !!(await getLocalE2EEKeypair());
      const { user }        = await signInWithEmailAndPassword(auth, email, password);
      if (!user.emailVerified) {
        await auth.signOut();
        if (!isMounted.current) return;
        dispatch({ type: 'SET_LOADING', payload: false });
        shake();
        showAppAlert('Email Not Verified', 'Please verify your email before logging in.\n\nCheck your inbox (and spam folder).', [{ text: 'OK' }]);
        return;
      }
      if (fp) await recordDeviceLogin(user.uid, fp, email);
      const e2eeResult   = await ensureMyE2EEIdentity();
      const hasKeysAfter = !!(await getLocalE2EEKeypair());
      await writeAuditLog('user.login', {
        uid: user.uid,
        maskedEmail: email.replace(/^(.)(.*)(.@.*)$/, (_, a, b, c) => `${a}${'*'.repeat(Math.min(String(b).length, 6))}${c}`),
        emailDomain: email.split('@')[1] ?? '',
        deviceFingerprint: fp,
        e2eeInitialized: e2eeResult.success,
      });
      loginAttempts.current = 0;
      if (lockoutTimer.current) { clearInterval(lockoutTimer.current); lockoutTimer.current = null; }
      await triggerHaptic('success');
      dispatch({ type: 'CLEAR_PASSWORD' });
      if (!isMounted.current) return;
      dispatch({ type: 'SET_LOADING', payload: false });
      if (!hadLocalKeys && hasKeysAfter) {
        showAppAlert('Encrypted Chats Reset', 'A new encryption key was created for this device. Older encrypted chats may not be readable here.', [{ text: 'Continue' }]);
      }
      setSuccess(true);
      startSuccessCountdown();
      navTimeout.current = setTimeout(() => {
        if (isMounted.current) router.replace(ROUTES.HOME);
      }, getAnimDuration(SUCCESS_NAV_DELAY_MS));
    } catch (error: unknown) {
      const code = getErrorCode(error);
      loginAttempts.current += 1;
      if (loginAttempts.current >= MAX_LOGIN_ATTEMPTS) {
        lockoutUntil.current  = Date.now() + LOCKOUT_DURATION_MS;
        loginAttempts.current = 0;
        startLockoutCountdown();
      }
      await triggerHaptic('error');
      shake();
      if (!isMounted.current) return;
      if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
        dispatch({ type: 'CLEAR_PASSWORD' });
        focusTimeout.current = setTimeout(() => passwordRef.current?.focus(), 100);
      } else if (code === 'auth/invalid-email') {
        focusTimeout.current = setTimeout(() => emailRef.current?.focus(), 100);
      }
      showAppAlert('Login Failed', getErrorMessage(code, ERROR_MESSAGES));
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  }, [state.email, state.password, router, dismissKeyboard, startLockoutCountdown, startSuccessCountdown, shake, showAppAlert]);

  const handleResendVerification = useCallback(async () => {
    dismissKeyboard();
    const email    = state.email.trim();
    const password = state.password;
    if (!email)                    return showAppAlert('Email Required',    'Please enter your email address first.');
    if (!password)                 return showAppAlert('Password Required', 'Please enter your password to verify identity.');
    if (validators.email(email))   return showAppAlert('Invalid Email',     'Please enter a valid email address.');
    if (Date.now() < resendLockUntil.current) {
      const secs = Math.ceil((resendLockUntil.current - Date.now()) / 1000);
      return showAppAlert('Please Wait', `You can resend again in ${secs} seconds.`);
    }
    resendAttempts.current += 1;
    if (resendAttempts.current > MAX_RESEND_ATTEMPTS) {
      resendLockUntil.current = Date.now() + RATE_LIMIT_WINDOW_MS;
      resendAttempts.current  = 0;
      return showAppAlert('Too Many Requests', 'Please wait 60 seconds before requesting another email.');
    }
    dispatch({ type: 'SET_LOADING', payload: true });
    try {
      const { user } = await signInWithEmailAndPassword(auth, email.toLowerCase(), password);
      if (user.emailVerified) {
        await auth.signOut();
        if (isMounted.current) showAppAlert('Already Verified', 'Your email is already verified. You can log in now.');
        return;
      }
      await sendEmailVerification(user);
      await auth.signOut();
      if (isMounted.current) showAppAlert('Email Sent', `Verification email sent to:\n${email}`);
    } catch (error: unknown) {
      if (isMounted.current) showAppAlert('Error', getErrorMessage(getErrorCode(error), ERROR_MESSAGES));
    } finally {
      if (isMounted.current) dispatch({ type: 'SET_LOADING', payload: false });
    }
  }, [state.email, state.password, dismissKeyboard, showAppAlert]);

  const handleForgotPassword = useCallback(() => {
    dismissKeyboard();
    const email = state.email.trim();
    if (!email)                  return showAppAlert('Email Required', 'Please enter your email address above, then try again.');
    if (validators.email(email)) { dispatch({ type: 'SET_EMAIL_ERROR', payload: 'Please enter a valid email' }); return; }
    if (Date.now() < forgotLockUntil.current) {
      const secs = Math.ceil((forgotLockUntil.current - Date.now()) / 1000);
      return showAppAlert('Please Wait', `You can request another reset in ${secs} seconds.`);
    }
    forgotAttempts.current += 1;
    if (forgotAttempts.current > MAX_FORGOT_ATTEMPTS) {
      forgotLockUntil.current = Date.now() + RATE_LIMIT_WINDOW_MS;
      forgotAttempts.current  = 0;
      return showAppAlert('Too Many Requests', 'Please wait 60 seconds before requesting another reset.');
    }
    showAppAlert('Reset Password', `Send password reset email to:\n${email}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Send Reset Email',
        onPress: async () => {
          dispatch({ type: 'SET_LOADING', payload: true });
          try {
            await sendPasswordResetEmail(auth, email.toLowerCase());
            if (isMounted.current) showAppAlert('Email Sent', `Password reset instructions sent to:\n${email}`);
          } catch (error: unknown) {
            if (isMounted.current) showAppAlert('Error', getErrorMessage(getErrorCode(error), ERROR_MESSAGES));
          } finally {
            if (isMounted.current) dispatch({ type: 'SET_LOADING', payload: false });
          }
        },
      },
    ]);
  }, [state.email, dismissKeyboard, showAppAlert]);

  const handleSignUp      = useCallback(() => { if (!state.loading) router.push(ROUTES.SIGNUP); }, [state.loading, router]);
  const handleEmailSubmit = useCallback(() => passwordRef.current?.focus(), []);
  const IS_SMALL          = screenData.isSmall;
  const logoPaused        = state.emailFocused || state.passwordFocused || state.loading || !appActive;

  const scrollContentStyle = useMemo(
    () => [s.scrollContent, { padding: IS_SMALL ? 20 : 28 }],
    [IS_SMALL],
  );

  const innerContentProps = useMemo(() => ({
    C, state, IS_SMALL,
    screenStyle, headerStyle, formStyle, footerStyle,
    emailRef, passwordRef, canSubmit, logoPaused,
    validateEmail, validatePassword,
    onEmailFocus, onEmailBlur, onPasswordFocus, onPasswordBlur,
    togglePassword, handleLogin, handleEmailSubmit,
    handleForgotPassword, handleResendVerification, handleSignUp, handleKeyPress,
  }), [
    C, state, IS_SMALL,
    screenStyle, headerStyle, formStyle, footerStyle,
    emailRef, passwordRef, canSubmit, logoPaused,
    validateEmail, validatePassword,
    onEmailFocus, onEmailBlur, onPasswordFocus, onPasswordBlur,
    togglePassword, handleLogin, handleEmailSubmit,
    handleForgotPassword, handleResendVerification, handleSignUp, handleKeyPress,
  ]);

  return (
    <LoginErrorBoundary>
      <View style={[s.rootBg, { backgroundColor: C.bg }]}>
        <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={C.bg} translucent={false} />
        <LinearGradient colors={[C.bgGradientStart, C.bgGradientMid, C.bgGradientEnd]} style={s.absoluteFill} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} />
        {IS_WEB ? (
          <View style={[s.safe, { backgroundColor: C.bg }]}>
            <View style={s.container}>
              <KeyboardAwareScrollView
                style={s.fill}
                contentContainerStyle={scrollContentStyle}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                bounces={false}
              >
                <Pressable style={s.fill} onPress={dismissKeyboard} accessibilityLabel="Dismiss keyboard">
                  <InnerContent {...innerContentProps} />
                </Pressable>
              </KeyboardAwareScrollView>

              {state.loading && !showSuccess && (
                <Animated.View entering={FadeIn.duration(getAnimDuration(150))} exiting={FadeOut.duration(getAnimDuration(150))} style={[s.loadingOverlay, { backgroundColor: C.overlay }]} pointerEvents="box-only" accessibilityViewIsModal accessibilityLiveRegion="polite">
                  <View style={[s.loadingCard, { backgroundColor: C.card, borderColor: C.cardBorder }]} accessibilityRole="alert">
                    <ActivityIndicator size="large" color={C.accent} />
                    <Text style={[s.loadingText, { color: C.textSecondary }]}>Signing you in…</Text>
                  </View>
                </Animated.View>
              )}

              {showSuccess && <SuccessOverlay C={C} secondsLeft={successCountdown} />}
              {modal && IS_WEB && <CustomModal config={modal} onClose={closeModal} C={C} />}
            </View>
          </View>
        ) : (
          <SafeAreaView style={[s.safe, { backgroundColor: C.bg }]} edges={['top', 'bottom']}>
            <View style={s.container}>
              <KeyboardAwareScrollView
                style={s.fill}
                contentContainerStyle={scrollContentStyle}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                bounces={false}
              >
                <Pressable style={s.fill} onPress={dismissKeyboard} accessibilityLabel="Dismiss keyboard">
                  <InnerContent {...innerContentProps} />
                </Pressable>
              </KeyboardAwareScrollView>

              {state.loading && !showSuccess && (
                <Animated.View entering={FadeIn.duration(getAnimDuration(150))} exiting={FadeOut.duration(getAnimDuration(150))} style={[s.loadingOverlay, { backgroundColor: C.overlay }]} pointerEvents="box-only" accessibilityViewIsModal accessibilityLiveRegion="polite">
                  <View style={[s.loadingCard, { backgroundColor: C.card, borderColor: C.cardBorder }]} accessibilityRole="alert">
                    <ActivityIndicator size="large" color={C.accent} />
                    <Text style={[s.loadingText, { color: C.textSecondary }]}>Signing you in…</Text>
                  </View>
                </Animated.View>
              )}

              {showSuccess && <SuccessOverlay C={C} secondsLeft={successCountdown} />}
              {modal && IS_WEB && <CustomModal config={modal} onClose={closeModal} C={C} />}
            </View>
          </SafeAreaView>
        )}
      </View>
    </LoginErrorBoundary>
  );
}