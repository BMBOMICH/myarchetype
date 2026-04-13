import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { doc, getDoc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import React, { useCallback, useEffect, useReducer, useRef } from 'react';
import {
  AccessibilityInfo, ActivityIndicator, Alert, Animated,
  Image,
  Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView,
  StatusBar, StyleSheet, Switch, Text, TextInput,
  View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { auth, db, storage } from '../firebaseConfig';
import { checkImageSafety } from '../utils/contentSafety';
import { writeAuditLog } from '../utils/logger';
import { validateDisplayName } from '../utils/nameValidation';
import { checkPhotoUpload } from '../utils/safetyMiddleware';

const IS_IOS = Platform.OS === 'ios';
const IS_WEB = Platform.OS === 'web';
const MAX_BIO_LENGTH = 300;
const MAX_JOB_LENGTH = 60;
const MAX_SCHOOL_LENGTH = 60;
const MAX_NAME_LENGTH = 50;

type ProfileState = {
  displayName: string; nameError: string;
  bio: string; bioError: string;
  job: string; school: string;
  age: number; gender: string;
  photos: string[]; primaryPhotoIndex: number;
  showOnProfile: boolean; showAge: boolean; showDistance: boolean;
  loading: boolean; saving: boolean;
  uploadingPhoto: boolean; photoToUpload: string | null;
  showDeleteConfirm: boolean; deletingPhotoIndex: number;
  showGenderPicker: boolean;
  initialized: boolean;
};

type ProfileAction =
  | { type: 'SET_NAME'; payload: string } | { type: 'SET_NAME_ERROR'; payload: string }
  | { type: 'SET_BIO'; payload: string } | { type: 'SET_BIO_ERROR'; payload: string }
  | { type: 'SET_JOB'; payload: string } | { type: 'SET_SCHOOL'; payload: string }
  | { type: 'SET_AGE'; payload: number } | { type: 'SET_GENDER'; payload: string }
  | { type: 'SET_PHOTOS'; payload: string[] } | { type: 'SET_PRIMARY'; payload: number }
  | { type: 'SET_SHOW_PROFILE'; payload: boolean } | { type: 'SET_SHOW_AGE'; payload: boolean }
  | { type: 'SET_SHOW_DISTANCE'; payload: boolean }
  | { type: 'SET_LOADING'; payload: boolean } | { type: 'SET_SAVING'; payload: boolean }
  | { type: 'SET_UPLOADING'; payload: boolean } | { type: 'SET_PHOTO_TO_UPLOAD'; payload: string | null }
  | { type: 'SET_DELETE_CONFIRM'; payload: boolean } | { type: 'SET_DELETING_INDEX'; payload: number }
  | { type: 'SET_GENDER_PICKER'; payload: boolean } | { type: 'SET_INITIALIZED'; payload: boolean }
  | { type: 'RESET' };

const initialState: ProfileState = {
  displayName: '', nameError: '', bio: '', bioError: '',
  job: '', school: '', age: 0, gender: '',
  photos: [], primaryPhotoIndex: 0,
  showOnProfile: true, showAge: true, showDistance: true,
  loading: true, saving: false,
  uploadingPhoto: false, photoToUpload: null,
  showDeleteConfirm: false, deletingPhotoIndex: -1,
  showGenderPicker: false, initialized: false,
};

function profileReducer(state: ProfileState, action: ProfileAction): ProfileState {
  switch (action.type) {
    case 'SET_NAME': return { ...state, displayName: action.payload };
    case 'SET_NAME_ERROR': return { ...state, nameError: action.payload };
    case 'SET_BIO': return { ...state, bio: action.payload };
    case 'SET_BIO_ERROR': return { ...state, bioError: action.payload };
    case 'SET_JOB': return { ...state, job: action.payload };
    case 'SET_SCHOOL': return { ...state, school: action.payload };
    case 'SET_AGE': return { ...state, age: action.payload };
    case 'SET_GENDER': return { ...state, gender: action.payload };
    case 'SET_PHOTOS': return { ...state, photos: action.payload };
    case 'SET_PRIMARY': return { ...state, primaryPhotoIndex: action.payload };
    case 'SET_SHOW_PROFILE': return { ...state, showOnProfile: action.payload };
    case 'SET_SHOW_AGE': return { ...state, showAge: action.payload };
    case 'SET_SHOW_DISTANCE': return { ...state, showDistance: action.payload };
    case 'SET_LOADING': return { ...state, loading: action.payload };
    case 'SET_SAVING': return { ...state, saving: action.payload };
    case 'SET_UPLOADING': return { ...state, uploadingPhoto: action.payload };
    case 'SET_PHOTO_TO_UPLOAD': return { ...state, photoToUpload: action.payload };
    case 'SET_DELETE_CONFIRM': return { ...state, showDeleteConfirm: action.payload };
    case 'SET_DELETING_INDEX': return { ...state, deletingPhotoIndex: action.payload };
    case 'SET_GENDER_PICKER': return { ...state, showGenderPicker: action.payload };
    case 'SET_INITIALIZED': return { ...state, initialized: action.payload };
    case 'RESET': return { ...initialState };
    default: return state;
  }
}

const GENDER_OPTIONS = ['Woman', 'Man', 'Non-binary', 'Prefer not to say'];

export default function EditProfileScreen() {
  const router = useRouter();
  const user = auth.currentUser;
  const [state, dispatch] = useReducer(profileReducer, initialState);
  const isMountedRef = useRef(true);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => { isMountedRef.current = true; return () => { isMountedRef.current = false; }; }, []);

  // ─── Entrance animation ─────────────────────────────────
  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true }).start();
  }, [fadeAnim]);

  // ─── Load profile data ──────────────────────────────────
  useEffect(() => {
    if (!user?.uid) return;
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'users', user.uid));
        if (!isMountedRef.current) return;
        if (snap.exists()) {
          const d = snap.data();
          dispatch({ type: 'SET_NAME', payload: d.displayName ?? d.name ?? '' });
          dispatch({ type: 'SET_BIO', payload: d.bio ?? '' });
          dispatch({ type: 'SET_JOB', payload: d.job ?? '' });
          dispatch({ type: 'SET_SCHOOL', payload: d.school ?? '' });
          dispatch({ type: 'SET_AGE', payload: d.age ?? 0 });
          dispatch({ type: 'SET_GENDER', payload: d.gender ?? '' });
          dispatch({ type: 'SET_PHOTOS', payload: d.photos ?? [] });
          dispatch({ type: 'SET_PRIMARY', payload: d.primaryPhotoIndex ?? 0 });
          dispatch({ type: 'SET_SHOW_PROFILE', payload: d.showOnProfile ?? true });
          dispatch({ type: 'SET_SHOW_AGE', payload: d.showAge ?? true });
          dispatch({ type: 'SET_SHOW_DISTANCE', payload: d.showDistance ?? true });
        }
      } catch (e) {
        Alert.alert('Error', 'Could not load profile data.');
      } finally {
        dispatch({ type: 'SET_LOADING', payload: false });
        dispatch({ type: 'SET_INITIALIZED', payload: true });
      }
    })();
  }, [user?.uid]);

  // ─── Validate name ──────────────────────────────────────
  const validateName = useCallback((text: string) => {
    const v = text.slice(0, MAX_NAME_LENGTH);
    dispatch({ type: 'SET_NAME', payload: v });
    if (!v.trim()) { dispatch({ type: 'SET_NAME_ERROR', payload: 'Name is required' }); return; }
    const result = validateDisplayName(v);
    dispatch({ type: 'SET_NAME_ERROR', payload: result.valid ? '' : (result.reason ?? 'Invalid name') });
  }, []);

  // ─── Validate bio ───────────────────────────────────────
  const validateBio = useCallback((text: string) => {
    const v = text.slice(0, MAX_BIO_LENGTH);
    dispatch({ type: 'SET_BIO', payload: v });
    if (v.length > MAX_BIO_LENGTH * 0.95) {
      dispatch({ type: 'SET_BIO_ERROR', payload: `Max ${MAX_BIO_LENGTH} characters` });
    } else {
      dispatch({ type: 'SET_BIO_ERROR', payload: '' });
    }
  }, []);

  // ─── Pick image ─────────────────────────────────────────
  const pickImage = useCallback(async () => {
    if (state.photos.length >= 6) { Alert.alert('Limit reached', 'You can have up to 6 photos.'); return; }
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.8, allowsEditing: true, allowsMultipleSelection: false,
      });
      if (!result.canceled && result.assets?.[0]) {
        dispatch({ type: 'SET_PHOTO_TO_UPLOAD', payload: result.assets[0].uri });
      }
    } catch (e) { Alert.alert('Error', 'Could not open image picker.'); }
  }, [state.photos.length]);

  // ─── Take photo ─────────────────────────────────────────
  const takePhoto = useCallback(async () => {
    if (state.photos.length >= 6) { Alert.alert('Limit reached', 'You can have up to 6 photos.'); return; }
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') { Alert.alert('Permission needed', 'Camera access required.'); return; }
      const result = await ImagePicker.launchCameraAsync({ quality: 0.8, allowsEditing: true });
      if (!result.canceled && result.assets?.[0]) {
        dispatch({ type: 'SET_PHOTO_TO_UPLOAD', payload: result.assets[0].uri });
      }
    } catch (e) { Alert.alert('Error', 'Could not open camera.'); }
  }, [state.photos.length]);

  // ─── Upload photo ───────────────────────────────────────
  const uploadPhoto = useCallback(async () => {
    if (!state.photoToUpload || !user?.uid) return;
    dispatch({ type: 'SET_UPLOADING', payload: true });

    try {
      // Safety check
      try {
        const safetyResult = await checkPhotoUpload(state.photoToUpload, state.photoToUpload, user.uid, 'profile', {
          serverUrl: '', enablePhotoCheck: true, enableMessageCheck: false,
          enableLoginCheck: false, enableRegistrationCheck: false, enableProfileCheck: true,
          autoBlockCritical: true, logAllChecks: false,
        });
        if (!safetyResult.allowed) {
          Alert.alert('Image Not Allowed', safetyResult.reasons.join('\n') || 'This image was flagged.');
          dispatch({ type: 'SET_PHOTO_TO_UPLOAD', payload: null });
          dispatch({ type: 'SET_UPLOADING', payload: false });
          return;
        }
      } catch (e) {
        // Fallback to local check
        const chk = await checkImageSafety(state.photoToUpload);
        if (!chk.safe) {
          Alert.alert('Image Not Allowed', chk.reason);
          dispatch({ type: 'SET_PHOTO_TO_UPLOAD', payload: null });
          dispatch({ type: 'SET_UPLOADING', payload: false });
          return;
        }
      }

      const resp = await fetch(state.photoToUpload);
      const blob = await resp.blob();
      const fileRef = storageRef(storage, `users/${user.uid}/photos/${Date.now()}.jpg`);
      await uploadBytes(fileRef, blob);
      const downloadUrl = await getDownloadURL(fileRef);

      if (!isMountedRef.current) return;
      const newPhotos = [...state.photos, downloadUrl];
      dispatch({ type: 'SET_PHOTOS', payload: newPhotos });
      dispatch({ type: 'SET_PHOTO_TO_UPLOAD', payload: null });
      await writeAuditLog('profile.photo_added', { uid: user.uid, photoCount: newPhotos.length });
    } catch (e) {
      Alert.alert('Error', 'Could not upload photo.');
    } finally {
      dispatch({ type: 'SET_UPLOADING', payload: false });
    }
  }, [state.photoToUpload, state.photos, user?.uid]);

  // ─── Delete photo ───────────────────────────────────────
  const deletePhoto = useCallback(async (index: number) => {
    if (!user?.uid) return;
    const newPhotos = state.photos.filter((_, i) => i !== index);
    let newPrimary = state.primaryPhotoIndex;
    if (index < state.primaryPhotoIndex) newPrimary -= 1;
    else if (index === state.primaryPhotoIndex) newPrimary = 0;
    newPrimary = Math.min(newPrimary, Math.max(0, newPhotos.length - 1));

    dispatch({ type: 'SET_PHOTOS', payload: newPhotos });
    dispatch({ type: 'SET_PRIMARY', payload: newPrimary });
    dispatch({ type: 'SET_DELETE_CONFIRM', payload: false });
    dispatch({ type: 'SET_DELETING_INDEX', payload: -1 });

    try {
      await updateDoc(doc(db, 'users', user.uid), { photos: newPhotos, primaryPhotoIndex: newPrimary });
      await writeAuditLog('profile.photo_removed', { uid: user.uid, photoCount: newPhotos.length });
    } catch (e) { Alert.alert('Error', 'Could not delete photo.'); }
  }, [state.photos, state.primaryPhotoIndex, user?.uid]);

  // ─── Set primary photo ──────────────────────────────────
  const setPrimaryPhoto = useCallback((index: number) => {
    dispatch({ type: 'SET_PRIMARY', payload: index });
  }, []);

  // ─── Save profile ───────────────────────────────────────
  const saveProfile = useCallback(async () => {
    if (!user?.uid) return;
    const nameResult = validateDisplayName(state.displayName.trim());
    if (!nameResult.valid) { dispatch({ type: 'SET_NAME_ERROR', payload: nameResult.reason ?? 'Invalid name' }); return; }
    if (state.photos.length === 0) { Alert.alert('Photos required', 'Please add at least one photo.'); return; }

    dispatch({ type: 'SET_SAVING', payload: true });
    try {
      const updateData: Record<string, unknown> = {
        displayName: state.displayName.trim(),
        bio: state.bio.trim(),
        job: state.job.trim(),
        school: state.school.trim(),
        gender: state.gender,
        photos: state.photos,
        primaryPhotoIndex: state.primaryPhotoIndex,
        showOnProfile: state.showOnProfile,
        showAge: state.showAge,
        showDistance: state.showDistance,
        updatedAt: serverTimestamp(),
      };

      await updateDoc(doc(db, 'users', user.uid), updateData);
      await writeAuditLog('profile.updated', { uid: user.uid, fields: Object.keys(updateData) });

      if (!IS_WEB) AccessibilityInfo.announceForAccessibility('Profile saved');
      Alert.alert('Saved', 'Your profile has been updated.', [{ text: 'OK', onPress: () => router.back() }]);
    } catch (e) {
      Alert.alert('Error', 'Could not save profile.');
    } finally {
      dispatch({ type: 'SET_SAVING', payload: false });
    }
  }, [user?.uid, state, router]);

  // ─── Dismiss keyboard ───────────────────────────────────
  const dismissKeyboard = useCallback(() => { Keyboard.dismiss(); }, []);

  // ─── Render photo grid ──────────────────────────────────
  const renderPhotoGrid = () => (
    <View style={s.photoSection}>
      <Text style={s.sectionTitle}>Photos {state.photos.length}/6</Text>
      <View style={s.photoGrid}>
        {state.photos.map((uri, i) => (
          <View key={i} style={s.photoCell}>
            <Pressable onPress={() => setPrimaryPhoto(i)} onLongPress={() => { dispatch({ type: 'SET_DELETING_INDEX', payload: i }); dispatch({ type: 'SET_DELETE_CONFIRM', payload: true }); }} delayLongPress={400}>
              <Image source={{ uri }} style={[s.photoImage, i === state.primaryPhotoIndex && s.photoPrimary]} />
              {i === state.primaryPhotoIndex && (
                <View style={s.primaryBadge}><Text style={s.primaryBadgeText}>Primary</Text></View>
              )}
              <View style={s.photoIndexBadge}><Text style={s.photoIndexText}>{i + 1}</Text></View>
            </Pressable>
          </View>
        ))}
        {state.photos.length < 6 && (
          <Pressable style={s.photoAddCell} onPress={pickImage}>
            <Ionicons name="add" size={28} color="#6C63FF" />
            <Text style={s.photoAddText}>Add</Text>
          </Pressable>
        )}
      </View>
      <View style={s.photoActions}>
        <Pressable style={s.photoActionBtn} onPress={pickImage}>
          <Ionicons name="image-outline" size={16} color="#6C63FF" />
          <Text style={s.photoActionText}>Gallery</Text>
        </Pressable>
        <Pressable style={s.photoActionBtn} onPress={takePhoto}>
          <Ionicons name="camera-outline" size={16} color="#6C63FF" />
          <Text style={s.photoActionText}>Camera</Text>
        </Pressable>
      </View>
    </View>
  );

  // ─── Render photo upload preview ────────────────────────
  const renderPhotoPreview = () => {
    if (!state.photoToUpload) return null;
    return (
      <View style={s.photoPreviewOverlay}>
        <View style={s.photoPreviewCard}>
          <Text style={s.photoPreviewTitle}>Add this photo?</Text>
          <Image source={{ uri: state.photoToUpload }} style={s.photoPreviewImage} resizeMode="cover" />
          <View style={s.photoPreviewBtns}>
            <Pressable style={s.photoPreviewCancel} onPress={() => dispatch({ type: 'SET_PHOTO_TO_UPLOAD', payload: null })}>
              <Text style={s.photoPreviewCancelText}>Cancel</Text>
            </Pressable>
            <Pressable style={[s.photoPreviewConfirm, state.uploadingPhoto && s.photoPreviewConfirmDisabled]} onPress={() => void uploadPhoto()} disabled={state.uploadingPhoto}>
              {state.uploadingPhoto ? <ActivityIndicator size="small" color="#fff" /> : <Text style={s.photoPreviewConfirmText}>Add Photo</Text>}
            </Pressable>
          </View>
        </View>
      </View>
    );
  };

  // ─── Render delete confirm ──────────────────────────────
  const renderDeleteConfirm = () => (
    <View style={s.deleteOverlay}>
      <View style={s.deleteCard}>
        <Text style={s.deleteTitle}>Remove photo?</Text>
        <Text style={s.deleteSub}>This photo will be removed from your profile.</Text>
        <View style={s.deleteBtns}>
          <Pressable style={s.deleteCancel} onPress={() => { dispatch({ type: 'SET_DELETE_CONFIRM', payload: false }); dispatch({ type: 'SET_DELETING_INDEX', payload: -1 }); }}>
            <Text style={s.deleteCancelText}>Cancel</Text>
          </Pressable>
          <Pressable style={s.deleteConfirm} onPress={() => void deletePhoto(state.deletingPhotoIndex)}>
            <Text style={s.deleteConfirmText}>Remove</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );

  // ─── Render gender picker ───────────────────────────────
  const renderGenderPicker = () => (
    <View style={s.genderOverlay}>
      <View style={s.genderCard}>
        <Text style={s.genderTitle}>Gender</Text>
        {GENDER_OPTIONS.map(g => (
          <Pressable
            key={g}
            style={[s.genderOption, state.gender === g && s.genderOptionSelected]}
            onPress={() => { dispatch({ type: 'SET_GENDER', payload: g }); dispatch({ type: 'SET_GENDER_PICKER', payload: false }); }}
          >
            <Text style={[s.genderOptionText, state.gender === g && s.genderOptionTextSelected]}>{g}</Text>
            {state.gender === g && <Ionicons name="checkmark" size={18} color="#6C63FF" />}
          </Pressable>
        ))}
        <Pressable style={s.genderCancel} onPress={() => dispatch({ type: 'SET_GENDER_PICKER', payload: false })}>
          <Text style={s.genderCancelText}>Cancel</Text>
        </Pressable>
      </View>
    </View>
  );

  // ─── Main render ────────────────────────────────────────
  if (state.loading) {
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
        <Pressable onPress={() => router.back()} style={s.headerBack} hitSlop={12} accessibilityRole="button" accessibilityLabel="Go back">
          <Ionicons name="chevron-back" size={26} color="#6C63FF" />
        </Pressable>
        <Text style={s.headerTitle}>Edit Profile</Text>
        <Pressable
          onPress={() => void saveProfile()}
          style={[s.headerSave, state.saving && s.headerSaveDisabled]}
          disabled={state.saving}
          accessibilityRole="button"
          accessibilityLabel="Save profile"
        >
          {state.saving ? <ActivityIndicator size="small" color="#6C63FF" /> : <Text style={s.headerSaveText}>Save</Text>}
        </Pressable>
      </View>

      <KeyboardAvoidingView behavior={IS_IOS ? 'padding' : undefined} style={s.flex}>
        <Pressable style={s.flex} onPress={dismissKeyboard}>
          <Animated.View style={[s.flex, { opacity: fadeAnim }]}>
            <ScrollView ref={scrollRef} contentContainerStyle={s.scrollContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} bounces={false}>
              {renderPhotoGrid()}

              {/* Display Name */}
              <View style={s.fieldSection}>
                <Text style={s.sectionTitle}>Display Name</Text>
                <View style={[s.inputWrap, state.nameError && s.inputWrapError]}>
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
                <View style={[s.inputWrap, s.inputWrapMultiline, state.bioError && s.inputWrapError]}>
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
                <Pressable style={s.inputWrap} onPress={() => dispatch({ type: 'SET_GENDER_PICKER', payload: true })}>
                  <Ionicons name="transgender-outline" size={18} color="#64648a" style={s.inputIcon} />
                  <Text style={[s.input, !state.gender && { color: '#64648a' }]}>{state.gender || 'Select gender'}</Text>
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
                  <Switch value={state.showOnProfile} onValueChange={v => dispatch({ type: 'SET_SHOW_PROFILE', payload: v })} trackColor={{ false: '#28285a', true: '#6C63FF' }} thumbColor="#fff" />
                </View>

                <View style={s.toggleRow}>
                  <View style={s.toggleInfo}>
                    <Text style={s.toggleLabel}>Show age</Text>
                    <Text style={s.toggleDesc}>Display your age on your profile</Text>
                  </View>
                  <Switch value={state.showAge} onValueChange={v => dispatch({ type: 'SET_SHOW_AGE', payload: v })} trackColor={{ false: '#28285a', true: '#6C63FF' }} thumbColor="#fff" />
                </View>

                <View style={s.toggleRow}>
                  <View style={s.toggleInfo}>
                    <Text style={s.toggleLabel}>Show distance</Text>
                    <Text style={s.toggleDesc}>Display your distance to matches</Text>
                  </View>
                  <Switch value={state.showDistance} onValueChange={v => dispatch({ type: 'SET_SHOW_DISTANCE', payload: v })} trackColor={{ false: '#28285a', true: '#6C63FF' }} thumbColor="#fff" />
                </View>
              </View>

              <View style={s.bottomSpacer} />
            </ScrollView>
          </Animated.View>
        </Pressable>
      </KeyboardAvoidingView>

      {renderPhotoPreview()}
      {state.showDeleteConfirm && renderDeleteConfirm()}
      {state.showGenderPicker && renderGenderPicker()}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#07070f' },
  flex: { flex: 1 },
  loadingContainer: { flex: 1, backgroundColor: '#07070f', alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { fontSize: 14, color: '#9494B8' },

  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: '#1e1e48', backgroundColor: '#0a0a18',
  },
  headerBack: { padding: 4 },
  headerTitle: { flex: 1, fontSize: 18, fontWeight: '800', color: '#EDEDFF', textAlign: 'center' },
  headerSave: { paddingVertical: 6, paddingHorizontal: 16, borderRadius: 10 },
  headerSaveDisabled: { opacity: 0.5 },
  headerSaveText: { fontSize: 15, fontWeight: '700', color: '#6C63FF' },

  scrollContent: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 60 },

  sectionTitle: { fontSize: 14, fontWeight: '700', color: '#9494B8', marginBottom: 10, marginLeft: 2, letterSpacing: 0.3 },

  photoSection: { marginBottom: 28 },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  photoCell: { width: '31%', aspectRatio: 3 / 4, borderRadius: 14, overflow: 'hidden' },
  photoImage: { width: '100%', height: '100%', borderRadius: 14, borderWidth: 2, borderColor: 'transparent' },
  photoPrimary: { borderColor: '#6C63FF', borderWidth: 2 },
  primaryBadge: { position: 'absolute', bottom: 6, left: 6, backgroundColor: '#6C63FF', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  primaryBadgeText: { fontSize: 9, fontWeight: '700', color: '#fff' },
  photoIndexBadge: { position: 'absolute', top: 6, right: 6, backgroundColor: 'rgba(0,0,0,0.5)', width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  photoIndexText: { fontSize: 10, fontWeight: '700', color: '#fff' },
  photoAddCell: { width: '31%', aspectRatio: 3 / 4, borderRadius: 14, borderWidth: 2, borderColor: '#28285a', borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', gap: 4 },
  photoAddText: { fontSize: 12, color: '#6C63FF', fontWeight: '600' },
  photoActions: { flexDirection: 'row', gap: 12, marginTop: 12 },
  photoActionBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#0d0d24', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: '#28285a' },
  photoActionText: { fontSize: 13, color: '#6C63FF', fontWeight: '600' },

  fieldSection: { marginBottom: 24 },
  inputWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0d0d24', borderRadius: 12, borderWidth: 1, borderColor: '#28285a', paddingHorizontal: 14, minHeight: 48 },
  inputWrapError: { borderColor: '#FF6B6B' },
  inputWrapMultiline: { alignItems: 'flex-start', paddingVertical: 12 },
  inputIcon: { marginRight: 10, marginTop: 2 },
  input: { flex: 1, fontSize: 15, color: '#EDEDFF', paddingVertical: 12 },
  inputMultiline: { minHeight: 100, maxHeight: 150, lineHeight: 20, paddingVertical: 0 },
  fieldError: { fontSize: 12, color: '#FF6B6B', marginTop: 6, marginLeft: 2 },
  fieldHint: { fontSize: 11, color: '#64648a', textAlign: 'right', marginTop: 4 },

  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#1e1e48' },
  toggleInfo: { flex: 1, marginRight: 16 },
  toggleLabel: { fontSize: 15, fontWeight: '600', color: '#EDEDFF' },
  toggleDesc: { fontSize: 12, color: '#64648a', marginTop: 2 },

  bottomSpacer: { height: 40 },

  photoPreviewOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(4,4,12,0.92)', alignItems: 'center', justifyContent: 'center', zIndex: 20 },
  photoPreviewCard: { backgroundColor: '#111128', borderRadius: 20, padding: 24, width: '90%', maxWidth: 380, borderWidth: 1, borderColor: '#1e1e48', alignItems: 'center', gap: 16 },
  photoPreviewTitle: { fontSize: 18, fontWeight: '800', color: '#EDEDFF' },
  photoPreviewImage: { width: '100%', aspectRatio: 3 / 4, borderRadius: 14 },
  photoPreviewBtns: { flexDirection: 'row', gap: 12, width: '100%' },
  photoPreviewCancel: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: '#28285a' },
  photoPreviewCancelText: { fontSize: 14, fontWeight: '600', color: '#9494B8' },
  photoPreviewConfirm: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center', backgroundColor: '#6C63FF' },
  photoPreviewConfirmDisabled: { backgroundColor: '#181834' },
  photoPreviewConfirmText: { fontSize: 14, fontWeight: '700', color: '#fff' },

  deleteOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(4,4,12,0.92)', alignItems: 'center', justifyContent: 'center', zIndex: 20 },
  deleteCard: { backgroundColor: '#111128', borderRadius: 20, padding: 24, width: '85%', maxWidth: 360, borderWidth: 1, borderColor: '#1e1e48', alignItems: 'center', gap: 12 },
  deleteTitle: { fontSize: 18, fontWeight: '800', color: '#EDEDFF' },
  deleteSub: { fontSize: 14, color: '#9494B8', textAlign: 'center' },
  deleteBtns: { flexDirection: 'row', gap: 12, width: '100%', marginTop: 4 },
  deleteCancel: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: '#28285a' },
  deleteCancelText: { fontSize: 14, fontWeight: '600', color: '#9494B8' },
  deleteConfirm: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center', backgroundColor: '#FF6B6B' },
  deleteConfirmText: { fontSize: 14, fontWeight: '700', color: '#fff' },

  genderOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(4,4,12,0.92)', alignItems: 'center', justifyContent: 'center', zIndex: 20 },
  genderCard: { backgroundColor: '#111128', borderRadius: 20, padding: 24, width: '85%', maxWidth: 360, borderWidth: 1, borderColor: '#1e1e48', gap: 8 },
  genderTitle: { fontSize: 18, fontWeight: '800', color: '#EDEDFF', marginBottom: 8 },
  genderOption: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, paddingHorizontal: 16, borderRadius: 12, borderWidth: 1, borderColor: '#28285a' },
  genderOptionSelected: { borderColor: '#6C63FF', backgroundColor: 'rgba(108,99,255,0.08)' },
  genderOptionText: { fontSize: 15, color: '#EDEDFF' },
  genderOptionTextSelected: { fontWeight: '600', color: '#6C63FF' },
  genderCancel: { paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  genderCancelText: { fontSize: 14, color: '#9494B8', fontWeight: '600' },
});