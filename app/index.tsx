import { useRouter } from 'expo-router';
import { onAuthStateChanged } from 'firebase/auth';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import {
  AccessibilityInfo,
  ActivityIndicator,
  LayoutAnimation,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  UIManager,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { auth } from '../firebaseConfig';
import { getTranslation } from '../utils/i18n';
import { logger } from '../utils/logger';
import { appStorage } from '../utils/storage';

if (Platform.OS === 'android') {
  UIManager.setLayoutAnimationEnabledExperimental?.(true);
}

const STORAGE_KEY_ONBOARDING = 'onboarding.hasSeenOnboarding';
const STORAGE_KEY_LANGUAGE   = 'app.language';
const AUTH_TIMEOUT_MS        = 10_000;

const ROUTES = {
  login:   '/login',
  signup:  '/signup',
  terms:   '/terms',
  privacy: '/privacy',
} as const;

const COLORS = {
  background:     '#1a1a2e',
  backgroundAlt:  '#0f3460',
  backgroundDeep: '#16213e',
  primary:        '#53a8b6',
  success:        '#5cb85c',
  textLight:      '#eee',
  textMuted:      '#aaa',
  textDim:        '#888',
  inactive:       '#3a3a4e',
  white:          '#fff',
} as const;

const BORDER_RADIUS = { button: 25, dot: 5 } as const;

type TitleKey       = 'onboardingTitle1' | 'onboardingTitle2' | 'onboardingTitle3';
type DescriptionKey = 'onboardingDesc1'  | 'onboardingDesc2'  | 'onboardingDesc3';

interface OnboardingSlide {
  readonly id:              string;
  readonly icon:            string;
  readonly iconLabel:       string;
  readonly titleKey:        TitleKey;
  readonly descriptionKey:  DescriptionKey;
  readonly backgroundColor: string;
}

const SLIDES: readonly OnboardingSlide[] = [
  { id: '1', icon: '💕', iconLabel: 'Two hearts', titleKey: 'onboardingTitle1', descriptionKey: 'onboardingDesc1', backgroundColor: COLORS.background     },
  { id: '2', icon: '🧠', iconLabel: 'Brain',      titleKey: 'onboardingTitle2', descriptionKey: 'onboardingDesc2', backgroundColor: COLORS.backgroundAlt  },
  { id: '3', icon: '🆓', iconLabel: 'Free label', titleKey: 'onboardingTitle3', descriptionKey: 'onboardingDesc3', backgroundColor: COLORS.backgroundDeep },
];

const SLIDES_COUNT = SLIDES.length;
const LAST_INDEX   = SLIDES_COUNT - 1;

type Lang = Parameters<typeof getTranslation>[0];

const markOnboardingSeen = () => appStorage.set(STORAGE_KEY_ONBOARDING, true);

function readStoredLanguage(): Lang {
  return (appStorage.getString(STORAGE_KEY_LANGUAGE) ?? 'en') as Lang;
}

const pressableStyle = (base: object) => ({ pressed }: { pressed: boolean }) => [
  base,
  pressed && styles.buttonPressed,
];

interface LoadingScreenProps {
  message?:  string;
  timedOut?: boolean;
  onRetry?:  () => void;
}

const LoadingScreen = React.memo<LoadingScreenProps>(({ message, timedOut = false, onRetry }) => (
  <View style={styles.loadingContainer} accessible accessibilityLabel={message ?? 'Loading MyArchetype'} testID="loading-screen">
    <Text style={styles.logo}>MyArchetype</Text>
    <ActivityIndicator size="large" color={COLORS.primary} style={styles.loader} />
    {message ? <Text style={styles.loadingMessage}>{message}</Text> : null}
    {timedOut && onRetry ? (
      <Pressable
        style={styles.retryButton}
        onPress={onRetry}
        accessibilityRole="button"
        accessibilityLabel="Retry connection"
        accessibilityHint="Attempts to reconnect to the server"
        testID="retry-button"
      >
        <Text style={styles.retryButtonText}>Tap to retry</Text>
      </Pressable>
    ) : null}
  </View>
));
LoadingScreen.displayName = 'LoadingScreen';

interface SlideProps {
  item:        OnboardingSlide;
  screenWidth: number;
  title:       string;
  description: string;
}

const Slide = React.memo<SlideProps>(({ item, screenWidth, title, description }) => {
  const slideStyle = useMemo(
    () => [styles.slide, { width: screenWidth, backgroundColor: item.backgroundColor }],
    [screenWidth, item.backgroundColor],
  );
  return (
    <View style={slideStyle} accessible accessibilityLabel={`${title}. ${description}`} testID={`onboarding-slide-${item.id}`}>
      <Text style={styles.slideIcon}>{item.icon}</Text>
      <Text style={styles.slideTitle}>{title}</Text>
      <Text style={styles.slideDescription}>{description}</Text>
    </View>
  );
});
Slide.displayName = 'Slide';

const PaginationDots = React.memo<{ currentIndex: number }>(
  ({ currentIndex }) => (
    <View
      style={styles.dotsContainer}
      accessible
      accessibilityLabel={`Slide ${currentIndex + 1} of ${SLIDES_COUNT}`}
      testID="pagination-dots"
    >
      {SLIDES.map((_, i) => (
        <View key={i} style={[styles.dot, currentIndex === i && styles.dotActive]} testID={`pagination-dot-${i}`} />
      ))}
    </View>
  ),
);
PaginationDots.displayName = 'PaginationDots';

export default function WelcomeScreen() {
  const router                 = useRouter();
  const insets                 = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();

  const t = useMemo(() => getTranslation(readStoredLanguage()), []);

  const [loading,        setLoading]        = useState(true);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [currentIndex,   setCurrentIndex]   = useState(0);
  const [timedOut,       setTimedOut]       = useState(false);
  const [reduceMotion,   setReduceMotion]   = useState(false);

  const scrollRef      = useRef<ScrollView | null>(null);
  const unsubscribeRef = useRef<(() => void) | undefined>(undefined);
  const timeoutRef     = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then(v => { if (active) setReduceMotion(v); })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', v => {
      if (active) setReduceMotion(v);
    });
    return () => {
      active = false;
      sub.remove();
    };
  }, []);

  const runAuthCheck = useCallback(() => {
    unsubscribeRef.current?.();
    clearTimeout(timeoutRef.current);

    setTimedOut(false);
    setLoading(true);

    try {
      const hasSeenOnboarding = appStorage.getBoolean(STORAGE_KEY_ONBOARDING) === true;

      timeoutRef.current = setTimeout(() => {
        unsubscribeRef.current?.();
        setTimedOut(true);
        setShowOnboarding(true);
        setLoading(false);
      }, AUTH_TIMEOUT_MS);

      unsubscribeRef.current = onAuthStateChanged(auth, user => {
        clearTimeout(timeoutRef.current);
        if (user) {
          setLoading(false);
        } else if (hasSeenOnboarding) {
          router.replace(ROUTES.login);
        } else {
          setShowOnboarding(true);
          setLoading(false);
        }
      });
    } catch (error: unknown) {
      logger.error('[WelcomeScreen] runAuthCheck error:', error);
      clearTimeout(timeoutRef.current);
      setShowOnboarding(true);
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    runAuthCheck();
    return () => {
      unsubscribeRef.current?.();
      clearTimeout(timeoutRef.current);
    };
  }, [runAuthCheck]);

  const updateIndex = useCallback((next: number) => {
    if (!reduceMotion) LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setCurrentIndex(next);
  }, [reduceMotion]);

  const handleNext = useCallback(() => {
    const next = currentIndex + 1;
    if (next < SLIDES_COUNT) {
      scrollRef.current?.scrollTo({ x: next * screenWidth, animated: !reduceMotion });
      updateIndex(next);
    }
  }, [currentIndex, reduceMotion, screenWidth, updateIndex]);

  const handleSkip         = useCallback(() => { markOnboardingSeen(); router.replace(ROUTES.login);  }, [router]);
  const handleGetStarted   = useCallback(() => { markOnboardingSeen(); router.replace(ROUTES.signup); }, [router]);
  const handleLoginPress   = useCallback(() => { router.push(ROUTES.login);   }, [router]);
  const handleTermsPress   = useCallback(() => { router.push(ROUTES.terms);   }, [router]);
  const handlePrivacyPress = useCallback(() => { router.push(ROUTES.privacy); }, [router]);

  const handleMomentumScrollEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const next = Math.round(e.nativeEvent.contentOffset.x / screenWidth);
      if (next !== currentIndex) updateIndex(next);
    },
    [screenWidth, currentIndex, updateIndex],
  );

  const containerStyle = useMemo(
    () => [styles.container, { paddingTop: insets.top }],
    [insets.top],
  );
  const buttonsContainerStyle = useMemo(
    () => [styles.buttonsContainer, { paddingBottom: insets.bottom > 0 ? 8 : 20 }],
    [insets.bottom],
  );
  const footerStyle = useMemo(
    () => [styles.footer, { paddingBottom: Math.max(insets.bottom, 24) }],
    [insets.bottom],
  );

  const isLastSlide = currentIndex === LAST_INDEX;

  if (loading) {
    return (
      <LoadingScreen
        message={timedOut ? t.somethingWentWrong : t.loading}
        timedOut={timedOut}
        onRetry={runAuthCheck}
      />
    );
  }

  if (!showOnboarding) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  return (
    <View style={containerStyle}>
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={handleMomentumScrollEnd}
        scrollEventThrottle={16}
        decelerationRate="fast"
        accessibilityLabel="Onboarding slides"
      >
        {SLIDES.map(item => (
          <Slide
            key={item.id}
            item={item}
            screenWidth={screenWidth}
            title={t[item.titleKey]}
            description={t[item.descriptionKey]}
          />
        ))}
      </ScrollView>

      <PaginationDots currentIndex={currentIndex} />

      <View style={buttonsContainerStyle}>
        {isLastSlide ? (
          <Pressable
            style={pressableStyle(styles.getStartedButton)}
            onPress={handleGetStarted}
            accessibilityRole="button"
            accessibilityLabel={t.getStarted}
            accessibilityHint="Takes you to the sign-up screen"
            testID="get-started-button"
          >
            <Text style={styles.getStartedButtonText}>{t.getStarted} 🚀</Text>
          </Pressable>
        ) : (
          <>
            <Pressable
              style={pressableStyle(styles.skipButton)}
              onPress={handleSkip}
              accessibilityRole="button"
              accessibilityLabel={t.skip}
              accessibilityHint="Skips onboarding and takes you to the login screen"
              testID="skip-button"
            >
              <Text style={styles.skipButtonText}>{t.skip}</Text>
            </Pressable>
            <Pressable
              style={pressableStyle(styles.nextButton)}
              onPress={handleNext}
              accessibilityRole="button"
              accessibilityLabel={t.next}
              accessibilityHint={`Goes to slide ${currentIndex + 2} of ${SLIDES_COUNT}`}
              testID="next-button"
            >
              <Text style={styles.nextButtonText}>{t.next} →</Text>
            </Pressable>
          </>
        )}
      </View>

      <View style={footerStyle}>
        <Pressable
          onPress={handleLoginPress}
          accessibilityRole="link"
          accessibilityLabel={t.alreadyHaveAccount}
          accessibilityHint="Takes you to the login screen"
          hitSlop={{ top: 12, bottom: 12, left: 16, right: 16 }}
        >
          <Text style={styles.footerText}>
            {t.alreadyHaveAccountPrompt}{' '}
            <Text style={styles.footerLink}>{t.login}</Text>
          </Text>
        </Pressable>

        <View style={styles.legalRow}>
          <Pressable
            onPress={handleTermsPress}
            accessibilityRole="link"
            accessibilityLabel={t.termsOfService}
            accessibilityHint="Opens the Terms of Service"
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text style={styles.legalLink}>{t.termsOfService}</Text>
          </Pressable>
          <Text style={styles.legalSeparator}>·</Text>
          <Pressable
            onPress={handlePrivacyPress}
            accessibilityRole="link"
            accessibilityLabel={t.privacyPolicy}
            accessibilityHint="Opens the Privacy Policy"
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text style={styles.legalLink}>{t.privacyPolicy}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container:            { flex: 1, backgroundColor: COLORS.background },
  loadingContainer:     { flex: 1, backgroundColor: COLORS.background, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 },
  logo:                 { fontSize: 36, fontWeight: '700', color: COLORS.textLight, marginBottom: 30 },
  loader:               { marginTop: 20 },
  loadingMessage:       { marginTop: 16, fontSize: 14, color: COLORS.textMuted, textAlign: 'center' },
  retryButton:          { marginTop: 24, paddingVertical: 12, paddingHorizontal: 28, borderRadius: BORDER_RADIUS.button, backgroundColor: COLORS.primary },
  retryButtonText:      { color: COLORS.white, fontSize: 15, fontWeight: '600' },
  slide:                { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 40 },
  slideIcon:            { fontSize: 80, marginBottom: 30, textAlign: 'center' },
  slideTitle:           { fontSize: 28, fontWeight: '700', color: COLORS.textLight, textAlign: 'center', marginBottom: 20 },
  slideDescription:     { fontSize: 16, color: COLORS.textMuted, textAlign: 'center', lineHeight: 24 },
  dotsContainer:        { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', paddingVertical: 20 },
  dot:                  { width: 10, height: 10, borderRadius: BORDER_RADIUS.dot, backgroundColor: COLORS.inactive, marginHorizontal: 5 },
  dotActive:            { backgroundColor: COLORS.primary, width: 25 },
  buttonsContainer:     { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 30, gap: 15 },
  buttonPressed:        { opacity: 0.72 },
  skipButton:           { flex: 1, paddingVertical: 16, borderRadius: BORDER_RADIUS.button, alignItems: 'center', borderWidth: 2, borderColor: COLORS.inactive, minHeight: 44 },
  skipButtonText:       { color: COLORS.textDim, fontSize: 16, fontWeight: '600' },
  nextButton:           { flex: 1, backgroundColor: COLORS.primary, paddingVertical: 16, borderRadius: BORDER_RADIUS.button, alignItems: 'center', minHeight: 44 },
  nextButtonText:       { color: COLORS.white, fontSize: 16, fontWeight: '600' },
  getStartedButton:     { flex: 1, backgroundColor: COLORS.success, paddingVertical: 18, borderRadius: BORDER_RADIUS.button, alignItems: 'center', minHeight: 44 },
  getStartedButtonText: { color: COLORS.white, fontSize: 18, fontWeight: '700' },
  footer:               { alignItems: 'center', paddingTop: 12, gap: 12 },
  footerText:           { color: COLORS.textDim, fontSize: 14 },
  footerLink:           { color: COLORS.primary, fontWeight: '600' },
  legalRow:             { flexDirection: 'row', alignItems: 'center', gap: 8 },
  legalLink:            { color: COLORS.textDim, fontSize: 12, textDecorationLine: 'underline' },
  legalSeparator:       { color: COLORS.inactive, fontSize: 12 },
});