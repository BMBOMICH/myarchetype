import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { deleteUser } from 'firebase/auth';
import { collection, deleteDoc, doc, getDoc, getDocs, updateDoc } from 'firebase/firestore';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { CLOUDINARY_CONFIG } from '../cloudinaryConfig';
import BodyTypeSelector from '../components/BodyTypeSelector';
import TrustScoreDisplay from '../components/TrustScoreDisplay';
import { auth, db } from '../firebaseConfig';
import { requestLocationPermission, saveUserLocation } from '../utils/location';
import { formatName, validateName } from '../utils/nameValidation';
import { deleteVideoProfile } from '../utils/videoProfiles';

// ============ CONSTANTS (outside component) ============

const ICEBREAKER_PROMPTS = [
  "My perfect Sunday looks like...",
  "The way to my heart is...",
  "I'm looking for someone who...",
  "My most controversial opinion is...",
  "Two truths and a lie about me...",
  "The best trip I ever took was...",
  "I geek out about...",
  "My hidden talent is...",
  "I'll know it's love when...",
  "The key to my heart is...",
  "I'm weirdly attracted to...",
  "My love language is...",
  "On weekends you'll find me...",
  "I'm convinced that...",
  "My friends would describe me as...",
];

const RELIGIOUS_OPTIONS = [
  { value: 'Traditional', desc: 'Follow religious practices regularly' },
  { value: 'Modern', desc: 'Believe but flexible interpretation' },
  { value: 'Spiritual', desc: 'Spiritual but not organized religion' },
  { value: 'None', desc: 'Not religious or spiritual' },
];

const LIFESTYLE_OPTIONS = [
  { value: 'Natural', desc: 'Simple, outdoors, minimal' },
  { value: 'Fitness', desc: 'Active, gym, health-focused' },
  { value: 'Social', desc: 'Outgoing, parties, events' },
  { value: 'Homebody', desc: 'Cozy nights in, relaxing' },
];

const RELATIONSHIP_OPTIONS = [
  { value: 'Marriage', desc: 'Looking for life partner' },
  { value: 'Long-term', desc: 'Serious but not rushing' },
  { value: 'Exploring', desc: 'Open to see where it goes' },
];

const MAX_PHOTOS = 3;
const MAX_BIO_LENGTH = 200;
const MAX_ICEBREAKER_LENGTH = 150;
const VIDEO_OLD_DAYS = 180;

// ============ TYPES ============

interface UserData {
  name?: string;
  age?: number;
  height?: number | { value: number; verificationMethod: string; verifiedAt: string };
  bodyType?: string;
  lookingFor?: string;
  religiousViews?: string;
  lifestyle?: string;
  relationshipGoal?: string;
  bio?: string;
  photos?: string[];
  personalityType?: string;
  icebreaker?: string;
  icebreakerPrompt?: string;
  videoProfile?: string;
  videoProfileUploadedAt?: string;
  location?: { city?: string; country?: string };
  selfieVerified?: boolean;
  ageVerification?: { verified?: boolean };
  ratings?: { trustScore?: number };
}

// ============ HELPERS ============

const getVideoAge = (uploadedAt: string | null): string => {
  if (!uploadedAt) return '';
  const daysSince = Math.floor((Date.now() - new Date(uploadedAt).getTime()) / (1000 * 60 * 60 * 24));
  if (daysSince === 0) return 'Today';
  if (daysSince === 1) return 'Yesterday';
  if (daysSince < 30) return `${daysSince} days ago`;
  if (daysSince < 60) return '1 month ago';
  if (daysSince < 365) return `${Math.floor(daysSince / 30)} months ago`;
  return 'Over a year ago';
};

const isVideoOld = (uploadedAt: string | null): boolean => {
  if (!uploadedAt) return false;
  const daysSince = Math.floor((Date.now() - new Date(uploadedAt).getTime()) / (1000 * 60 * 60 * 24));
  return daysSince > VIDEO_OLD_DAYS;
};

const getHeightBadgeText = (method: string): string => {
  if (method === 'manual-measured') return 'Verified';
  if (method === 'ai-estimated') return 'AI Estimated';
  return '';
};

// ============ COMPONENT ============

export default function EditProfileScreen() {
  const router = useRouter();
  const user = auth.currentUser;
  const cameraRef = useRef<CameraView>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const isWeb = Platform.OS === 'web';

  // Loading states
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deletingVideo, setDeletingVideo] = useState(false);
  const [gettingLocation, setGettingLocation] = useState(false);

  // Profile data
  const [userData, setUserData] = useState<UserData | null>(null);
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [age, setAge] = useState('');
  const [height, setHeight] = useState('');
  const [heightVerified, setHeightVerified] = useState(false);
  const [heightMethod, setHeightMethod] = useState('');
  const [bodyType, setBodyType] = useState('');
  const [lookingFor, setLookingFor] = useState('');
  const [religiousViews, setReligiousViews] = useState('');
  const [lifestyle, setLifestyle] = useState('');
  const [relationshipGoal, setRelationshipGoal] = useState('');
  const [bio, setBio] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [personalityType, setPersonalityType] = useState('');
  const [locationCity, setLocationCity] = useState('');

  // Verification
  const [selfieVerified, setSelfieVerified] = useState(false);
  const [ageVerified, setAgeVerified] = useState(false);

  // Video Profile
  const [videoProfile, setVideoProfile] = useState<string | null>(null);
  const [videoUploadedAt, setVideoUploadedAt] = useState<string | null>(null);
  const [playingVideo, setPlayingVideo] = useState(false);

  // expo-video player
  const videoPlayer = useVideoPlayer(videoProfile || '', (player) => {
    player.loop = false;
  });

  // Icebreaker
  const [icebreaker, setIcebreaker] = useState('');
  const [selectedPrompt, setSelectedPrompt] = useState('');
  const [showPromptPicker, setShowPromptPicker] = useState(false);

  // Photo reordering
  const [reorderMode, setReorderMode] = useState(false);
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState<number | null>(null);

  // Camera
  const [cameraOpen, setCameraOpen] = useState(false);
  const [webCameraReady, setWebCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [permission, requestPermission] = useCameraPermissions();

  // Report modal
  const [showReportModal, setShowReportModal] = useState(false);

  // ============ LOAD PROFILE ============

  useEffect(() => {
    loadProfile();
  }, []);

  const loadProfile = useCallback(async () => {
    if (!user) {
      setTimeout(() => router.replace('/login'), 100);
      return;
    }

    try {
      const userDoc = await getDoc(doc(db, 'users', user.uid));

      if (!userDoc.exists()) {
        setTimeout(() => router.replace('/profile-setup'), 100);
        return;
      }

      const data = userDoc.data() as UserData;
      setUserData(data);

      setName(data.name || '');
      setAge(data.age?.toString() || '');

      if (typeof data.height === 'object' && data.height !== null) {
        setHeight(data.height.value?.toString() || '');
        setHeightMethod(data.height.verificationMethod || '');
        setHeightVerified(data.height.verificationMethod === 'manual-measured');
      } else {
        setHeight(data.height?.toString() || '');
      }

      setBodyType(data.bodyType || '');
      setLookingFor(data.lookingFor || '');
      setReligiousViews(data.religiousViews || '');
      setLifestyle(data.lifestyle || '');
      setRelationshipGoal(data.relationshipGoal || '');
      setBio(data.bio || '');
      setPhotos(data.photos || []);
      setPersonalityType(data.personalityType || '');
      setIcebreaker(data.icebreaker || '');
      setSelectedPrompt(data.icebreakerPrompt || '');
      setVideoProfile(data.videoProfile || null);
      setVideoUploadedAt(data.videoProfileUploadedAt || null);

      if (data.location?.city) {
        setLocationCity(`${data.location.city}, ${data.location.country || ''}`);
      }

      setSelfieVerified(data.selfieVerified || false);
      setAgeVerified(data.ageVerification?.verified || false);
    } catch (error) {
      console.error('Error loading profile:', error);
      Alert.alert('Error', 'Error loading profile');
    } finally {
      setLoading(false);
    }
  }, [user, router]);

  // ============ VIDEO HANDLERS ============

  const handleDeleteVideo = useCallback(() => {
    Alert.alert(
      'Delete Video',
      'Delete your video profile?\n\nYou can record a new one anytime.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setDeletingVideo(true);
            const result = await deleteVideoProfile();
            setDeletingVideo(false);

            if (result.success) {
              setVideoProfile(null);
              setVideoUploadedAt(null);
              Alert.alert('Success', 'Video deleted successfully');
            } else {
              Alert.alert('Error', 'Failed to delete video: ' + result.error);
            }
          },
        },
      ]
    );
  }, []);

  const handleToggleVideo = useCallback(() => {
    if (playingVideo) {
      videoPlayer.pause();
      setPlayingVideo(false);
    } else {
      videoPlayer.replay();
      setPlayingVideo(true);
    }
  }, [playingVideo, videoPlayer]);

  // Listen for video end
  useEffect(() => {
    if (!playingVideo) return;
    const checkInterval = setInterval(() => {
      try {
        if (!videoPlayer.playing) setPlayingVideo(false);
      } catch {}
    }, 1000);
    return () => clearInterval(checkInterval);
  }, [playingVideo, videoPlayer]);

  // ============ PHOTO HANDLERS ============

  const handlePhotoTap = useCallback(
    (index: number) => {
      if (!reorderMode) return;

      if (selectedPhotoIndex === null) {
        setSelectedPhotoIndex(index);
      } else {
        const newPhotos = [...photos];
        const temp = newPhotos[selectedPhotoIndex];
        newPhotos[selectedPhotoIndex] = newPhotos[index];
        newPhotos[index] = temp;
        setPhotos(newPhotos);
        setSelectedPhotoIndex(null);
      }
    },
    [reorderMode, selectedPhotoIndex, photos]
  );

  const movePhotoLeft = useCallback(
    (index: number) => {
      if (index === 0) return;
      const newPhotos = [...photos];
      [newPhotos[index - 1], newPhotos[index]] = [newPhotos[index], newPhotos[index - 1]];
      setPhotos(newPhotos);
    },
    [photos]
  );

  const movePhotoRight = useCallback(
    (index: number) => {
      if (index === photos.length - 1) return;
      const newPhotos = [...photos];
      [newPhotos[index + 1], newPhotos[index]] = [newPhotos[index], newPhotos[index + 1]];
      setPhotos(newPhotos);
    },
    [photos]
  );

  const removePhoto = useCallback(
    (index: number) => {
      if (photos.length <= 1) {
        Alert.alert('Error', 'You must have at least 1 photo');
        return;
      }
      setPhotos(photos.filter((_, i) => i !== index));
      setSelectedPhotoIndex(null);
    },
    [photos]
  );

  // ============ CAMERA HANDLERS ============

  const stopWebCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setWebCameraReady(false);
  }, []);

  const startWebCamera = useCallback(async () => {
    try {
      setCameraError(null);
      setWebCameraReady(false);

      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError('Camera not supported');
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });

      streamRef.current = stream;

      setTimeout(() => {
        const video = document.getElementById('edit-profile-camera') as HTMLVideoElement;
        if (video) {
          video.srcObject = stream;
          video.onloadedmetadata = () => {
            video.play();
            setWebCameraReady(true);
          };
        }
      }, 100);
    } catch (err: any) {
      setCameraError(err.name === 'NotAllowedError' ? 'Camera blocked' : 'Camera error');
    }
  }, []);

  const closeCamera = useCallback(() => {
    stopWebCamera();
    setCameraOpen(false);
    setCameraError(null);
  }, [stopWebCamera]);

  const openCamera = useCallback(async () => {
    if (photos.length >= MAX_PHOTOS) {
      Alert.alert('Limit Reached', `Maximum ${MAX_PHOTOS} photos`);
      return;
    }

    if (!isWeb) {
      if (!permission?.granted) {
        const res = await requestPermission();
        if (!res.granted) {
          Alert.alert('Permission Required', 'Camera permission required');
          return;
        }
      }
    }

    setCameraOpen(true);
    if (isWeb) setTimeout(() => startWebCamera(), 200);
  }, [photos.length, isWeb, permission, requestPermission, startWebCamera]);

  const uploadAndVerifyPhoto = useCallback(
    async (photoUri: string): Promise<string | null> => {
      try {
        const response = await fetch(photoUri);
        const blob = await response.blob();

        const formData = new FormData();
        formData.append('file', blob as any);
        formData.append('upload_preset', CLOUDINARY_CONFIG.uploadPreset);
        formData.append('cloud_name', CLOUDINARY_CONFIG.cloudName);

        const uploadResponse = await fetch(
          `https://api.cloudinary.com/v1_1/${CLOUDINARY_CONFIG.cloudName}/image/upload`,
          { method: 'POST', body: formData }
        );

        const uploadData = await uploadResponse.json();

        if (!uploadData.secure_url) {
          Alert.alert('Error', 'Upload failed');
          return null;
        }

        // NSFW check
        try {
          const checkResponse = await fetch('https://api.deepai.org/api/nsfw-detector', {
            method: 'POST',
            headers: {
              'api-key': 'quickstart-QUdJIGlzIGNvbWluZy4uLi4K',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ image: uploadData.secure_url }),
          });
          const checkData = await checkResponse.json();
          if (checkData.output && checkData.output.nsfw_score > 0.6) {
            Alert.alert('Error', 'Inappropriate content detected.');
            return null;
          }
        } catch {
          console.warn('AI verification unavailable');
        }

        await updateDoc(doc(db, 'users', user!.uid), {
          lastPhotoUpdate: new Date().toISOString(),
        });

        return uploadData.secure_url;
      } catch (error) {
        console.error('Error uploading:', error);
        Alert.alert('Error', 'Error uploading photo');
        return null;
      }
    },
    [user]
  );

  const capturePhoto = useCallback(async () => {
    try {
      let uri: string | null = null;

      if (isWeb) {
        if (!webCameraReady) return;
        const video = document.getElementById('edit-profile-camera') as HTMLVideoElement;
        if (!video || video.readyState < 2) return;

        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth || 640;
        canvas.height = video.videoHeight || 480;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.save();
        ctx.scale(-1, 1);
        ctx.drawImage(video, -canvas.width, 0, canvas.width, canvas.height);
        ctx.restore();

        uri = canvas.toDataURL('image/jpeg', 0.85);
      } else {
        if (!cameraRef.current) return;
        const photo = await cameraRef.current.takePictureAsync({ quality: 0.85 });
        uri = photo?.uri || null;
      }

      if (!uri) {
        Alert.alert('Error', 'Failed to capture');
        return;
      }

      closeCamera();
      setUploadingPhoto(true);
      const uploadedUrl = await uploadAndVerifyPhoto(uri);
      setUploadingPhoto(false);

      if (uploadedUrl) {
        setPhotos((prev) => [...prev, uploadedUrl]);
      }
    } catch (e) {
      console.error('Capture error:', e);
      Alert.alert('Error', 'Error capturing photo');
    }
  }, [isWeb, webCameraReady, closeCamera, uploadAndVerifyPhoto]);

  // ============ LOCATION HANDLER ============

  const handleGetLocation = useCallback(async () => {
    setGettingLocation(true);
    const location = await requestLocationPermission();

    if (location) {
      const cityText = location.city ? `${location.city}, ${location.country}` : 'Location found';
      setLocationCity(cityText);
      await saveUserLocation(location);
      Alert.alert('Success', 'Location updated!');
    } else {
      Alert.alert('Error', 'Could not get location.');
    }
    setGettingLocation(false);
  }, []);

  // ============ NAME HANDLER ============

  const handleNameChange = useCallback((text: string) => {
    const cleaned = text.replace(/[^a-zA-Z\s\-']/g, '');
    setName(cleaned);

    if (cleaned.length > 0) {
      const result = validateName(cleaned);
      setNameError(result.valid ? null : (result.reason || null));
    } else {
      setNameError(null);
    }
  }, []);

  const handleNameBlur = useCallback(() => {
    if (name) setName(formatName(name));
  }, [name]);

  // ============ SAVE HANDLER ============

  const handleSave = useCallback(async () => {
    const nameValidation = validateName(name);
    if (!nameValidation.valid) {
      Alert.alert('Invalid Name', nameValidation.reason || 'Invalid name');
      return;
    }

    if (!name || !age || !height || !bodyType || !lookingFor) {
      Alert.alert('Missing Fields', 'Please fill all required fields');
      return;
    }

    if (photos.length === 0) {
      Alert.alert('No Photos', 'Please add at least 1 photo');
      return;
    }

    if (!user) return;

    setSaving(true);

    try {
      const updateData: Record<string, any> = {
        name: formatName(name),
        age: parseInt(age),
        bodyType,
        lookingFor,
        religiousViews,
        lifestyle,
        relationshipGoal,
        bio,
        photos,
        icebreaker,
        icebreakerPrompt: selectedPrompt,
        updatedAt: new Date().toISOString(),
      };

      if (!heightVerified) {
        updateData.height = {
          value: parseInt(height),
          verificationMethod: 'self-reported',
          verifiedAt: new Date().toISOString(),
        };
      }

      await updateDoc(doc(db, 'users', user.uid), updateData);
      Alert.alert('Success', 'Profile updated successfully!');
      router.back();
    } catch (error: any) {
      console.error('Error saving:', error);
      Alert.alert('Error', 'Error: ' + error.message);
    } finally {
      setSaving(false);
    }
  }, [name, age, height, bodyType, lookingFor, religiousViews, lifestyle, relationshipGoal, bio, photos, icebreaker, selectedPrompt, heightVerified, user, router]);

  // ============ DELETE ACCOUNT ============

  const handleDeleteAccount = useCallback(() => {
    if (!user) return;

    Alert.alert(
      '⚠️ DELETE ACCOUNT',
      'This will permanently delete your profile, photos, matches, conversations, ratings, and verification status.\n\nThis action CANNOT be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Account',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              '🚨 FINAL WARNING',
              'You are about to permanently delete your account.\n\nAre you absolutely sure?',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Yes, Delete Everything',
                  style: 'destructive',
                  onPress: async () => {
                    setDeleting(true);
                    try {
                      // Delete likes
                      const likesSnapshot = await getDocs(collection(db, 'likes'));
                      for (const likeDoc of likesSnapshot.docs) {
                        const d = likeDoc.data();
                        if (d.fromUserId === user.uid || d.toUserId === user.uid) {
                          await deleteDoc(doc(db, 'likes', likeDoc.id));
                        }
                      }

                      // Delete chats/messages
                      const chatsSnapshot = await getDocs(collection(db, 'chats'));
                      for (const chatDoc of chatsSnapshot.docs) {
                        if (chatDoc.id.includes(user.uid)) {
                          const messagesSnapshot = await getDocs(collection(db, 'chats', chatDoc.id, 'messages'));
                          for (const msgDoc of messagesSnapshot.docs) {
                            await deleteDoc(doc(db, 'chats', chatDoc.id, 'messages', msgDoc.id));
                          }
                        }
                      }

                      // Delete ratings
                      const ratingsSnapshot = await getDocs(collection(db, 'ratings'));
                      for (const ratingDoc of ratingsSnapshot.docs) {
                        const d = ratingDoc.data();
                        if (d.raterId === user.uid || d.ratedUserId === user.uid) {
                          await deleteDoc(doc(db, 'ratings', ratingDoc.id));
                        }
                      }

                      // Delete reports
                      const reportsSnapshot = await getDocs(collection(db, 'reports'));
                      for (const reportDoc of reportsSnapshot.docs) {
                        const d = reportDoc.data();
                        if (d.reporterId === user.uid || d.reportedUserId === user.uid) {
                          await deleteDoc(doc(db, 'reports', reportDoc.id));
                        }
                      }

                      // Delete blocked users
                      const blockedSnapshot = await getDocs(collection(db, 'blockedUsers'));
                      for (const blockedDoc of blockedSnapshot.docs) {
                        if (blockedDoc.id.includes(user.uid)) {
                          await deleteDoc(doc(db, 'blockedUsers', blockedDoc.id));
                        }
                      }

                      // Delete user document
                      await deleteDoc(doc(db, 'users', user.uid));

                      // Delete Firebase Auth account
                      await deleteUser(user);

                      Alert.alert('Deleted', 'Your account has been deleted. Goodbye! 👋');
                      router.replace('/');
                    } catch (error: any) {
                      console.error('Error deleting account:', error);
                      if (error.code === 'auth/requires-recent-login') {
                        Alert.alert('Security', 'Please log out and log back in, then try deleting again.');
                      } else {
                        Alert.alert('Error', 'Error deleting account: ' + error.message);
                      }
                    } finally {
                      setDeleting(false);
                    }
                  },
                },
              ]
            );
          },
        },
      ]
    );
  }, [user, router]);

  // ============ COMPUTED VALUES ============

  const verificationStatus = useMemo(() => {
    if (selfieVerified && (userData?.ratings?.trustScore ?? 0) >= 75) {
      return { level: 'Trusted', color: '#f1c40f' };
    }
    if (selfieVerified) {
      return { level: 'Verified', color: '#3498db' };
    }
    return { level: 'Basic', color: '#888' };
  }, [selfieVerified, userData?.ratings?.trustScore]);

  const videoAgeText = useMemo(() => getVideoAge(videoUploadedAt), [videoUploadedAt]);
  const videoIsOld = useMemo(() => isVideoOld(videoUploadedAt), [videoUploadedAt]);
  const heightBadgeText = useMemo(() => getHeightBadgeText(heightMethod), [heightMethod]);

  // ============ LOADING STATE ============

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#53a8b6" />
        <Text style={styles.loadingText}>Loading profile...</Text>
      </View>
    );
  }

    // ============ MAIN RENDER ============

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Edit Profile</Text>

      {/* VERIFICATION CARD */}
      <View style={styles.verificationCard}>
        <Text style={styles.verificationTitle}>Verification Status</Text>

        <View style={[styles.verificationBadge, { backgroundColor: verificationStatus.color }]}>
          <Text style={styles.verificationBadgeText}>{verificationStatus.level}</Text>
        </View>

        <View style={styles.verificationItems}>
          <View style={styles.verificationItem}>
            <Text style={styles.verificationItemIcon}>{selfieVerified ? '✓' : '○'}</Text>
            <Text style={[styles.verificationItemText, selfieVerified && styles.verificationItemDone]}>
              Identity Verified
            </Text>
          </View>
          <View style={styles.verificationItem}>
            <Text style={styles.verificationItemIcon}>{heightVerified ? '✓' : '○'}</Text>
            <Text style={[styles.verificationItemText, heightVerified && styles.verificationItemDone]}>
              Height Verified
            </Text>
          </View>
          <View style={styles.verificationItem}>
            <Text style={styles.verificationItemIcon}>{ageVerified ? '✓' : '○'}</Text>
            <Text style={[styles.verificationItemText, ageVerified && styles.verificationItemDone]}>
              Age Verified
            </Text>
          </View>
        </View>

        {/* TRUST SCORE DISPLAY */}
        <View style={styles.trustScoreSection}>
          <TrustScoreDisplay
            ratings={userData?.ratings}
            selfieVerified={selfieVerified}
            ageVerified={ageVerified}
            heightVerified={heightVerified}
            size="large"
          />
        </View>

        {!selfieVerified ? (
          <TouchableOpacity
            style={styles.verifySelfieButton}
            onPress={() => router.push('/selfie-verification')}
            disabled={saving}
          >
            <Text style={styles.verifySelfieButtonText}>Verify Your Identity</Text>
          </TouchableOpacity>
        ) : (
          <Text style={styles.verifiedNote}>Your identity has been verified ✓</Text>
        )}
      </View>

      {/* PROFILE PREVIEW BUTTON */}
      <TouchableOpacity
        style={styles.previewButton}
        onPress={() => router.push({ pathname: '/profile-preview', params: { userId: user!.uid } })}
        disabled={saving}
      >
        <Text style={styles.previewButtonIcon}>👁️</Text>
        <View style={styles.previewButtonTextContainer}>
          <Text style={styles.previewButtonText}>Preview Your Profile</Text>
          <Text style={styles.previewButtonSubtext}>See how others see you</Text>
        </View>
        <Text style={styles.previewButtonArrow}>→</Text>
      </TouchableOpacity>

      {/* SOCIAL MEDIA VERIFICATION */}
      <TouchableOpacity
        style={styles.socialButton}
        onPress={() => router.push('/social-verification')}
        disabled={saving}
      >
        <Text style={styles.socialButtonText}>🔗 Link Social Media</Text>
      </TouchableOpacity>

      {/* PHOTOS SECTION WITH REORDERING */}
      <Text style={styles.sectionTitle}>📷 Photos</Text>
      <Text style={styles.hint}>CAMERA ONLY - Tap to select, then tap another to swap positions.</Text>

      <View style={styles.photoControlsRow}>
        <TouchableOpacity
          style={[styles.reorderButton, reorderMode && styles.reorderButtonActive]}
          onPress={() => {
            setReorderMode(!reorderMode);
            setSelectedPhotoIndex(null);
          }}
        >
          <Text style={[styles.reorderButtonText, reorderMode && styles.reorderButtonTextActive]}>
            {reorderMode ? '✓ Done Reordering' : '↔️ Reorder Photos'}
          </Text>
        </TouchableOpacity>
      </View>

      {uploadingPhoto && (
        <View style={styles.uploadingContainer}>
          <ActivityIndicator size="small" color="#53a8b6" />
          <Text style={styles.uploadingText}>Uploading...</Text>
        </View>
      )}

      <View style={styles.photosContainer}>
        {photos.map((uri, index) => (
          <View key={`photo-${index}`} style={styles.photoWrapper}>
            <TouchableOpacity
              onPress={() => handlePhotoTap(index)}
              style={[
                styles.photoTouchable,
                reorderMode && styles.photoReorderMode,
                selectedPhotoIndex === index && styles.photoSelected,
              ]}
            >
              <Image source={{ uri }} style={styles.photo} />
              {index === 0 && (
                <View style={styles.primaryBadge}>
                  <Text style={styles.primaryBadgeText}>Main</Text>
                </View>
              )}
              {reorderMode && (
                <View style={styles.photoIndexBadge}>
                  <Text style={styles.photoIndexText}>{index + 1}</Text>
                </View>
              )}
            </TouchableOpacity>

            {reorderMode && (
              <View style={styles.reorderArrows}>
                {index > 0 && (
                  <TouchableOpacity style={styles.arrowButton} onPress={() => movePhotoLeft(index)}>
                    <Text style={styles.arrowText}>←</Text>
                  </TouchableOpacity>
                )}
                {index < photos.length - 1 && (
                  <TouchableOpacity style={styles.arrowButton} onPress={() => movePhotoRight(index)}>
                    <Text style={styles.arrowText}>→</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            {!reorderMode && (
              <TouchableOpacity
                style={styles.removeButton}
                onPress={() => removePhoto(index)}
                disabled={saving || uploadingPhoto}
              >
                <Text style={styles.removeButtonText}>✕</Text>
              </TouchableOpacity>
            )}
          </View>
        ))}

        {photos.length < MAX_PHOTOS && !reorderMode && (
          <TouchableOpacity
            style={styles.addPhotoButton}
            onPress={openCamera}
            disabled={saving || uploadingPhoto}
          >
            <Text style={styles.addPhotoIcon}>📷</Text>
            <Text style={styles.addPhotoText}>Add Photo</Text>
          </TouchableOpacity>
        )}
      </View>

      {reorderMode && (
        <Text style={styles.reorderHint}>
          Tap a photo to select it, then tap another to swap. First photo is your main profile photo.
        </Text>
      )}

      {/* VIDEO PROFILE SECTION */}
      <Text style={styles.sectionTitle}>🎥 Video Profile</Text>
      <Text style={styles.hint}>
        Add a 15-second video introduction. This helps matches get to know the real you!
      </Text>

      {videoProfile ? (
        <View style={styles.videoContainer}>
          <View style={styles.videoHeader}>
            <Text style={styles.videoLabel}>Your Video Profile</Text>
            {videoIsOld && (
              <View style={styles.videoOldBadge}>
                <Text style={styles.videoOldBadgeText}>⚠️ Outdated</Text>
              </View>
            )}
          </View>

          {/* Video Preview using expo-video */}
          <TouchableOpacity style={styles.videoPreview} onPress={handleToggleVideo}>
            {playingVideo ? (
              <VideoView
                player={videoPlayer}
                style={styles.videoPlayer}
                contentFit="contain"
                nativeControls
              />
            ) : (
              <View style={styles.videoThumbnail}>
                <Text style={styles.videoPlayIcon}>▶️</Text>
                <Text style={styles.videoTapText}>Tap to preview</Text>
              </View>
            )}
          </TouchableOpacity>

          <Text style={styles.videoDate}>Uploaded {videoAgeText}</Text>

          {videoIsOld && (
            <Text style={styles.videoOldWarning}>
              Your video is over 6 months old. Consider recording a new one!
            </Text>
          )}

          <View style={styles.videoButtons}>
            <TouchableOpacity
              style={styles.recordVideoButton}
              onPress={() => router.push('/video-profile-recorder')}
              disabled={saving || deletingVideo}
            >
              <Text style={styles.recordVideoText}>🔄 Re-record</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.deleteVideoButton}
              onPress={handleDeleteVideo}
              disabled={saving || deletingVideo}
            >
              {deletingVideo ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.deleteVideoText}>🗑️ Delete</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <TouchableOpacity
          style={styles.addVideoButton}
          onPress={() => router.push('/video-profile-recorder')}
          disabled={saving}
        >
          <Text style={styles.addVideoIcon}>🎬</Text>
          <Text style={styles.addVideoText}>Record Video Profile</Text>
          <Text style={styles.addVideoSubtext}>15 seconds to introduce yourself</Text>
        </TouchableOpacity>
      )}

      {/* ICEBREAKER SECTION */}
      <Text style={styles.sectionTitle}>💬 Icebreaker Prompt</Text>
      <Text style={styles.hint}>Add a fun prompt to help people start conversations with you!</Text>

      <TouchableOpacity style={styles.promptSelector} onPress={() => setShowPromptPicker(true)}>
        <Text style={styles.promptSelectorText}>{selectedPrompt || 'Choose a prompt...'}</Text>
        <Text style={styles.promptSelectorArrow}>▼</Text>
      </TouchableOpacity>

      {selectedPrompt && (
        <>
          <TextInput
            style={styles.icebreakerInput}
            placeholder="Your answer..."
            placeholderTextColor="#666"
            value={icebreaker}
            onChangeText={(text) => setIcebreaker(text.slice(0, MAX_ICEBREAKER_LENGTH))}
            multiline
            maxLength={MAX_ICEBREAKER_LENGTH}
          />
          <Text style={styles.charCount}>{icebreaker.length}/{MAX_ICEBREAKER_LENGTH}</Text>
        </>
      )}

      {/* Prompt Picker Modal */}
      <Modal visible={showPromptPicker} animationType="slide" transparent onRequestClose={() => setShowPromptPicker(false)}>
        <View style={styles.promptModalOverlay}>
          <View style={styles.promptModal}>
            <Text style={styles.promptModalTitle}>Choose a Prompt</Text>
            <ScrollView style={styles.promptList}>
              {ICEBREAKER_PROMPTS.map((prompt, index) => (
                <TouchableOpacity
                  key={index}
                  style={[styles.promptOption, selectedPrompt === prompt && styles.promptOptionActive]}
                  onPress={() => {
                    setSelectedPrompt(prompt);
                    setShowPromptPicker(false);
                  }}
                >
                  <Text style={[styles.promptOptionText, selectedPrompt === prompt && styles.promptOptionTextActive]}>
                    {prompt}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity style={styles.promptModalClose} onPress={() => setShowPromptPicker(false)}>
              <Text style={styles.promptModalCloseText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* BASIC INFO */}
      <Text style={styles.sectionTitle}>Basic Info</Text>

      <Text style={styles.label}>First Name</Text>
      <Text style={styles.hint}>Use your real first name</Text>
      <TextInput
        style={[styles.input, nameError && styles.inputError]}
        value={name}
        onChangeText={handleNameChange}
        onBlur={handleNameBlur}
        placeholder="Sarah"
        placeholderTextColor="#666"
        editable={!saving}
        maxLength={20}
      />
      {nameError && <Text style={styles.errorText}>{nameError}</Text>}

      <Text style={styles.label}>Age</Text>
      <TextInput
        style={styles.input}
        value={age}
        onChangeText={(text) => setAge(text.replace(/[^0-9]/g, ''))}
        placeholder="25"
        placeholderTextColor="#666"
        keyboardType="number-pad"
        maxLength={2}
        editable={!saving}
      />

      <Text style={styles.label}>Height (cm)</Text>
      <View style={styles.heightRow}>
        <TextInput
          style={[styles.input, styles.heightInput]}
          value={height}
          onChangeText={(text) => setHeight(text.replace(/[^0-9]/g, ''))}
          placeholder="170"
          placeholderTextColor="#666"
          keyboardType="number-pad"
          maxLength={3}
          editable={!saving && !heightVerified}
        />
        {heightMethod !== '' && (
          <View style={[styles.heightBadge, heightMethod === 'manual-measured' && styles.heightBadgeVerified]}>
            <Text style={styles.heightBadgeText}>{heightBadgeText}</Text>
          </View>
        )}
      </View>

      <TouchableOpacity
        style={styles.verifyHeightButton}
        onPress={() => router.push('/height-verification')}
        disabled={saving}
      >
        <Text style={styles.verifyHeightText}>
          {heightVerified ? '✓ Re-verify Height' : '📏 Verify Height'}
        </Text>
      </TouchableOpacity>

      <BodyTypeSelector label="Your Body Type" selectedType={bodyType} onSelect={setBodyType} disabled={saving} />
      <BodyTypeSelector label="Body Type Preference" selectedType={lookingFor} onSelect={setLookingFor} disabled={saving} showLookingFor={true} />

      {/* BELIEFS AND VALUES */}
      <Text style={styles.sectionTitle}>Beliefs and Values</Text>

      <Text style={styles.label}>Religious Views</Text>
      <View style={styles.optionsColumn}>
        {RELIGIOUS_OPTIONS.map((opt) => (
          <TouchableOpacity
            key={opt.value}
            style={[styles.optionRow, religiousViews === opt.value && styles.optionRowActive]}
            onPress={() => setReligiousViews(opt.value)}
            disabled={saving}
          >
            <Text style={[styles.optionRowText, religiousViews === opt.value && styles.optionRowTextActive]}>
              {opt.value}
            </Text>
            <Text style={styles.optionRowDesc}>{opt.desc}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>Lifestyle</Text>
      <View style={styles.optionsColumn}>
        {LIFESTYLE_OPTIONS.map((opt) => (
          <TouchableOpacity
            key={opt.value}
            style={[styles.optionRow, lifestyle === opt.value && styles.optionRowActive]}
            onPress={() => setLifestyle(opt.value)}
            disabled={saving}
          >
            <Text style={[styles.optionRowText, lifestyle === opt.value && styles.optionRowTextActive]}>
              {opt.value}
            </Text>
            <Text style={styles.optionRowDesc}>{opt.desc}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>Relationship Goal</Text>
      <View style={styles.optionsColumn}>
        {RELATIONSHIP_OPTIONS.map((opt) => (
          <TouchableOpacity
            key={opt.value}
            style={[styles.optionRow, relationshipGoal === opt.value && styles.optionRowActive]}
            onPress={() => setRelationshipGoal(opt.value)}
            disabled={saving}
          >
            <Text style={[styles.optionRowText, relationshipGoal === opt.value && styles.optionRowTextActive]}>
              {opt.value}
            </Text>
            <Text style={styles.optionRowDesc}>{opt.desc}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* LOCATION */}
      <Text style={styles.sectionTitle}>Location</Text>
      <TouchableOpacity
        style={styles.locationButton}
        onPress={handleGetLocation}
        disabled={gettingLocation || saving}
      >
        {gettingLocation ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Text style={styles.locationButtonText}>
            {locationCity ? `📍 ${locationCity}` : '📍 Update Location'}
          </Text>
        )}
      </TouchableOpacity>

      {/* ABOUT ME */}
      <Text style={styles.sectionTitle}>About Me</Text>
      <TextInput
        style={styles.bioInput}
        placeholder="Tell people about yourself..."
        placeholderTextColor="#666"
        value={bio}
        onChangeText={(text) => setBio(text.slice(0, MAX_BIO_LENGTH))}
        multiline
        numberOfLines={4}
        maxLength={MAX_BIO_LENGTH}
        editable={!saving}
      />
      <Text style={styles.charCount}>{bio.length}/{MAX_BIO_LENGTH}</Text>

      {/* PERSONALITY */}
      <Text style={styles.sectionTitle}>Personality</Text>
      <View style={styles.personalityRow}>
        <Text style={styles.personalityLabel}>
          {'Current Type: '}
          <Text style={styles.personalityValue}>{personalityType || 'Not taken'}</Text>
        </Text>
        <TouchableOpacity
          style={styles.retakeButton}
          onPress={() => router.push('/personality-quiz')}
          disabled={saving}
        >
          <Text style={styles.retakeText}>Retake Quiz</Text>
        </TouchableOpacity>
      </View>

      {/* SAVE / CANCEL */}
      <TouchableOpacity
        style={[styles.saveButton, saving && styles.saveButtonDisabled]}
        onPress={handleSave}
        disabled={saving || uploadingPhoto}
      >
        <Text style={styles.saveButtonText}>{saving ? 'Saving...' : '✓ Save Changes'}</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.cancelButton} onPress={() => router.back()} disabled={saving}>
        <Text style={styles.cancelButtonText}>Cancel</Text>
      </TouchableOpacity>

      {/* LEGAL LINKS */}
      <View style={styles.legalSection}>
        <TouchableOpacity onPress={() => router.push('/privacy')}>
          <Text style={styles.legalLink}>Privacy Policy</Text>
        </TouchableOpacity>
        <Text style={styles.legalDivider}>•</Text>
        <TouchableOpacity onPress={() => router.push('/terms')}>
          <Text style={styles.legalLink}>Terms of Service</Text>
        </TouchableOpacity>
      </View>

      {/* DELETE ACCOUNT - DANGER ZONE */}
      <View style={styles.dangerZone}>
        <Text style={styles.dangerZoneTitle}>⚠️ Danger Zone</Text>
        <Text style={styles.dangerZoneText}>
          Permanently delete your account and all data. This action cannot be undone.
        </Text>
        <TouchableOpacity
          style={[styles.deleteAccountButton, deleting && styles.deleteAccountButtonDisabled]}
          onPress={handleDeleteAccount}
          disabled={deleting || saving}
        >
          <Text style={styles.deleteAccountButtonText}>
            {deleting ? 'Deleting...' : '🗑️ Delete My Account'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Camera Modal */}
      <Modal visible={cameraOpen} animationType="slide" onRequestClose={closeCamera}>
        <View style={styles.cameraModal}>
          <Text style={styles.cameraTitle}>Take Photo</Text>

          {isWeb ? (
            <View style={styles.camBox}>
              {cameraError ? (
                <View style={styles.camErrorBox}>
                  <Text style={styles.camErrorText}>{cameraError}</Text>
                  <TouchableOpacity style={styles.retryBtn} onPress={startWebCamera}>
                    <Text style={styles.retryBtnText}>Retry</Text>
                  </TouchableOpacity>
                </View>
              ) : !webCameraReady ? (
                <View style={styles.loadingBox}>
                  <ActivityIndicator size="large" color="#53a8b6" />
                  <Text style={styles.loadingTextCam}>Starting camera...</Text>
                </View>
              ) : null}

              <View style={webCameraReady ? styles.videoBox : styles.hidden}>
                {isWeb && (
                  <video
                    id="edit-profile-camera"
                    autoPlay
                    playsInline
                    muted
                    style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' } as any}
                  />
                )}
              </View>
            </View>
          ) : (
            <View style={styles.camBox}>
              <CameraView ref={cameraRef} style={styles.nativeCam} facing="front" />
            </View>
          )}

          <View style={styles.cameraControls}>
            <TouchableOpacity
              style={[styles.captureBtn, isWeb && !webCameraReady && styles.disabled]}
              onPress={capturePhoto}
              disabled={isWeb && !webCameraReady}
            >
              <View style={styles.captureBtnInner} />
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={styles.closeCamBtn} onPress={closeCamera}>
            <Text style={styles.closeCamBtnText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </ScrollView>
  );
}

// ============ STYLES ============
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  content: { padding: 20, paddingBottom: 50 },
  loadingContainer: { flex: 1, backgroundColor: '#1a1a2e', justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: '#aaa', marginTop: 15, fontSize: 16 },
  title: { fontSize: 28, fontWeight: 'bold', color: '#eee', marginTop: 20, marginBottom: 20, textAlign: 'center' },

  // Verification Card
  verificationCard: { backgroundColor: '#16213e', borderRadius: 15, padding: 20, marginBottom: 25, borderWidth: 1, borderColor: '#0f3460' },
  verificationTitle: { fontSize: 16, fontWeight: '600', color: '#eee', marginBottom: 15, textAlign: 'center' },
  verificationBadge: { alignSelf: 'center', paddingVertical: 6, paddingHorizontal: 20, borderRadius: 15, marginBottom: 15 },
  verificationBadgeText: { color: '#fff', fontSize: 14, fontWeight: 'bold' },
  verificationItems: { marginBottom: 15 },
  verificationItem: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  verificationItemIcon: { fontSize: 16, color: '#53a8b6', marginRight: 10, width: 20, textAlign: 'center' },
  verificationItemText: { color: '#888', fontSize: 14 },
  verificationItemDone: { color: '#5cb85c' },
  trustScoreSection: { marginTop: 15, marginBottom: 15, paddingTop: 15, borderTopWidth: 1, borderTopColor: '#0f3460' },
  verifySelfieButton: { backgroundColor: '#3498db', paddingVertical: 12, borderRadius: 20, alignItems: 'center' },
  verifySelfieButtonText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  verifiedNote: { color: '#5cb85c', fontSize: 13, textAlign: 'center', fontStyle: 'italic' },

  // Preview Button
  previewButton: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#16213e', borderRadius: 15, padding: 16, marginBottom: 20, borderWidth: 2, borderColor: '#9b59b6' },
  previewButtonIcon: { fontSize: 28, marginRight: 12 },
  previewButtonTextContainer: { flex: 1 },
  previewButtonText: { color: '#9b59b6', fontSize: 16, fontWeight: 'bold', marginBottom: 2 },
  previewButtonSubtext: { color: '#888', fontSize: 12 },
  previewButtonArrow: { color: '#9b59b6', fontSize: 20, fontWeight: 'bold' },

  // Social Button
  socialButton: { backgroundColor: '#0f3460', paddingVertical: 15, borderRadius: 12, alignItems: 'center', marginBottom: 15, flexDirection: 'row', justifyContent: 'center', gap: 10 },
  socialButtonText: { color: '#53a8b6', fontSize: 16, fontWeight: '600' },

  // Section
  sectionTitle: { fontSize: 18, fontWeight: 'bold', color: '#53a8b6', marginTop: 25, marginBottom: 10 },
  hint: { fontSize: 12, color: '#888', marginBottom: 8, fontStyle: 'italic' },
  label: { fontSize: 14, color: '#ccc', marginBottom: 8, marginTop: 12 },
  input: { backgroundColor: '#16213e', color: '#fff', padding: 15, borderRadius: 10, fontSize: 16 },
  inputError: { borderWidth: 1, borderColor: '#d9534f' },
  errorText: { color: '#d9534f', fontSize: 12, marginTop: 5 },

  // Photos
  photoControlsRow: { flexDirection: 'row', marginBottom: 10 },
  reorderButton: { backgroundColor: '#0f3460', paddingVertical: 10, paddingHorizontal: 15, borderRadius: 20 },
  reorderButtonActive: { backgroundColor: '#5cb85c' },
  reorderButtonText: { color: '#53a8b6', fontSize: 13, fontWeight: '600' },
  reorderButtonTextActive: { color: '#fff' },
  uploadingContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#16213e', padding: 12, borderRadius: 10, marginBottom: 10 },
  uploadingText: { color: '#53a8b6', marginLeft: 10, fontSize: 14 },
  photosContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  photoWrapper: { position: 'relative' },
  photoTouchable: { borderRadius: 10, overflow: 'hidden' },
  photoReorderMode: { borderWidth: 2, borderColor: '#53a8b6', borderStyle: 'dashed' },
  photoSelected: { borderColor: '#5cb85c', borderStyle: 'solid', borderWidth: 3 },
  photo: { width: 100, height: 130, borderRadius: 10 },
  primaryBadge: { position: 'absolute', bottom: 5, left: 5, backgroundColor: '#5cb85c', paddingVertical: 2, paddingHorizontal: 6, borderRadius: 8 },
  primaryBadgeText: { color: '#fff', fontSize: 10, fontWeight: 'bold' },
  photoIndexBadge: { position: 'absolute', top: 5, left: 5, backgroundColor: '#53a8b6', width: 24, height: 24, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  photoIndexText: { color: '#fff', fontSize: 12, fontWeight: 'bold' },
  reorderArrows: { flexDirection: 'row', justifyContent: 'center', gap: 5, marginTop: 5 },
  arrowButton: { backgroundColor: '#0f3460', paddingVertical: 5, paddingHorizontal: 10, borderRadius: 10 },
  arrowText: { color: '#53a8b6', fontSize: 16, fontWeight: 'bold' },
  reorderHint: { color: '#888', fontSize: 12, marginTop: 10, fontStyle: 'italic', textAlign: 'center' },
  removeButton: { position: 'absolute', top: -8, right: -8, backgroundColor: '#d9534f', borderRadius: 15, width: 26, height: 26, justifyContent: 'center', alignItems: 'center' },
  removeButtonText: { color: '#fff', fontSize: 14, fontWeight: 'bold' },
  addPhotoButton: { width: 100, height: 130, borderRadius: 10, borderWidth: 2, borderColor: '#53a8b6', borderStyle: 'dashed', justifyContent: 'center', alignItems: 'center' },
  addPhotoIcon: { fontSize: 24, marginBottom: 5 },
  addPhotoText: { color: '#53a8b6', fontSize: 12 },

  // Video
  videoContainer: { backgroundColor: '#16213e', borderRadius: 15, padding: 15, marginBottom: 10 },
  videoHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  videoLabel: { color: '#53a8b6', fontSize: 14, fontWeight: '600' },
  videoOldBadge: { backgroundColor: '#e67e22', paddingVertical: 4, paddingHorizontal: 10, borderRadius: 10 },
  videoOldBadgeText: { color: '#fff', fontSize: 11, fontWeight: '600' },
  videoPreview: { backgroundColor: '#0f3460', borderRadius: 12, overflow: 'hidden', marginBottom: 10, minHeight: 200 },
  videoPlayer: { width: '100%', height: 200 },
  videoThumbnail: { height: 200, justifyContent: 'center', alignItems: 'center' },
  videoPlayIcon: { fontSize: 50, marginBottom: 10 },
  videoTapText: { color: '#888', fontSize: 14 },
  videoDate: { color: '#888', fontSize: 12, textAlign: 'center', marginBottom: 10 },
  videoOldWarning: { color: '#e67e22', fontSize: 12, textAlign: 'center', marginBottom: 12, fontStyle: 'italic' },
  videoButtons: { flexDirection: 'row', gap: 10 },
  recordVideoButton: { flex: 1, backgroundColor: '#e67e22', paddingVertical: 12, borderRadius: 20, alignItems: 'center' },
  recordVideoText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  deleteVideoButton: { backgroundColor: '#d9534f', paddingVertical: 12, paddingHorizontal: 20, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  deleteVideoText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  addVideoButton: { backgroundColor: '#16213e', borderRadius: 15, padding: 25, alignItems: 'center', borderWidth: 2, borderColor: '#e67e22', borderStyle: 'dashed' },
  addVideoIcon: { fontSize: 40, marginBottom: 10 },
  addVideoText: { color: '#e67e22', fontSize: 16, fontWeight: '600', marginBottom: 5 },
  addVideoSubtext: { color: '#888', fontSize: 12 },

  // Icebreaker
  promptSelector: { backgroundColor: '#16213e', padding: 15, borderRadius: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  promptSelectorText: { color: '#aaa', fontSize: 14, flex: 1 },
  promptSelectorArrow: { color: '#53a8b6', fontSize: 14 },
  icebreakerInput: { backgroundColor: '#16213e', color: '#fff', padding: 15, borderRadius: 10, fontSize: 16, height: 80, textAlignVertical: 'top' },
  promptModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'flex-end' },
  promptModal: { backgroundColor: '#1a1a2e', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: '70%' },
  promptModalTitle: { color: '#eee', fontSize: 18, fontWeight: 'bold', textAlign: 'center', marginBottom: 15 },
  promptList: { marginBottom: 15 },
  promptOption: { backgroundColor: '#16213e', padding: 15, borderRadius: 10, marginBottom: 10 },
  promptOptionActive: { backgroundColor: '#0f3460', borderWidth: 2, borderColor: '#53a8b6' },
  promptOptionText: { color: '#aaa', fontSize: 14 },
  promptOptionTextActive: { color: '#53a8b6', fontWeight: '600' },
  promptModalClose: { paddingVertical: 12, alignItems: 'center' },
  promptModalCloseText: { color: '#d9534f', fontSize: 16 },

  // Options
  optionsColumn: { gap: 10 },
  optionRow: { backgroundColor: '#16213e', padding: 15, borderRadius: 12, borderWidth: 2, borderColor: '#16213e' },
  optionRowActive: { backgroundColor: '#0f3460', borderColor: '#53a8b6' },
  optionRowText: { color: '#eee', fontSize: 16, fontWeight: '600', marginBottom: 4 },
  optionRowTextActive: { color: '#53a8b6' },
  optionRowDesc: { color: '#888', fontSize: 12 },

  // Height
  heightRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  heightInput: { flex: 1 },
  heightBadge: { backgroundColor: '#0f3460', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 15 },
  heightBadgeVerified: { backgroundColor: '#1a5c3a' },
  heightBadgeText: { color: '#5cb85c', fontSize: 12, fontWeight: '600' },
  verifyHeightButton: { backgroundColor: '#0f3460', paddingVertical: 12, paddingHorizontal: 20, borderRadius: 20, marginTop: 10, alignItems: 'center' },
  verifyHeightText: { color: '#53a8b6', fontSize: 14, fontWeight: '600' },

  // Location
  locationButton: { backgroundColor: '#0f3460', paddingVertical: 15, borderRadius: 10, alignItems: 'center' },
  locationButtonText: { color: '#53a8b6', fontSize: 16, fontWeight: '600' },

  // Bio
  bioInput: { backgroundColor: '#16213e', color: '#fff', padding: 15, borderRadius: 10, fontSize: 16, height: 100, textAlignVertical: 'top' },
  charCount: { color: '#666', fontSize: 12, textAlign: 'right', marginTop: 5 },

  // Personality
  personalityRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#16213e', padding: 15, borderRadius: 10 },
  personalityLabel: { color: '#aaa', fontSize: 14 },
  personalityValue: { color: '#e67e22', fontWeight: 'bold' },
  retakeButton: { backgroundColor: '#0f3460', paddingVertical: 8, paddingHorizontal: 15, borderRadius: 15 },
  retakeText: { color: '#53a8b6', fontSize: 13, fontWeight: '600' },

  // Save / Cancel
  saveButton: { backgroundColor: '#5cb85c', paddingVertical: 16, borderRadius: 25, marginTop: 30, alignItems: 'center' },
  saveButtonDisabled: { backgroundColor: '#555' },
  saveButtonText: { color: '#fff', fontSize: 18, fontWeight: '600' },
  cancelButton: { paddingVertical: 12, marginTop: 10, alignItems: 'center' },
  cancelButtonText: { color: '#d9534f', fontSize: 16 },

  // Legal
  legalSection: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 30, gap: 10 },
  legalLink: { color: '#53a8b6', fontSize: 14, textDecorationLine: 'underline' },
  legalDivider: { color: '#666', fontSize: 14 },

  // Danger Zone
  dangerZone: { marginTop: 40, padding: 20, backgroundColor: 'rgba(217, 83, 79, 0.1)', borderRadius: 15, borderWidth: 2, borderColor: '#d9534f' },
  dangerZoneTitle: { color: '#d9534f', fontSize: 18, fontWeight: 'bold', marginBottom: 8 },
  dangerZoneText: { color: '#888', fontSize: 13, marginBottom: 15, lineHeight: 20 },
  deleteAccountButton: { backgroundColor: '#d9534f', paddingVertical: 14, borderRadius: 20, alignItems: 'center' },
  deleteAccountButtonDisabled: { backgroundColor: '#555' },
  deleteAccountButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },

  // Camera Modal
  cameraModal: { flex: 1, backgroundColor: '#1a1a2e', justifyContent: 'center', alignItems: 'center', padding: 20 },
  cameraTitle: { fontSize: 22, fontWeight: 'bold', color: '#eee', marginBottom: 20 },
  camBox: { width: 300, height: 400, borderRadius: 20, overflow: 'hidden', backgroundColor: '#000', borderWidth: 3, borderColor: '#53a8b6', marginBottom: 20 },
  nativeCam: { width: '100%', height: '100%' },
  videoBox: { width: '100%', height: '100%' },
  hidden: { width: 0, height: 0, overflow: 'hidden' },
  camErrorBox: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  camErrorText: { color: '#ff6b6b', fontSize: 14, textAlign: 'center', marginBottom: 15 },
  loadingBox: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingTextCam: { color: '#888', marginTop: 10 },
  cameraControls: { alignItems: 'center', marginBottom: 20 },
  captureBtn: { width: 70, height: 70, borderRadius: 35, backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center', borderWidth: 4, borderColor: '#53a8b6' },
  captureBtnInner: { width: 54, height: 54, borderRadius: 27, backgroundColor: '#53a8b6' },
  disabled: { opacity: 0.5 },
  closeCamBtn: { padding: 12 },
  closeCamBtnText: { color: '#d9534f', fontSize: 16 },
  retryBtn: { backgroundColor: '#e67e22', paddingVertical: 12, paddingHorizontal: 30, borderRadius: 20 },
  retryBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
});