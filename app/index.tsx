import { useRouter } from 'expo-router';
import { onAuthStateChanged } from 'firebase/auth';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { auth } from '../firebaseConfig';

const storage = new MMKV({ id: 'app-storage' });

const { width } = Dimensions.get('window');

interface OnboardingSlide {
  id: string;
  icon: string;
  title: string;
  titleAz: string;
  description: string;
  descriptionAz: string;
  backgroundColor: string;
}

const slides: OnboardingSlide[] = [
  {
    id: '1',
    icon: '💕',
    title: 'Welcome to MyArchetype',
    titleAz: 'MyArchetype-a xoş gəlmisiniz',
    description: 'A dating app designed for genuine connections.\nNo games. No superficial swiping. Just real people.',
    descriptionAz: 'Həqiqi əlaqələr üçün yaradılmış tanışlıq tətbiqi.\nOyun yoxdur. Səthi sürüşdürmə yoxdur. Sadəcə həqiqi insanlar.',
    backgroundColor: '#1a1a2e',
  },
  {
    id: '2',
    icon: '🧠',
    title: 'Deep Compatibility',
    titleAz: 'Dərin Uyğunluq',
    description: 'Personality tests, verification systems, and smart matching based on values, lifestyle, and goals.',
    descriptionAz: 'Şəxsiyyət testləri, doğrulama sistemləri və dəyərlərə, həyat tərzinə və məqsədlərə əsaslanan ağıllı uyğunluq.',
    backgroundColor: '#0f3460',
  },
  {
    id: '3',
    icon: '✅',
    title: 'Trust & Verification',
    titleAz: 'Etibar və Doğrulama',
    description: 'Selfie verification, community ratings, and photo authenticity checks keep our community safe.',
    descriptionAz: 'Selfie doğrulaması, icma reytinqləri və foto orijinallıq yoxlamaları icmamızı təhlükəsiz saxlayır.',
    backgroundColor: '#16213e',
  },
  {
    id: '4',
    icon: '🆓',
    title: '100% Free, Forever',
    titleAz: '100% Pulsuz, Həmişə',
    description: 'No premium subscriptions.\nNo hidden fees.\nNo restrictions.\nJust love, for everyone.',
    descriptionAz: 'Premium abunəlik yoxdur.\nGizli ödəniş yoxdur.\nMəhdudiyyət yoxdur.\nHamı üçün sadəcə sevgi.',
    backgroundColor: '#1a1a2e',
  },
];

export default function WelcomeScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const flatListRef = useRef<FlatList>(null);

  useEffect(() => {
    checkFirstLaunch();
  }, []);

  const checkFirstLaunch = () => {
    try {
      // Check if user has seen onboarding (MMKV is synchronous)
      const hasSeenOnboarding = storage.getString('hasSeenOnboarding');

      // Check auth state
      const unsubscribe = onAuthStateChanged(auth, (user) => {
        if (user) {
          // User is logged in, go to home
          router.replace('/home');
        } else if (hasSeenOnboarding === 'true') {
          // User has seen onboarding but not logged in
          router.replace('/login');
        } else {
          // First time user, show onboarding
          setShowOnboarding(true);
        }
        setLoading(false);
      });

      return () => unsubscribe();
    } catch (error) {
      console.error('Error checking first launch:', error);
      setShowOnboarding(true);
      setLoading(false);
    }
  };

  const handleNext = () => {
    if (currentIndex < slides.length - 1) {
      const nextIndex = currentIndex + 1;
      flatListRef.current?.scrollToIndex({ index: nextIndex });
      setCurrentIndex(nextIndex);
    }
  };

  const handleSkip = () => {
    storage.set('hasSeenOnboarding', 'true');
    router.replace('/login');
  };

  const handleGetStarted = () => {
    storage.set('hasSeenOnboarding', 'true');
    router.replace('/signup');
  };

  const renderSlide = ({ item }: { item: OnboardingSlide }) => (
    <View style={[styles.slide, { width, backgroundColor: item.backgroundColor }]}>
      <Text style={styles.slideIcon}>{item.icon}</Text>
      <Text style={styles.slideTitle}>{item.title}</Text>
      <Text style={styles.slideTitleAz}>{item.titleAz}</Text>
      <Text style={styles.slideDescription}>{item.description}</Text>
      <Text style={styles.slideDescriptionAz}>{item.descriptionAz}</Text>
    </View>
  );

  const renderDots = () => (
    <View style={styles.dotsContainer}>
      {slides.map((_, index) => (
        <View
          key={index}
          style={[
            styles.dot,
            currentIndex === index && styles.dotActive,
          ]}
        />
      ))}
    </View>
  );

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.logo}>MyArchetype</Text>
        <ActivityIndicator size="large" color="#53a8b6" style={styles.loader} />
      </View>
    );
  }

  if (!showOnboarding) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#53a8b6" />
      </View>
    );
  }

  const isLastSlide = currentIndex === slides.length - 1;

  return (
    <View style={styles.container}>
      <FlatList
        ref={flatListRef}
        data={slides}
        renderItem={renderSlide}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(event) => {
          const index = Math.round(event.nativeEvent.contentOffset.x / width);
          setCurrentIndex(index);
        }}
        keyExtractor={(item) => item.id}
      />

      {renderDots()}

      <View style={styles.buttonsContainer}>
        {!isLastSlide ? (
          <>
            <TouchableOpacity style={styles.skipButton} onPress={handleSkip}>
              <Text style={styles.skipButtonText}>Skip</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.nextButton} onPress={handleNext}>
              <Text style={styles.nextButtonText}>Next →</Text>
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity style={styles.getStartedButton} onPress={handleGetStarted}>
            <Text style={styles.getStartedButtonText}>Get Started 🚀</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.footer}>
        <TouchableOpacity onPress={() => router.push('/login')}>
          <Text style={styles.footerText}>
            Already have an account? <Text style={styles.footerLink}>Log In</Text>
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    justifyContent: 'center',
    alignItems: 'center',
  },
  logo: {
    fontSize: 36,
    fontWeight: 'bold',
    color: '#eee',
    marginBottom: 30,
  },
  loader: {
    marginTop: 20,
  },
  slide: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  slideIcon: {
    fontSize: 80,
    marginBottom: 30,
  },
  slideTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#eee',
    textAlign: 'center',
    marginBottom: 5,
  },
  slideTitleAz: {
    fontSize: 18,
    color: '#53a8b6',
    textAlign: 'center',
    marginBottom: 25,
    fontStyle: 'italic',
  },
  slideDescription: {
    fontSize: 16,
    color: '#aaa',
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 10,
  },
  slideDescriptionAz: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    lineHeight: 22,
    fontStyle: 'italic',
  },
  dotsContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 20,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#3a3a4e',
    marginHorizontal: 5,
  },
  dotActive: {
    backgroundColor: '#53a8b6',
    width: 25,
  },
  buttonsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 30,
    paddingBottom: 20,
    gap: 15,
  },
  skipButton: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 25,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#3a3a4e',
  },
  skipButtonText: {
    color: '#888',
    fontSize: 16,
    fontWeight: '600',
  },
  nextButton: {
    flex: 1,
    backgroundColor: '#53a8b6',
    paddingVertical: 16,
    borderRadius: 25,
    alignItems: 'center',
  },
  nextButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  getStartedButton: {
    flex: 1,
    backgroundColor: '#5cb85c',
    paddingVertical: 18,
    borderRadius: 25,
    alignItems: 'center',
  },
  getStartedButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  footer: {
    paddingBottom: 40,
    alignItems: 'center',
  },
  footerText: {
    color: '#888',
    fontSize: 14,
  },
  footerLink: {
    color: '#53a8b6',
    fontWeight: '600',
  },
});