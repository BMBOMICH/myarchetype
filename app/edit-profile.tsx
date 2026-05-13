import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { doc, getDoc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import React, { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import {
  AccessibilityInfo, ActivityIndicator, Alert,
  Keyboard, Pressable, StatusBar, Text, View,
} from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { SafeAreaView } from 'react-native-safe-area-context';
import { auth, db, storage } from '../firebaseConfig';
import { checkImageSafety } from '../utils/moderation';
import { writeAuditLog } from '../utils/logger';
import { validateDisplayName } from '../utils/nameValidation';
import { checkPhotoUpload } from '../utils/safetyMiddleware';
import { IS_WEB, MAX_BIO_LENGTH, MAX_JOB_LENGTH, MAX_NAME_LENGTH, MAX_SCHOOL_LENGTH } from '@/src/components/edit-profile/constants';
import { initialState, profileReducer } from '@/src/components/edit-profile/reducer';
import { s } from '@/src/components/edit-profile/styles';
import { PhotoSection } from '@/src/components/edit-profile/PhotoSection';
import { ProfileForm } from '@/src/components/edit-profile/ProfileForm';
import { PrivacySection } from '@/src/components/edit-profile/PrivacySection';

const profileQueryKeys = {
  profile: (uid: string) => ['profile', uid] as const,
};

export default function EditProfileScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const user = auth.currentUser;
  const [state, dispatch] = useReducer(profileReducer, initialState);
  const isMountedRef = useRef(true);

  const opacity = useSharedValue(0);
  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  useEffect(() => {
    opacity.value = withTiming(1, { duration: 300, easing: Easing.out(Easing.ease) });
    return () => { cancelAnimation(opacity); };
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
        displayName: (d['displayName'] as string | undefined) ?? (d['name'] as string | undefined) ?? '',
        bio: (d['bio'] as string | undefined) ?? '',
        job: (d['job'] as string | undefined) ?? '',
        school: (d['school'] as string | undefined) ?? '',
        age: (d['age'] as number | undefined) ?? 0,
        gender: (d['gender'] as string | undefined) ?? '',
        photos: (d['photos'] as string[] | undefined) ?? [],
        primaryPhotoIndex: (d['primaryPhotoIndex'] as number | undefined) ?? 0,
        showOnProfile: (d['showOnProfile'] as boolean | undefined) ?? true,
        showAge: (d['showAge'] as boolean | undefined) ?? true,
        showDistance: (d['showDistance'] as boolean | undefined) ?? true,
      },
    });
  }, [profileData]);

  useEffect(() => {
    if (isError) Alert.alert('Error', 'Could not load profile data.');
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
          throw new Error(safetyResult.reasons.join('\n') || 'Image flagged', {
            cause: new Error('safety-check-failed'),
          });
        }
      } catch (safetyErr: unknown) {
        const msg = safetyErr instanceof Error ? safetyErr.message : '';
        if (msg && msg !== 'Image flagged') {
          const chk = await checkImageSafety(uri, 'profile');
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
      dispatch({ type: 'SET_PHOTOS', payload: newPhotos });
      dispatch({ type: 'SET_PHOTO_TO_UPLOAD', payload: null });
      await writeAuditLog('user.update_photos', { photoCount: newPhotos.length });
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
      await writeAuditLog('user.update_profile', { fields: Object.keys(updateData) });
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

  const handleJobChange = useCallback((t: string) =>
    dispatch({ type: 'SET_JOB', payload: t.slice(0, MAX_JOB_LENGTH) }), []);

  const handleSchoolChange = useCallback((t: string) =>
    dispatch({ type: 'SET_SCHOOL', payload: t.slice(0, MAX_SCHOOL_LENGTH) }), []);

  const handleShowProfile = useCallback((v: boolean) =>
    dispatch({ type: 'SET_SHOW_PROFILE', payload: v }), []);
  const handleShowAge = useCallback((v: boolean) =>
    dispatch({ type: 'SET_SHOW_AGE', payload: v }), []);
  const handleShowDistance = useCallback((v: boolean) =>
    dispatch({ type: 'SET_SHOW_DISTANCE', payload: v }), []);

  const handleCancelUpload = useCallback(() =>
    dispatch({ type: 'SET_PHOTO_TO_UPLOAD', payload: null }), []);
  const handleCancelDelete = useCallback(() => {
    dispatch({ type: 'SET_DELETE_CONFIRM', payload: false });
    dispatch({ type: 'SET_DELETING_INDEX', payload: -1 });
  }, []);

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
      await updateDoc(doc(db, 'users', user.uid), {
        photos: newPhotos, primaryPhotoIndex: newPrimary,
      });
      await writeAuditLog('user.update_photos', { photoCount: newPhotos.length });
    } catch {
      Alert.alert('Error', 'Could not delete photo.');
    }
  }, [state.photos, state.primaryPhotoIndex, user?.uid]);

  const handleConfirmDelete = useCallback(() => {
    void deletePhoto(state.deletingPhotoIndex);
  }, [deletePhoto, state.deletingPhotoIndex]);

  const handleConfirmUpload = useCallback(() => {
    if (state.photoToUpload) uploadMutation.mutate(state.photoToUpload);
  }, [state.photoToUpload, uploadMutation]);

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

  const saveHeaderStyle = useMemo(() =>
    [s.headerSave, saveMutation.isPending && s.headerSaveDisabled],
    [saveMutation.isPending],
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

      <View style={s.header}>
        <Pressable
          onPress={() => router.back()}
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
          style={saveHeaderStyle}
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

      <KeyboardAwareScrollView
        style={s.flex}
        contentContainerStyle={s.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        <Pressable onPress={dismissKeyboard} accessibilityLabel="Dismiss keyboard">
          <Animated.View style={[s.flex, animatedStyle]}>
            <PhotoSection
              photos={state.photos}
              primaryPhotoIndex={state.primaryPhotoIndex}
              photoToUpload={state.photoToUpload}
              showDeleteConfirm={state.showDeleteConfirm}
              deletingPhotoIndex={state.deletingPhotoIndex}
              uploadMutationPending={uploadMutation.isPending}
              onPickImage={pickImage}
              onTakePhoto={takePhoto}
              onSetPrimary={setPrimaryPhoto}
              onLongPress={(i) => {
                dispatch({ type: 'SET_DELETING_INDEX', payload: i });
                dispatch({ type: 'SET_DELETE_CONFIRM', payload: true });
              }}
              onCancelUpload={handleCancelUpload}
              onConfirmUpload={handleConfirmUpload}
              onCancelDelete={handleCancelDelete}
              onConfirmDelete={handleConfirmDelete}
            />
            <ProfileForm
              displayName={state.displayName}
              nameError={state.nameError}
              bio={state.bio}
              bioError={state.bioError}
              job={state.job}
              school={state.school}
              gender={state.gender}
              showGenderPicker={state.showGenderPicker}
              onNameChange={validateName}
              onBioChange={validateBio}
              onJobChange={handleJobChange}
              onSchoolChange={handleSchoolChange}
              onOpenGenderPicker={() => dispatch({ type: 'SET_GENDER_PICKER', payload: true })}
              onCloseGenderPicker={() => dispatch({ type: 'SET_GENDER_PICKER', payload: false })}
              onSelectGender={(g) => {
                dispatch({ type: 'SET_GENDER', payload: g });
                dispatch({ type: 'SET_GENDER_PICKER', payload: false });
              }}
            />
            <PrivacySection
              showOnProfile={state.showOnProfile}
              showAge={state.showAge}
              showDistance={state.showDistance}
              onShowProfileChange={handleShowProfile}
              onShowAgeChange={handleShowAge}
              onShowDistanceChange={handleShowDistance}
            />
            <View style={s.bottomSpacer} />
          </Animated.View>
        </Pressable>
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}