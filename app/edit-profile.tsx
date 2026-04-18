import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { doc, getDoc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import React, { useCallback, useEffect, useReducer, useRef } from 'react';
import {
  AccessibilityInfo, ActivityIndicator, Alert,
  Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView,
  StatusBar, Switch, Text, TextInput, View,
} from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import TurboImage from 'react-native-turbo-image';
import { StyleSheet } from 'react-native-unistyles';
import { auth, db, storage } from '../firebaseConfig';
import { checkImageSafety } from '../utils/contentSafety';
import { writeAuditLog } from '../utils/logger';
import { validateDisplayName } from '../utils/nameValidation';
import { checkPhotoUpload } from '../utils/safetyMiddleware';

const IS_IOS = Platform.OS === 'ios';
const IS_WEB = Platform.OS === 'web';
const MAX_BIO_LENGTH    = 300;
const MAX_JOB_LENGTH    = 60;
const MAX_SCHOOL_LENGTH = 60;
const MAX_NAME_LENGTH   = 50;

type ProfileState = {
  displayName: string;      nameError: string;
  bio: string;              bioError: string;
  job: string;              school: string;
  age: number;              gender: string;
  photos: string[];         primaryPhotoIndex: number;
  showOnProfile: boolean;   showAge: boolean;   showDistance: boolean;
  saving: boolean;
  uploadingPhoto: boolean;  photoToUpload: string | null;
  showDeleteConfirm: boolean; deletingPhotoIndex: number;
  showGenderPicker: boolean;
};

type ProfileAction =
  | { type: 'SET_NAME';          payload: string }
  | { type: 'SET_NAME_ERROR';    payload: string }
  | { type: 'SET_BIO';           payload: string }
  | { type: 'SET_BIO_ERROR';     payload: string }
  | { type: 'SET_JOB';           payload: string }
  | { type: 'SET_SCHOOL';        payload: string }
  | { type: 'SET_AGE';           payload: number }
  | { type: 'SET_GENDER';        payload: string }
  | { type: 'SET_PHOTOS';        payload: string[] }
  | { type: 'SET_PRIMARY';       payload: number }
  | { type: 'SET_SHOW_PROFILE';  payload: boolean }
  | { type: 'SET_SHOW_AGE';      payload: boolean }
  | { type: 'SET_SHOW_DISTANCE'; payload: boolean }
  | { type: 'SET_SAVING';        payload: boolean }
  | { type: 'SET_UPLOADING';     payload: boolean }
  | { type: 'SET_PHOTO_TO_UPLOAD'; payload: string | null }
  | { type: 'SET_DELETE_CONFIRM';  payload: boolean }
  | { type: 'SET_DELETING_INDEX';  payload: number }
  | { type: 'SET_GENDER_PICKER';   payload: boolean }
  | { type: 'HYDRATE'; payload: Partial<ProfileState> }
  | { type: 'RESET' };

const initialState: ProfileState = {
  displayName: '',  nameError: '',
  bio: '',          bioError: '',
  job: '',          school: '',
  age: 0,           gender: '',
  photos: [],       primaryPhotoIndex: 0,
  showOnProfile: true, showAge: true, showDistance: true,
  saving: false,
  uploadingPhoto: false, photoToUpload: null,
  showDeleteConfirm: false, deletingPhotoIndex: -1,
  showGenderPicker: false,
};

function profileReducer(state: ProfileState, action: ProfileAction): ProfileState {
  switch (action.type) {
    case 'SET_NAME':           return { ...state, displayName: action.payload };
    case 'SET_NAME_ERROR':     return { ...state, nameError: action.payload };
    case 'SET_BIO':            return { ...state, bio: action.payload };
    case 'SET_BIO_ERROR':      return { ...state, bioError: action.payload };
    case 'SET_JOB':            return { ...state, job: action.payload };
    case 'SET_SCHOOL':         return { ...state, school: action.payload };
    case 'SET_AGE':            return { ...state, age: action.payload };
    case 'SET_GENDER':         return { ...state, gender: action.payload };
    case 'SET_PHOTOS':         return { ...state, photos: action.payload };
    case 'SET_PRIMARY':        return { ...state, primaryPhotoIndex: action.payload };
    case 'SET_SHOW_PROFILE':   return { ...state, showOnProfile: action.payload };
    case 'SET_SHOW_AGE':       return { ...state, showAge: action.payload };
    case 'SET_SHOW_DISTANCE':  return { ...state, showDistance: action.payload };
    case 'SET_SAVING':         return { ...state, saving: action.payload };
    case 'SET_UPLOADING':      return { ...state, uploadingPhoto: action.payload };
    case 'SET_PHOTO_TO_UPLOAD':return { ...state, photoToUpload: action.payload };
    case 'SET_DELETE_CONFIRM': return { ...state, showDeleteConfirm: action.payload };
    case 'SET_DELETING_INDEX': return { ...state, deletingPhotoIndex: action.payload };
    case 'SET_GENDER_PICKER':  return { ...state, showGenderPicker: action.payload };
    case 'HYDRATE':            return { ...state, ...action.payload };
    case 'RESET':              return { ...initialState };
    default:                   return state;
  }
}

const GENDER_OPTIONS = ['Woman', 'Man', 'Non-binary', 'Prefer not to say'];

const profileQueryKeys = {
  profile: (uid: string) => ['profile', uid] as const,
};

export default function EditProfileScreen() {
  const router      = useRouter();
  const queryClient = useQueryClient();
  const user        = auth.currentUser;
  const [state, dispatch] = useReducer(profileReducer, initialState);
  const isMountedRef = useRef(true);
  const scrollRef    = useRef<ScrollView>(null);

  const opacity = useSharedValue(0);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  useEffect(() => {
    opacity.value = withTiming(1, {
      duration: 300,
      easing: Easing.out(Easing.ease),
    }, []);
    return () => {
      cancelAnimation(opacity);
    };
  }, [opacity]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  const { isLoading, data: profileData, isError } = useQuery({
    queryKey: profileQueryKeys.profile(user?.uid ?? ''),
    queryFn: async () => {
      if (!user?.uid) throw new Error('No user');
      const snap = await getDoc(doc(db, 'users', user.uid));
      if (!snap.exists()) return null;
      return snap.data();
    },
    enabled: !!user?.uid,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 30,
  });

  useEffect(() => {
    if (!profileData || !isMountedRef.current) return;
    const d = profileData;
    dispatch({
      type: 'HYDRATE',
      payload: {
        displayName:       d.displayName ?? d.name ?? '',
        bio:               d.bio         ?? '',
        job:               d.job         ?? '',
        school:            d.school      ?? '',
        age:               d.age         ?? 0,
        gender:            d.gender      ?? '',
        photos:            d.photos      ?? [],
        primaryPhotoIndex: d.primaryPhotoIndex ?? 0,
        showOnProfile:     d.showOnProfile  ?? true,
        showAge:           d.showAge        ?? true,
        showDistance:      d.showDistance   ?? true,
      },
    });
  }, [profileData]);

  useEffect(() => {
    if (isError) {
      Alert.alert('Error', 'Could not load profile data.');
    }
  }, [isError]);

  const uploadMutation = useMutation({
    mutationFn: async (uri: string) => {
      if (!user?.uid) throw new Error('No user');

      try {
        const safetyResult = await checkPhotoUpload(uri, uri, user.uid, 'profile', {
          serverUrl: '', enablePhotoCheck: true, enableMessageCheck: false,
          enableLoginCheck: false, enableRegistrationCheck: false,
          enableProfileCheck: true, autoBlockCritical: true, logAllChecks: false,
        });
        if (!safetyResult.allowed) {
          throw new Error(safetyResult.reasons.join('\n') || 'Image flagged');
        }
      } catch (safetyErr: unknown) {
        const msg = safetyErr instanceof Error ? safetyErr.message : '';
        if (msg && msg !== 'Image flagged') {
          const chk = await checkImageSafety(uri);
          if (!chk.safe) throw new Error(chk.reason);
        } else {
          throw safetyErr;
        }
      }

      const resp = await fetch(uri);
      const blob = await resp.blob();
      const fileRef = storageRef(storage, `users/${user.uid}/photos/${Date.now()}.jpg`);
      await uploadBytes(fileRef, blob);
      const downloadUrl = await getDownloadURL(fileRef);
      return downloadUrl;
    },
    onSuccess: async (downloadUrl) => {
      if (!isMountedRef.current || !user?.uid) return;
      const newPhotos = [...state.photos, downloadUrl];
      dispatch({ type: 'SET_PHOTOS',         payload: newPhotos });
      dispatch({ type: 'SET_PHOTO_TO_UPLOAD', payload: null });
      await writeAuditLog('profile.photo_added', { uid: user.uid, photoCount: newPhotos.length });
      queryClient.invalidateQueries({ queryKey: profileQueryKeys.profile(user.uid) });
    },
    onError: (err: Error) => {
      dispatch({ type: 'SET_PHOTO_TO_UPLOAD', payload: null });
      Alert.alert('Image Not Allowed', err.message || 'Could not upload photo.');
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!user?.uid) throw new Error('No user');
      const updateData: Record<string, unknown> = {
        displayName:       state.displayName.trim(),
        bio:               state.bio.trim(),
        job:               state.job.trim(),
        school:            state.school.trim(),
        gender:            state.gender,
        photos:            state.photos,
        primaryPhotoIndex: state.primaryPhotoIndex,
        showOnProfile:     state.showOnProfile,
        showAge:           state.showAge,
        showDistance:      state.showDistance,
        updatedAt:         serverTimestamp(),
      };
      await updateDoc(doc(db, 'users', user.uid), updateData);
      await writeAuditLog('profile.updated', { uid: user.uid, fields: Object.keys(updateData) });
      return updateData;
    },
    onSuccess: () => {
      if (!IS_WEB) AccessibilityInfo.announceForAccessibility('Profile saved');
      Alert.alert('Saved', 'Your profile has been updated.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    },
    onError: () => {
      Alert.alert('Error', 'Could not save profile.');
    },
  });

  const validateName = useCallback((text: string) => {
    const v = text.slice(0, MAX_NAME_LENGTH);
    dispatch({ type: 'SET_NAME', payload: v });
    if (!v.trim()) {
      dispatch({ type: 'SET_NAME_ERROR', payload: 'Name is required' });
      return;
    }
    const result = validateDisplayName(v);
    dispatch({ type: 'SET_NAME_ERROR', payload: result.valid ? '' : (result.reason ?? 'Invalid name') });
  }, []);

  const validateBio = useCallback((text: string) => {
    const v = text.slice(0, MAX_BIO_LENGTH);
    dispatch({ type: 'SET_BIO', payload: v });
    dispatch({
      type: 'SET_BIO_ERROR',
      payload: v.length > MAX_BIO_LENGTH * 0.95 ? `Max ${MAX_BIO_LENGTH} characters` : '',
    });
  }, []);

  const pickImage = useCallback(async () => {
    if (state.photos.length >= 6) {
      Alert.alert('Limit reached', 'You can have up to 6 photos.');
      return;
    }
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.8, allowsEditing: true, allowsMultipleSelection: false,
      });
      if (!result.canceled && result.assets?.[0]) {
        dispatch({ type: 'SET_PHOTO_TO_UPLOAD', payload: result.assets[0].uri });
      }
    } catch {
      Alert.alert('Error', 'Could not open image picker.');
    }
  }, [state.photos.length]);

  const takePhoto = useCallback(async () => {
    if (state.photos.length >= 6) {
      Alert.alert('Limit reached', 'You can have up to 6 photos.');
      return;
    }
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Camera access required.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({ quality: 0.8, allowsEditing: true });
      if (!result.canceled && result.assets?.[0]) {
        dispatch({ type: 'SET_PHOTO_TO_UPLOAD', payload: result.assets[0].uri });
      }
    } catch {
      Alert.alert('Error', 'Could not open camera.');
    }
  }, [state.photos.length]);

  const deletePhoto = useCallback(async (index: number) => {
    if (!user?.uid) return;
    const newPhotos = state.photos.filter((_, i) => i !== index);
    let newPrimary = state.primaryPhotoIndex;
    if (index < state.primaryPhotoIndex) newPrimary -= 1;
    else if (index === state.primaryPhotoIndex) newPrimary = 0;
    newPrimary = Math.min(newPrimary, Math.max(0, newPhotos.length - 1));

    dispatch({ type: 'SET_PHOTOS',         payload: newPhotos });
    dispatch({ type: 'SET_PRIMARY',        payload: newPrimary });
    dispatch({ type: 'SET_DELETE_CONFIRM', payload: false });
    dispatch({ type: 'SET_DELETING_INDEX', payload: -1 });

    try {
      await updateDoc(doc(db, 'users', user.uid), { photos: newPhotos, primaryPhotoIndex: newPrimary });
      await writeAuditLog('profile.photo_removed', { uid: user.uid, photoCount: newPhotos.length });
    } catch {
      Alert.alert('Error', 'Could not delete photo.');
    }
  }, [state.photos, state.primaryPhotoIndex, user?.uid]);

  const setPrimaryPhoto = useCallback((index: number) => {
    dispatch({ type: 'SET_PRIMARY', payload: index });
  }, []);

  const saveProfile = useCallback(() => {
    const nameResult = validateDisplayName(state.displayName.trim());
    if (!nameResult.valid) {
      dispatch({ type: 'SET_NAME_ERROR', payload: nameResult.reason ?? 'Invalid name' });
      return;
    }
    if (state.photos.length === 0) {
      Alert.alert('Photos required', 'Please add at least one photo.');
      return;
    }
    saveMutation.mutate();
  }, [state.displayName, state.photos.length, saveMutation]);

  const dismissKeyboard = useCallback(() => { Keyboard.dismiss(); }, []);

  const renderPhotoGrid = () => (
    <View style={s.photoSection}>
      <Text style={s.sectionTitle}>Photos {state.photos.length}/6</Text>
      <View style={s.photoGrid}>
        {state.photos.map((uri, i) => (
          <View key={`${uri}_${i}`} style={s.photoCell}>
            <Pressable
              onPress={() = accessibilityLabel="button"> setPrimaryPhoto(i)}
              onLongPress={() => {
                dispatch({ type: 'SET_DELETING_INDEX', payload: i });
                dispatch({ type: 'SET_DELETE_CONFIRM', payload: true });
              }}
              delayLongPress={400}
            >
              {/*
                ✅ TurboImage with cachePolicy="dataCache" for remote download URLs.
                Local ImagePicker URIs (file://) are also supported by TurboImage's
                Nuke (iOS) and Coil (Android) backends — no fallback needed.
              */}
              <TurboImage
                source={{ uri }}
                style={[s.photoImage, i === state.primaryPhotoIndex && s.photoPrimary]}
                resizeMode="cover"
                cachePolicy="dataCache"
                accessibilityLabel={`Profile photo ${i + 1}${i === state.primaryPhotoIndex ? ', primary' : ''}`}
              />
              {i === state.primaryPhotoIndex && (
                <View style={s.primaryBadge}>
                  <Text style={s.primaryBadgeText}>Primary</Text>
                </View>
              )}
              <View style={s.photoIndexBadge}>
                <Text style={s.photoIndexText}>{i + 1}</Text>
              </View>
            </Pressable>
          </View>
        ))}
        {state.photos.length < 6 && (
          <Pressable style={s.photoAddCell} onPress={pickImage} accessibilityLabel="button">
            <Ionicons name="add" size={28} color="#6C63FF" />
            <Text style={s.photoAddText}>Add</Text>
          </Pressable>
        )}
      </View>
      <View style={s.photoActions}>
        <Pressable style={s.photoActionBtn} onPress={pickImage} accessibilityLabel="button">
          <Ionicons name="image-outline" size={16} color="#6C63FF" />
          <Text style={s.photoActionText}>Gallery</Text>
        </Pressable>
        <Pressable style={s.photoActionBtn} onPress={takePhoto} accessibilityLabel="button">
          <Ionicons name="camera-outline" size={16} color="#6C63FF" />
          <Text style={s.photoActionText}>Camera</Text>
        </Pressable>
      </View>
    </View>
  );

  const renderPhotoPreview = () => {
    if (!state.photoToUpload) return null;
    return (
      <View style={s.photoPreviewOverlay}>
        <View style={s.photoPreviewCard}>
          <Text style={s.photoPreviewTitle}>Add this photo?</Text>
          {/*
            ✅ TurboImage for the local preview URI — Coil/Nuke handle
            file:// URIs natively, cachePolicy="memory" avoids redundant disk write
            for a local file that only exists during this session.
          */}
          <TurboImage
            source={{ uri: state.photoToUpload }}
            style={s.photoPreviewImage}
            resizeMode="cover"
            cachePolicy="memory"
            accessibilityLabel="Photo preview"
          />
          <View style={s.photoPreviewBtns}>
            <Pressable
              style={s.photoPreviewCancel}
              onPress={() = accessibilityLabel="button"> dispatch({ type: 'SET_PHOTO_TO_UPLOAD', payload: null })}
            >
              <Text style={s.photoPreviewCancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[s.photoPreviewConfirm, uploadMutation.isPending && s.photoPreviewConfirmDisabled]}
              onPress={() = accessibilityLabel="button"> { if (state.photoToUpload) uploadMutation.mutate(state.photoToUpload); }}
              disabled={uploadMutation.isPending}
            >
              {uploadMutation.isPending
                ? <ActivityIndicator size="small" color="#fff" />
                : <Text style={s.photoPreviewConfirmText}>Add Photo</Text>
              }
            </Pressable>
          </View>
        </View>
      </View>
    );
  };

  const renderDeleteConfirm = () => (
    <View style={s.deleteOverlay}>
      <View style={s.deleteCard}>
        <Text style={s.deleteTitle}>Remove photo?</Text>
        <Text style={s.deleteSub}>This photo will be removed from your profile.</Text>
        <View style={s.deleteBtns}>
          <Pressable
            style={s.deleteCancel}
            onPress={() = accessibilityLabel="button"> {
              dispatch({ type: 'SET_DELETE_CONFIRM', payload: false });
              dispatch({ type: 'SET_DELETING_INDEX', payload: -1 });
            }}
          >
            <Text style={s.deleteCancelText}>Cancel</Text>
          </Pressable>
          <Pressable
            style={s.deleteConfirm}
            onPress={() = accessibilityLabel="button"> void deletePhoto(state.deletingPhotoIndex)}
          >
            <Text style={s.deleteConfirmText}>Remove</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );

  const renderGenderPicker = () => (
    <View style={s.genderOverlay}>
      <View style={s.genderCard}>
        <Text style={s.genderTitle}>Gender</Text>
        {GENDER_OPTIONS.map(g => (
          <Pressable
            key={g}
            style={[s.genderOption, state.gender === g && s.genderOptionSelected]}
            onPress={() = accessibilityLabel="button"> {
              dispatch({ type: 'SET_GENDER',        payload: g });
              dispatch({ type: 'SET_GENDER_PICKER', payload: false });
            }}
          >
            <Text style={[s.genderOptionText, state.gender === g && s.genderOptionTextSelected]}>{g}</Text>
            {state.gender === g && <Ionicons name="checkmark" size={18} color="#6C63FF" />}
          </Pressable>
        ))}
        <Pressable
          style={s.genderCancel}
          onPress={() = accessibilityLabel="button"> dispatch({ type: 'SET_GENDER_PICKER', payload: false })}
        >
          <Text style={s.genderCancelText}>Cancel</Text>
        </Pressable>
      </View>
    </View>
  );

  if (isLoading) {
    return (
      <SafeAreaView style={s.loadingContainer}>
        <StatusBar barStyle="dark-content" backgroundColor="#07070f" />
        <ActivityIndicator size="large" color="#6C63FF" />
        <Text style={s.loadingText}>Loading profile…</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#07070f" />

      {/* Header */}
      <View style={s.header}>
        <Pressable
          onPress={() = accessibilityLabel="button"> router.back()}
          style={s.headerBack}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="chevron-back" size={26} color="#6C63FF" />
        </Pressable>
        <Text style={s.headerTitle}>Edit Profile</Text>
        <Pressable
          onPress={saveProfile}
          style={[s.headerSave, saveMutation.isPending && s.headerSaveDisabled]}
          disabled={saveMutation.isPending}
          accessibilityRole="button"
          accessibilityLabel="Save profile"
        >
          {saveMutation.isPending
            ? <ActivityIndicator size="small" color="#6C63FF" />
            : <Text style={s.headerSaveText}>Save</Text>
          }
        </Pressable>
      </View>

      <KeyboardAvoidingView behavior={IS_IOS ? 'padding' : undefined} style={s.flex}>
        <Pressable style={s.flex} onPress={dismissKeyboard} accessibilityLabel="button">
          <Animated.View style={[s.flex, animatedStyle]}>
            <ScrollView
              ref={scrollRef}
              contentContainerStyle={s.scrollContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              bounces={false}
            >
              {renderPhotoGrid()}

              {/* Display Name */}
              <View style={s.fieldSection}>
                <Text style={s.sectionTitle}>Display Name</Text>
                <View style={[s.inputWrap, state.nameError ? s.inputWrapError : undefined]}>
                  <Ionicons name="person-outline" size={18} color="#64648a" style={s.inputIcon} />
                  <TextInput
                    style={s.input}
                    value={state.displayName}
                    onChangeText={validateName}
                    placeholder="Your name"
                    placeholderTextColor="#64648a"
                    maxLength={MAX_NAME_LENGTH}
                    autoCapitalize="words"
                    autoCorrect={false}
                  />
                </View>
                {!!state.nameError && <Text style={s.fieldError}>{state.nameError}</Text>}
                <Text style={s.fieldHint}>{state.displayName.length}/{MAX_NAME_LENGTH}</Text>
              </View>

              {/* Bio */}
              <View style={s.fieldSection}>
                <Text style={s.sectionTitle}>Bio</Text>
                <View style={[s.inputWrap, s.inputWrapMultiline, state.bioError ? s.inputWrapError : undefined]}>
                  <TextInput
                    style={[s.input, s.inputMultiline]}
                    value={state.bio}
                    onChangeText={validateBio}
                    placeholder="Tell people about yourself…"
                    placeholderTextColor="#64648a"
                    maxLength={MAX_BIO_LENGTH}
                    multiline
                    textAlignVertical="top"
                  />
                </View>
                {!!state.bioError && <Text style={s.fieldError}>{state.bioError}</Text>}
                <Text style={s.fieldHint}>{state.bio.length}/{MAX_BIO_LENGTH}</Text>
              </View>

              {/* Job */}
              <View style={s.fieldSection}>
                <Text style={s.sectionTitle}>Job Title</Text>
                <View style={s.inputWrap}>
                  <Ionicons name="briefcase-outline" size={18} color="#64648a" style={s.inputIcon} />
                  <TextInput
                    style={s.input}
                    value={state.job}
                    onChangeText={t => dispatch({ type: 'SET_JOB', payload: t.slice(0, MAX_JOB_LENGTH) })}
                    placeholder="Your job title"
                    placeholderTextColor="#64648a"
                    maxLength={MAX_JOB_LENGTH}
                    autoCapitalize="words"
                  />
                </View>
              </View>

              {/* School */}
              <View style={s.fieldSection}>
                <Text style={s.sectionTitle}>School</Text>
                <View style={s.inputWrap}>
                  <Ionicons name="school-outline" size={18} color="#64648a" style={s.inputIcon} />
                  <TextInput
                    style={s.input}
                    value={state.school}
                    onChangeText={t => dispatch({ type: 'SET_SCHOOL', payload: t.slice(0, MAX_SCHOOL_LENGTH) })}
                    placeholder="Your school"
                    placeholderTextColor="#64648a"
                    maxLength={MAX_SCHOOL_LENGTH}
                    autoCapitalize="words"
                  />
                </View>
              </View>

              {/* Gender */}
              <View style={s.fieldSection}>
                <Text style={s.sectionTitle}>Gender</Text>
                <Pressable
                  style={s.inputWrap}
                  onPress={() = accessibilityLabel="button"> dispatch({ type: 'SET_GENDER_PICKER', payload: true })}
                >
                  <Ionicons name="transgender-outline" size={18} color="#64648a" style={s.inputIcon} />
                  <Text style={[s.input, !state.gender && s.inputPlaceholder]}>
                    {state.gender || 'Select gender'}
                  </Text>
                  <Ionicons name="chevron-forward" size={16} color="#64648a" />
                </Pressable>
              </View>

              {/* Privacy toggles */}
              <View style={s.fieldSection}>
                <Text style={s.sectionTitle}>Privacy</Text>

                <View style={s.toggleRow}>
                  <View style={s.toggleInfo}>
                    <Text style={s.toggleLabel}>Show profile</Text>
                    <Text style={s.toggleDesc}>Others can discover your profile</Text>
                  </View>
                  <Switch
                    value={state.showOnProfile}
                    onValueChange={v => dispatch({ type: 'SET_SHOW_PROFILE', payload: v })}
                    trackColor={{ false: '#28285a', true: '#6C63FF' }}
                    thumbColor="#fff"
                  />
                </View>

                <View style={s.toggleRow}>
                  <View style={s.toggleInfo}>
                    <Text style={s.toggleLabel}>Show age</Text>
                    <Text style={s.toggleDesc}>Display your age on your profile</Text>
                  </View>
                  <Switch
                    value={state.showAge}
                    onValueChange={v => dispatch({ type: 'SET_SHOW_AGE', payload: v })}
                    trackColor={{ false: '#28285a', true: '#6C63FF' }}
                    thumbColor="#fff"
                  />
                </View>

                <View style={s.toggleRow}>
                  <View style={s.toggleInfo}>
                    <Text style={s.toggleLabel}>Show distance</Text>
                    <Text style={s.toggleDesc}>Display your distance to matches</Text>
                  </View>
                  <Switch
                    value={state.showDistance}
                    onValueChange={v => dispatch({ type: 'SET_SHOW_DISTANCE', payload: v })}
                    trackColor={{ false: '#28285a', true: '#6C63FF' }}
                    thumbColor="#fff"
                  />
                </View>
              </View>

              <View style={s.bottomSpacer} />
            </ScrollView>
          </Animated.View>
        </Pressable>
      </KeyboardAvoidingView>

      {renderPhotoPreview()}
      {state.showDeleteConfirm && renderDeleteConfirm()}
      {state.showGenderPicker  && renderGenderPicker()}
    </SafeAreaView>
  );
}

const s = StyleSheet.create((theme) => ({
  container:        { flex: 1, backgroundColor: theme.colors.background },
  flex:             { flex: 1 },
  loadingContainer: {
    flex: 1,
    backgroundColor: theme.colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: { fontSize: 14, color: theme.colors.textSecondary },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  headerBack:         { padding: 4 },
  headerTitle:        { flex: 1, fontSize: 18, fontWeight: '800', color: theme.colors.text, textAlign: 'center' },
  headerSave:         { paddingVertical: 6, paddingHorizontal: 16, borderRadius: 10 },
  headerSaveDisabled: { opacity: 0.5 },
  headerSaveText:     { fontSize: 15, fontWeight: '700', color: theme.colors.primary },

  scrollContent: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 60 },

  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: theme.colors.textSecondary,
    marginBottom: 10,
    marginLeft: 2,
    letterSpacing: 0.3,
  },

  photoSection:     { marginBottom: 28 },
  photoGrid:        { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  photoCell:        { width: '31%', aspectRatio: 3 / 4, borderRadius: 14, overflow: 'hidden' },
  photoImage:       { width: '100%', height: '100%', borderRadius: 14, borderWidth: 2, borderColor: 'transparent' },
  photoPrimary:     { borderColor: theme.colors.primary, borderWidth: 2 },
  primaryBadge:     {
    position: 'absolute', bottom: 6, left: 6,
    backgroundColor: theme.colors.primary,
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6,
  },
  primaryBadgeText: { fontSize: 9, fontWeight: '700', color: '#fff' },
  photoIndexBadge:  {
    position: 'absolute', top: 6, right: 6,
    backgroundColor: 'rgba(0,0,0,0.5)',
    width: 20, height: 20, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
  },
  photoIndexText:   { fontSize: 10, fontWeight: '700', color: '#fff' },
  photoAddCell:     {
    width: '31%', aspectRatio: 3 / 4, borderRadius: 14,
    borderWidth: 2, borderColor: theme.colors.border,
    borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', gap: 4,
  },
  photoAddText:     { fontSize: 12, color: theme.colors.primary, fontWeight: '600' },
  photoActions:     { flexDirection: 'row', gap: 12, marginTop: 12 },
  photoActionBtn:   {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: theme.colors.surface,
    paddingHorizontal: 16, paddingVertical: 10,
    borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border,
  },
  photoActionText:  { fontSize: 13, color: theme.colors.primary, fontWeight: '600' },

  fieldSection:       { marginBottom: 24 },
  inputWrap:          {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: theme.colors.surface,
    borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border,
    paddingHorizontal: 14, minHeight: 48,
  },
  inputWrapError:     { borderColor: theme.colors.error },
  inputWrapMultiline: { alignItems: 'flex-start', paddingVertical: 12 },
  inputIcon:          { marginRight: 10, marginTop: 2 },
  input:              { flex: 1, fontSize: 15, color: theme.colors.text, paddingVertical: 12 },
  inputPlaceholder:   { color: theme.colors.textSecondary },
  inputMultiline:     { minHeight: 100, maxHeight: 150, lineHeight: 20, paddingVertical: 0 },
  fieldError:         { fontSize: 12, color: theme.colors.error, marginTop: 6, marginLeft: 2 },
  fieldHint:          { fontSize: 11, color: theme.colors.textSecondary, textAlign: 'right', marginTop: 4 },

  toggleRow:  {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
  },
  toggleInfo: { flex: 1, marginRight: 16 },
  toggleLabel:{ fontSize: 15, fontWeight: '600', color: theme.colors.text },
  toggleDesc: { fontSize: 12, color: theme.colors.textSecondary, marginTop: 2 },

  bottomSpacer: { height: 40 },

  photoPreviewOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(4,4,12,0.92)',
    alignItems: 'center', justifyContent: 'center', zIndex: 20,
  },
  photoPreviewCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: 20, padding: 24, width: '90%', maxWidth: 380,
    borderWidth: 1, borderColor: theme.colors.border,
    alignItems: 'center', gap: 16,
  },
  photoPreviewTitle:           { fontSize: 18, fontWeight: '800', color: theme.colors.text },
  photoPreviewImage:           { width: '100%', aspectRatio: 3 / 4, borderRadius: 14 },
  photoPreviewBtns:            { flexDirection: 'row', gap: 12, width: '100%' },
  photoPreviewCancel:          {
    flex: 1, paddingVertical: 14, borderRadius: 12,
    alignItems: 'center', borderWidth: 1, borderColor: theme.colors.border,
  },
  photoPreviewCancelText:      { fontSize: 14, fontWeight: '600', color: theme.colors.textSecondary },
  photoPreviewConfirm:         {
    flex: 1, paddingVertical: 14, borderRadius: 12,
    alignItems: 'center', backgroundColor: theme.colors.primary,
  },
  photoPreviewConfirmDisabled: { backgroundColor: theme.colors.surface },
  photoPreviewConfirmText:     { fontSize: 14, fontWeight: '700', color: '#fff' },

  deleteOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(4,4,12,0.92)',
    alignItems: 'center', justifyContent: 'center', zIndex: 20,
  },
  deleteCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: 20, padding: 24, width: '85%', maxWidth: 360,
    borderWidth: 1, borderColor: theme.colors.border,
    alignItems: 'center', gap: 12,
  },
  deleteTitle:       { fontSize: 18, fontWeight: '800', color: theme.colors.text },
  deleteSub:         { fontSize: 14, color: theme.colors.textSecondary, textAlign: 'center' },
  deleteBtns:        { flexDirection: 'row', gap: 12, width: '100%', marginTop: 4 },
  deleteCancel:      {
    flex: 1, paddingVertical: 14, borderRadius: 12,
    alignItems: 'center', borderWidth: 1, borderColor: theme.colors.border,
  },
  deleteCancelText:  { fontSize: 14, fontWeight: '600', color: theme.colors.textSecondary },
  deleteConfirm:     {
    flex: 1, paddingVertical: 14, borderRadius: 12,
    alignItems: 'center', backgroundColor: theme.colors.error,
  },
  deleteConfirmText: { fontSize: 14, fontWeight: '700', color: '#fff' },

  genderOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(4,4,12,0.92)',
    alignItems: 'center', justifyContent: 'center', zIndex: 20,
  },
  genderCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: 20, padding: 24, width: '85%', maxWidth: 360,
    borderWidth: 1, borderColor: theme.colors.border, gap: 8,
  },
  genderTitle:              { fontSize: 18, fontWeight: '800', color: theme.colors.text, marginBottom: 8 },
  genderOption:             {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 14, paddingHorizontal: 16,
    borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border,
  },
  genderOptionSelected:     { borderColor: theme.colors.primary, backgroundColor: 'rgba(108,99,255,0.08)' },
  genderOptionText:         { fontSize: 15, color: theme.colors.text },
  genderOptionTextSelected: { fontWeight: '600', color: theme.colors.primary },
  genderCancel:             { paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  genderCancelText:         { fontSize: 14, color: theme.colors.textSecondary, fontWeight: '600' },
}));