import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { deleteUser } from 'firebase/auth';
import { collection, deleteDoc, doc, getDoc, getDocs, updateDoc } from 'firebase/firestore';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { CLOUDINARY_CONFIG } from '../cloudinaryConfig';
import BodyTypeSelector from '../components/BodyTypeSelector';
import TrustScoreDisplay from '../components/TrustScoreDisplay';
import { auth, db } from '../firebaseConfig';
import { requestLocationPermission, saveUserLocation } from '../utils/location';
import { checkBioEdit, checkImageSafety } from '../utils/moderation';
import { validateDisplayName } from '../utils/nameValidation';
import { deleteVideoProfile } from '../utils/videoProfiles';

const IS_WEB = Platform.OS === 'web';
const MAX_PHOTOS = 3, MAX_BIO = 200, MAX_ICE = 150, VIDEO_OLD_DAYS = 180;

// ─── Types ────────────────────────────────────────────────

interface HeightObject { value: number; verificationMethod: string; verifiedAt: string; }
interface UserRatings { trustScore?: number; }
interface UserLocation { city?: string; country?: string; }
interface AgeVerification { verified?: boolean; }

interface UserData {
  name?: string; age?: number;
  height?: number | HeightObject;
  bodyType?: string; lookingFor?: string; religiousViews?: string; lifestyle?: string;
  relationshipGoal?: string; bio?: string; photos?: string[]; personalityType?: string;
  icebreaker?: string; icebreakerPrompt?: string; videoProfile?: string;
  videoProfileUploadedAt?: string; location?: UserLocation; selfieVerified?: boolean;
  ageVerification?: AgeVerification; ratings?: UserRatings;
}

interface CloudinaryUploadResponse { secure_url?: string; error?: { message?: string }; }
interface MediaDeviceInfoTyped { kind: string; label: string; }
interface VideoTrack { label: string; stop: () => void; }
interface MediaStreamTyped { getTracks: () => VideoTrack[]; getVideoTracks: () => VideoTrack[]; }

interface OptionItem { value: string; desc: string; }
interface SaveUpdate {
  name: string; age: number; bodyType: string; lookingFor: string;
  religiousViews: string; lifestyle: string; relationshipGoal: string;
  bio: string; photos: string[]; icebreaker: string; icebreakerPrompt: string;
  updatedAt: string; height?: HeightObject;
}

// ─── Constants ────────────────────────────────────────────

const ICEBREAKER_PROMPTS: string[] = ["My perfect Sunday looks like...","The way to my heart is...","I'm looking for someone who...","My most controversial opinion is...","Two truths and a lie about me...","The best trip I ever took was...","I geek out about...","My hidden talent is...","I'll know it's love when...","The key to my heart is...","I'm weirdly attracted to...","My love language is...","On weekends you'll find me...","I'm convinced that...","My friends would describe me as..."];
const RELIGIOUS_OPTIONS: OptionItem[] = [{ value: 'Traditional', desc: 'Follow religious practices regularly' },{ value: 'Modern', desc: 'Believe but flexible interpretation' },{ value: 'Spiritual', desc: 'Spiritual but not organized religion' },{ value: 'None', desc: 'Not religious or spiritual' }];
const LIFESTYLE_OPTIONS: OptionItem[] = [{ value: 'Natural', desc: 'Simple, outdoors, minimal' },{ value: 'Fitness', desc: 'Active, gym, health-focused' },{ value: 'Social', desc: 'Outgoing, parties, events' },{ value: 'Homebody', desc: 'Cozy nights in, relaxing' }];
const RELATIONSHIP_OPTIONS: OptionItem[] = [{ value: 'Marriage', desc: 'Looking for life partner' },{ value: 'Long-term', desc: 'Serious but not rushing' },{ value: 'Exploring', desc: 'Open to see where it goes' }];

const VIRTUAL_CAM_KW = ['obs','virtual','manycam','snap camera','epoccam','xsplit','mmhmm','camo','iriun','droidcam','streamlabs','fakecam','splitcam','chromacam'];
function isVirtualCamera(label: string): boolean { return VIRTUAL_CAM_KW.some(k => (label || '').toLowerCase().includes(k)); }

const getVideoAge = (at: string | null): string => {
  if (!at) return '';
  const d = Math.floor((Date.now() - new Date(at).getTime()) / (1000 * 60 * 60 * 24));
  if (d === 0) return 'Today'; if (d === 1) return 'Yesterday';
  if (d < 30) return `${d} days ago`; if (d < 60) return '1 month ago';
  if (d < 365) return `${Math.floor(d / 30)} months ago`; return 'Over a year ago';
};
const isVideoOld = (at: string | null): boolean => { if (!at) return false; return Math.floor((Date.now() - new Date(at).getTime()) / (1000 * 60 * 60 * 24)) > VIDEO_OLD_DAYS; };
const getHtBadge = (m: string): string => m === 'manual-measured' ? 'Verified' : m === 'ai-estimated' ? 'AI Estimated' : '';

export default function EditProfileScreen() {
  const router = useRouter();
  const user = auth.currentUser;
  const cameraRef = useRef<CameraView>(null);
  const streamRef = useRef<MediaStreamTyped | null>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deletingVideo, setDeletingVideo] = useState(false);
  const [gettingLoc, setGettingLoc] = useState(false);
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
  const [bioError, setBioError] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [personalityType, setPersonalityType] = useState('');
  const [locationCity, setLocationCity] = useState('');
  const [selfieVerified, setSelfieVerified] = useState(false);
  const [ageVerified, setAgeVerified] = useState(false);
  const [videoProfile, setVideoProfile] = useState<string | null>(null);
  const [videoUploadedAt, setVideoUploadedAt] = useState<string | null>(null);
  const [playingVideo, setPlayingVideo] = useState(false);
  const videoPlayer = useVideoPlayer(videoProfile || '', p => { p.loop = false; });
  const [icebreaker, setIcebreaker] = useState('');
  const [selectedPrompt, setSelectedPrompt] = useState('');
  const [showPromptPicker, setShowPromptPicker] = useState(false);
  const [reorderMode, setReorderMode] = useState(false);
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState<number | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [webCamReady, setWebCamReady] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
  const [permission, requestPermission] = useCameraPermissions();

  const loadProfile = useCallback(async () => {
    if (!user) { setTimeout(() => router.replace('/login'), 100); return; }
    try {
      const snap = await getDoc(doc(db, 'users', user.uid));
      if (!snap.exists()) { setTimeout(() => router.replace('/profile-setup'), 100); return; }
      const d = snap.data() as UserData;
      setUserData(d); setName(d.name || ''); setAge(d.age?.toString() || '');
      if (typeof d.height === 'object' && d.height !== null) {
        const hObj = d.height as HeightObject;
        setHeight(hObj.value?.toString() || '');
        setHeightMethod(hObj.verificationMethod || '');
        setHeightVerified(hObj.verificationMethod === 'manual-measured');
      } else {
        setHeight(typeof d.height === 'number' ? d.height.toString() : '');
      }
      setBodyType(d.bodyType || ''); setLookingFor(d.lookingFor || '');
      setReligiousViews(d.religiousViews || ''); setLifestyle(d.lifestyle || '');
      setRelationshipGoal(d.relationshipGoal || ''); setBio(d.bio || '');
      setPhotos(d.photos || []); setPersonalityType(d.personalityType || '');
      setIcebreaker(d.icebreaker || ''); setSelectedPrompt(d.icebreakerPrompt || '');
      setVideoProfile(d.videoProfile || null); setVideoUploadedAt(d.videoProfileUploadedAt || null);
      if (d.location?.city) setLocationCity(`${d.location.city}, ${d.location.country || ''}`);
      setSelfieVerified(d.selfieVerified || false);
      setAgeVerified(d.ageVerification?.verified || false);
    } catch (e: unknown) {
      console.error('[EditProfile] loadProfile failed:', e);
      Alert.alert('Error', 'Error loading profile');
    } finally { setLoading(false); }
  }, [user, router]);

  useEffect(() => { void loadProfile(); }, [loadProfile]);

  const handleDeleteVideo = useCallback(() => {
    Alert.alert('Delete Video', 'Delete your video profile?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        setDeletingVideo(true);
        try {
          const r = await deleteVideoProfile();
          if (r.success) { setVideoProfile(null); setVideoUploadedAt(null); Alert.alert('Success', 'Video deleted'); }
          else Alert.alert('Error', r.error || 'Failed');
        } catch (e: unknown) {
          console.error('[EditProfile] deleteVideo failed:', e);
          Alert.alert('Error', 'Failed to delete video');
        } finally { setDeletingVideo(false); }
      }},
    ]);
  }, []);

  const handleToggleVideo = useCallback(() => {
    if (playingVideo) { videoPlayer.pause(); setPlayingVideo(false); }
    else { videoPlayer.replay(); setPlayingVideo(true); }
  }, [playingVideo, videoPlayer]);

  useEffect(() => {
    if (!playingVideo) return;
    const t = setInterval(() => { try { if (!videoPlayer.playing) setPlayingVideo(false); } catch { /* ignore */ } }, 1000);
    return () => clearInterval(t);
  }, [playingVideo, videoPlayer]);

  const handlePhotoTap = useCallback((i: number) => {
    if (!reorderMode) return;
    if (selectedPhotoIndex === null) { setSelectedPhotoIndex(i); }
    else {
      const p = [...photos];
      const temp = p[selectedPhotoIndex]!; p[selectedPhotoIndex] = p[i]!; p[i] = temp;
      setPhotos(p); setSelectedPhotoIndex(null);
    }
  }, [reorderMode, selectedPhotoIndex, photos]);

  const moveLeft = useCallback((i: number) => { if (!i) return; const p = [...photos]; [p[i - 1]!, p[i]!] = [p[i]!, p[i - 1]!]; setPhotos(p); }, [photos]);
  const moveRight = useCallback((i: number) => { if (i >= photos.length - 1) return; const p = [...photos]; [p[i + 1]!, p[i]!] = [p[i]!, p[i + 1]!]; setPhotos(p); }, [photos]);
  const removePhoto = useCallback((i: number) => {
    if (photos.length <= 1) { Alert.alert('Error', 'Must have at least 1 photo'); return; }
    setPhotos(photos.filter((_, j) => j !== i)); setSelectedPhotoIndex(null);
  }, [photos]);

  const stopWebCam = useCallback(() => {
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    setWebCamReady(false);
  }, []);

  const startWebCam = useCallback(async () => {
    setCamError(null); setWebCamReady(false);
    if (!navigator.mediaDevices?.getUserMedia) { setCamError('Camera not supported'); return; }
    try {
      const devs = await navigator.mediaDevices.enumerateDevices() as MediaDeviceInfoTyped[];
      for (const d of devs) { if (d.kind === 'videoinput' && isVirtualCamera(d.label)) { setCamError('Virtual cameras are not allowed. Use your real camera.'); return; } }
    } catch { /* ignore enumerate errors */ }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false }) as unknown as MediaStreamTyped;
      const track = stream.getVideoTracks()[0];
      if (track && isVirtualCamera(track.label)) { stream.getTracks().forEach(t => t.stop()); setCamError('Virtual cameras not allowed.'); return; }
      streamRef.current = stream;
      setTimeout(() => {
        const v = document.getElementById('edit-profile-camera') as HTMLVideoElement | null;
        if (v) {
          v.srcObject = stream as unknown as MediaStream;
          v.onloadedmetadata = () => { void v.play(); setWebCamReady(true); };
        }
      }, 100);
    } catch (e: unknown) {
      const name = (e as { name?: string })?.name ?? '';
      setCamError(name === 'NotAllowedError' ? 'Camera blocked' : 'Camera error');
    }
  }, []);

  const closeCamera = useCallback(() => { stopWebCam(); setCameraOpen(false); setCamError(null); }, [stopWebCam]);

  const openCamera = useCallback(async () => {
    if (photos.length >= MAX_PHOTOS) { Alert.alert('Limit', 'Maximum 3 photos'); return; }
    if (!IS_WEB && !permission?.granted) {
      const r = await requestPermission();
      if (!r.granted) { Alert.alert('Permission Required', 'Camera permission required'); return; }
    }
    setCameraOpen(true);
    if (IS_WEB) setTimeout(() => { void startWebCam(); }, 200);
  }, [photos.length, permission, requestPermission, startWebCam]);

  const uploadAndVerifyPhoto = useCallback(async (uri: string): Promise<string | null> => {
    try {
      const nsfw = await checkImageSafety(uri, 'edit');
      if (!nsfw.safe) { Alert.alert('Inappropriate Content', nsfw.reason || 'Photo flagged.'); return null; }
      const res = await fetch(uri);
      const blob = await res.blob();
      const fd = new FormData();
      fd.append('file', blob);
      fd.append('upload_preset', CLOUDINARY_CONFIG.uploadPreset);
      const up = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CONFIG.cloudName}/image/upload`, { method: 'POST', body: fd });
      const data = await up.json() as CloudinaryUploadResponse;
      if (!data.secure_url) { Alert.alert('Error', 'Upload failed'); return null; }
      await updateDoc(doc(db, 'users', user!.uid), { lastPhotoUpdate: new Date().toISOString() });
      return data.secure_url;
    } catch (e: unknown) {
      console.error('[EditProfile] uploadAndVerifyPhoto failed:', e);
      Alert.alert('Error', 'Error uploading photo');
      return null;
    }
  }, [user]);

  const capturePhoto = useCallback(async () => {
    let uri: string | null = null;
    try {
      if (IS_WEB) {
        if (!webCamReady) return;
        const v = document.getElementById('edit-profile-camera') as HTMLVideoElement | null;
        if (!v || v.readyState < 2) return;
        const c = document.createElement('canvas');
        c.width = v.videoWidth || 640; c.height = v.videoHeight || 480;
        const ctx = c.getContext('2d');
        if (!ctx) return;
        ctx.save(); ctx.scale(-1, 1); ctx.drawImage(v, -c.width, 0, c.width, c.height); ctx.restore();
        uri = c.toDataURL('image/jpeg', 0.85);
      } else {
        if (!cameraRef.current) return;
        const p = await cameraRef.current.takePictureAsync({ quality: 0.85 });
        uri = p?.uri || null;
      }
      if (!uri) { Alert.alert('Error', 'Failed to capture'); return; }
      closeCamera(); setUploadingPhoto(true);
      const url = await uploadAndVerifyPhoto(uri);
      if (url) setPhotos(prev => [...prev, url]);
    } catch (e: unknown) {
      console.error('[EditProfile] capturePhoto failed:', e);
      Alert.alert('Error', 'Failed to capture photo');
    } finally { setUploadingPhoto(false); }
  }, [webCamReady, closeCamera, uploadAndVerifyPhoto]);

  const handleGetLocation = useCallback(async () => {
    setGettingLoc(true);
    try {
      const loc = await requestLocationPermission();
      if (loc) { setLocationCity(loc.city ? `${loc.city}, ${loc.country}` : 'Location found'); await saveUserLocation(loc); Alert.alert('Success', 'Location updated!'); }
      else Alert.alert('Error', 'Could not get location.');
    } catch (e: unknown) {
      console.error('[EditProfile] getLocation failed:', e);
      Alert.alert('Error', 'Could not get location.');
    } finally { setGettingLoc(false); }
  }, []);

  const handleNameChange = useCallback((text: string) => {
    const c = text.replace(/[^a-zA-Z\s\-']/g, '');
    setName(c);
    if (c.length > 0) { const r = validateDisplayName(c); setNameError(r.valid ? null : (r.reason || null)); }
    else setNameError(null);
  }, []);

  const handleBioChange = useCallback((text: string) => {
    const t = text.slice(0, MAX_BIO);
    setBio(t);
    if (t.length > 20) { const r = checkBioEdit(t); setBioError(r.safe ? '' : r.reason); }
    else setBioError('');
  }, []);

  const handleSave = useCallback(async () => {
    const nv = validateDisplayName(name);
    if (!nv.valid) { Alert.alert('Invalid Name', nv.reason || 'Invalid name'); return; }
    if (!name || !age || !height || !bodyType || !lookingFor) { Alert.alert('Missing Fields', 'Please fill all required fields'); return; }
    if (!photos.length) { Alert.alert('No Photos', 'Add at least 1 photo'); return; }
    if (bioError) { Alert.alert('Bio Issue', bioError); return; }
    if (!user) return;
    setSaving(true);
    try {
      const update: SaveUpdate = {
        name, age: parseInt(age), bodyType, lookingFor, religiousViews, lifestyle,
        relationshipGoal, bio, photos, icebreaker, icebreakerPrompt: selectedPrompt,
        updatedAt: new Date().toISOString(),
      };
      if (!heightVerified) {
        update.height = { value: parseInt(height), verificationMethod: 'self-reported', verifiedAt: new Date().toISOString() };
      }
      await updateDoc(doc(db, 'users', user.uid), update as Record<string, unknown>);
      Alert.alert('Success', 'Profile updated!');
      router.back();
    } catch (e: unknown) {
      const msg = (e as { message?: string })?.message ?? 'Unknown error';
      console.error('[EditProfile] save failed:', e);
      Alert.alert('Error', msg);
    } finally { setSaving(false); }
  }, [name, age, height, bodyType, lookingFor, religiousViews, lifestyle, relationshipGoal, bio, bioError, photos, icebreaker, selectedPrompt, heightVerified, user, router]);

  const handleDeleteAccount = useCallback(() => {
    if (!user) return;
    Alert.alert('⚠️ DELETE ACCOUNT', 'This will permanently delete everything. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete Account', style: 'destructive', onPress: () => Alert.alert('🚨 FINAL WARNING', 'Are you absolutely sure?', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Yes, Delete Everything', style: 'destructive', onPress: async () => {
          setDeleting(true);
          try {
            for (const col of ['likes', 'chats', 'ratings', 'reports', 'blockedUsers']) {
              const snap = await getDocs(collection(db, col));
              for (const d of snap.docs) {
                const dt = d.data() as Record<string, unknown>;
                if (Object.values(dt).some(v => typeof v === 'string' && v.includes(user.uid))) {
                  await deleteDoc(doc(db, col, d.id));
                }
              }
            }
            await deleteDoc(doc(db, 'users', user.uid));
            await deleteUser(user);
            Alert.alert('Deleted', 'Account deleted. Goodbye! 👋');
            router.replace('/');
          } catch (e: unknown) {
            const code = (e as { code?: string })?.code;
            const msg = (e as { message?: string })?.message ?? 'Unknown error';
            if (code === 'auth/requires-recent-login') Alert.alert('Security', 'Please log out and back in, then try again.');
            else Alert.alert('Error', msg);
          } finally { setDeleting(false); }
        }},
      ])},
    ]);
  }, [user, router]);

  const verificationStatus = useMemo(() => {
    if (selfieVerified && (userData?.ratings?.trustScore ?? 0) >= 75) return { level: 'Trusted', color: '#f1c40f' };
    if (selfieVerified) return { level: 'Verified', color: '#3498db' };
    return { level: 'Basic', color: '#888' };
  }, [selfieVerified, userData?.ratings?.trustScore]);

  const videoAgeText = useMemo(() => getVideoAge(videoUploadedAt), [videoUploadedAt]);
  const videoIsOld = useMemo(() => isVideoOld(videoUploadedAt), [videoUploadedAt]);
  const heightBadge = useMemo(() => getHtBadge(heightMethod), [heightMethod]);

  // Verification items typed properly
  const verificationItems: Array<[string, boolean]> = [
    ['Identity Verified', selfieVerified],
    ['Height Verified', heightVerified],
    ['Age Verified', ageVerified],
  ];

  // Beliefs sections
  const beliefsSections: Array<[string, OptionItem[], string, (v: string) => void]> = [
    ['Religious Views', RELIGIOUS_OPTIONS, religiousViews, setReligiousViews],
    ['Lifestyle', LIFESTYLE_OPTIONS, lifestyle, setLifestyle],
    ['Relationship Goal', RELATIONSHIP_OPTIONS, relationshipGoal, setRelationshipGoal],
  ];

  if (loading) return <View style={styles.loadingContainer}><ActivityIndicator size="large" color="#53a8b6" /><Text style={styles.loadingText}>Loading profile...</Text></View>;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Edit Profile</Text>

      {/* Verification */}
      <View style={styles.verificationCard}>
        <Text style={styles.verificationTitle}>Verification Status</Text>
        <View style={[styles.verificationBadge, { backgroundColor: verificationStatus.color }]}>
          <Text style={styles.verificationBadgeText}>{verificationStatus.level}</Text>
        </View>
        <View style={styles.verificationItems}>
          {verificationItems.map(([label, done]) => (
            <View key={label} style={styles.verificationItem}>
              <Text style={styles.verificationItemIcon}>{done ? '✓' : '○'}</Text>
              <Text style={[styles.verificationItemText, done && styles.verificationItemDone]}>{label}</Text>
            </View>
          ))}
        </View>
        <View style={styles.trustScoreSection}>
          <TrustScoreDisplay ratings={userData?.ratings} selfieVerified={selfieVerified} ageVerified={ageVerified} heightVerified={heightVerified} size="large" />
        </View>
        {!selfieVerified
          ? <TouchableOpacity style={styles.verifySelfieButton} onPress={() => router.push('/selfie-verification')} accessibilityLabel="Verify your identity" accessibilityRole="button"><Text style={styles.verifySelfieButtonText}>Verify Your Identity</Text></TouchableOpacity>
          : <Text style={styles.verifiedNote}>Your identity has been verified ✓</Text>}
      </View>

      <TouchableOpacity style={styles.previewButton} onPress={() => router.push({ pathname: '/profile-preview', params: { userId: user!.uid } })} accessibilityLabel="Preview your profile as others see it" accessibilityRole="button">
        <Text style={styles.previewButtonIcon}>👁️</Text>
        <View style={styles.previewButtonTextContainer}>
          <Text style={styles.previewButtonText}>Preview Your Profile</Text>
          <Text style={styles.previewButtonSubtext}>See how others see you</Text>
        </View>
        <Text style={styles.previewButtonArrow}>→</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.socialButton} onPress={() => router.push('/social-verification')} accessibilityLabel="Link social media accounts" accessibilityRole="button">
        <Text style={styles.socialButtonText}>🔗 Link Social Media</Text>
      </TouchableOpacity>

      {/* Photos */}
      <Text style={styles.sectionTitle}>📷 Photos</Text>
      <Text style={styles.hint}>CAMERA ONLY — photos are scanned for inappropriate content.</Text>
      <View style={styles.photoControlsRow}>
        <TouchableOpacity
          style={[styles.reorderButton, reorderMode && styles.reorderButtonActive]}
          onPress={() => { setReorderMode(!reorderMode); setSelectedPhotoIndex(null); }}
          accessibilityLabel={reorderMode ? 'Done reordering photos' : 'Reorder photos'}
          accessibilityRole="button">
          <Text style={[styles.reorderButtonText, reorderMode && styles.reorderButtonTextActive]}>{reorderMode ? '✓ Done' : '↔️ Reorder'}</Text>
        </TouchableOpacity>
      </View>
      {uploadingPhoto && <View style={styles.uploadingContainer}><ActivityIndicator size="small" color="#53a8b6" /><Text style={styles.uploadingText}>Uploading...</Text></View>}
      <View style={styles.photosContainer}>
        {photos.map((uri, i) => (
          <View key={i} style={styles.photoWrapper}>
            <TouchableOpacity
              onPress={() => handlePhotoTap(i)}
              style={[styles.photoTouchable, reorderMode && styles.photoReorderMode, selectedPhotoIndex === i && styles.photoSelected]}
              accessibilityLabel={`Photo ${i + 1}${i === 0 ? ', main photo' : ''}${reorderMode ? '. Tap to select for reordering.' : ''}`}
              accessibilityRole="button">
              <Image source={{ uri }} style={styles.photo} accessibilityLabel={`Profile photo ${i + 1}`} />
              {i === 0 && <View style={styles.primaryBadge}><Text style={styles.primaryBadgeText}>Main</Text></View>}
              {reorderMode && <View style={styles.photoIndexBadge}><Text style={styles.photoIndexText}>{i + 1}</Text></View>}
            </TouchableOpacity>
            {reorderMode && (
              <View style={styles.reorderArrows}>
                {i > 0 && <TouchableOpacity style={styles.arrowButton} onPress={() => moveLeft(i)} accessibilityLabel="Move photo left" accessibilityRole="button"><Text style={styles.arrowText}>←</Text></TouchableOpacity>}
                {i < photos.length - 1 && <TouchableOpacity style={styles.arrowButton} onPress={() => moveRight(i)} accessibilityLabel="Move photo right" accessibilityRole="button"><Text style={styles.arrowText}>→</Text></TouchableOpacity>}
              </View>
            )}
            {!reorderMode && <TouchableOpacity style={styles.removeButton} onPress={() => removePhoto(i)} accessibilityLabel={`Remove photo ${i + 1}`} accessibilityRole="button"><Text style={styles.removeButtonText}>✕</Text></TouchableOpacity>}
          </View>
        ))}
        {photos.length < MAX_PHOTOS && !reorderMode && (
          <TouchableOpacity style={styles.addPhotoButton} onPress={() => void openCamera()} accessibilityLabel="Add a new photo" accessibilityRole="button">
            <Text style={styles.addPhotoIcon}>📷</Text>
            <Text style={styles.addPhotoText}>Add Photo</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Video */}
      <Text style={styles.sectionTitle}>🎥 Video Profile</Text>
      {videoProfile ? (
        <View style={styles.videoContainer}>
          <View style={styles.videoHeader}>
            <Text style={styles.videoLabel}>Your Video</Text>
            {videoIsOld && <View style={styles.videoOldBadge}><Text style={styles.videoOldBadgeText}>⚠️ Outdated</Text></View>}
          </View>
          <TouchableOpacity style={styles.videoPreview} onPress={handleToggleVideo} accessibilityLabel={playingVideo ? 'Pause video' : 'Play video preview'} accessibilityRole="button">
            {playingVideo
              ? <VideoView player={videoPlayer} style={styles.videoPlayer} contentFit="contain" nativeControls />
              : <View style={styles.videoThumbnail}><Text style={styles.videoPlayIcon}>▶️</Text><Text style={styles.videoTapText}>Tap to preview</Text></View>}
          </TouchableOpacity>
          <Text style={styles.videoDate}>Uploaded {videoAgeText}</Text>
          {videoIsOld && <Text style={styles.videoOldWarning}>Over 6 months old. Consider re-recording!</Text>}
          <View style={styles.videoButtons}>
            <TouchableOpacity style={styles.recordVideoButton} onPress={() => router.push('/video-profile-recorder')} accessibilityLabel="Re-record video profile" accessibilityRole="button"><Text style={styles.recordVideoText}>🔄 Re-record</Text></TouchableOpacity>
            <TouchableOpacity style={styles.deleteVideoButton} onPress={handleDeleteVideo} disabled={deletingVideo} accessibilityLabel="Delete video profile" accessibilityRole="button">{deletingVideo ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.deleteVideoText}>🗑️ Delete</Text>}</TouchableOpacity>
          </View>
        </View>
      ) : (
        <TouchableOpacity style={styles.addVideoButton} onPress={() => router.push('/video-profile-recorder')} accessibilityLabel="Record a video profile" accessibilityRole="button">
          <Text style={styles.addVideoIcon}>🎬</Text>
          <Text style={styles.addVideoText}>Record Video Profile</Text>
          <Text style={styles.addVideoSubtext}>15 seconds to introduce yourself</Text>
        </TouchableOpacity>
      )}

      {/* Icebreaker */}
      <Text style={styles.sectionTitle}>💬 Icebreaker</Text>
      <TouchableOpacity style={styles.promptSelector} onPress={() => setShowPromptPicker(true)} accessibilityLabel={selectedPrompt || 'Choose a prompt'} accessibilityRole="button">
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
            onChangeText={t => setIcebreaker(t.slice(0, MAX_ICE))}
            multiline
            accessibilityLabel={`Answer to: ${selectedPrompt}`}
          />
          <Text style={styles.charCount}>{icebreaker.length}/{MAX_ICE}</Text>
        </>
      )}

      {/* Basic Info */}
      <Text style={styles.sectionTitle}>Basic Info</Text>
      <Text style={styles.label}>First Name</Text>
      <TextInput
        style={[styles.input, nameError && styles.inputError]}
        value={name}
        onChangeText={handleNameChange}
        onBlur={() => { if (name) { const r = validateDisplayName(name); if (r.valid) setName(name.trim()); } }}
        placeholder="Sarah"
        placeholderTextColor="#666"
        maxLength={20}
        accessibilityLabel="First name"
      />
      {nameError && <Text style={styles.errorText}>{nameError}</Text>}

      <Text style={styles.label}>Age</Text>
      <TextInput style={styles.input} value={age} onChangeText={t => setAge(t.replace(/[^0-9]/g, ''))} placeholder="25" placeholderTextColor="#666" keyboardType="number-pad" maxLength={2} accessibilityLabel="Age" />

      <Text style={styles.label}>Height (cm)</Text>
      <View style={styles.heightRow}>
        <TextInput style={[styles.input, styles.heightInput]} value={height} onChangeText={t => setHeight(t.replace(/[^0-9]/g, ''))} placeholder="170" placeholderTextColor="#666" keyboardType="number-pad" maxLength={3} editable={!heightVerified} accessibilityLabel="Height in centimetres" />
        {heightMethod !== '' && <View style={[styles.heightBadge, heightMethod === 'manual-measured' && styles.heightBadgeVerified]}><Text style={styles.heightBadgeText}>{heightBadge}</Text></View>}
      </View>
      <TouchableOpacity style={styles.verifyHeightButton} onPress={() => router.push('/height-verification')} accessibilityLabel={heightVerified ? 'Re-verify height' : 'Verify height'} accessibilityRole="button">
        <Text style={styles.verifyHeightText}>{heightVerified ? '✓ Re-verify Height' : '📏 Verify Height'}</Text>
      </TouchableOpacity>

      <BodyTypeSelector label="Your Body Type" selectedType={bodyType} onSelect={setBodyType} />
      <BodyTypeSelector label="Body Type Preference" selectedType={lookingFor} onSelect={setLookingFor} showLookingFor />

      <Text style={styles.sectionTitle}>Beliefs and Values</Text>
      {beliefsSections.map(([label, opts, val, setter]) => (
        <View key={label}>
          <Text style={styles.label}>{label}</Text>
          <View style={styles.optionsColumn}>
            {opts.map((o) => (
              <TouchableOpacity
                key={o.value}
                style={[styles.optionRow, val === o.value && styles.optionRowActive]}
                onPress={() => setter(o.value)}
                accessibilityLabel={`${o.value}: ${o.desc}`}
                accessibilityRole="radio"
                accessibilityState={{ checked: val === o.value }}>
                <Text style={[styles.optionRowText, val === o.value && styles.optionRowTextActive]}>{o.value}</Text>
                <Text style={styles.optionRowDesc}>{o.desc}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ))}

      <Text style={styles.sectionTitle}>Location</Text>
      <TouchableOpacity style={styles.locationButton} onPress={() => void handleGetLocation()} disabled={gettingLoc} accessibilityLabel={locationCity ? `Update location, currently ${locationCity}` : 'Update location'} accessibilityRole="button">
        {gettingLoc ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.locationButtonText}>{locationCity ? `📍 ${locationCity}` : '📍 Update Location'}</Text>}
      </TouchableOpacity>

      <Text style={styles.sectionTitle}>About Me</Text>
      <TextInput
        style={styles.bioInput}
        placeholder="Tell people about yourself..."
        placeholderTextColor="#666"
        value={bio}
        onChangeText={handleBioChange}
        multiline
        numberOfLines={4}
        maxLength={MAX_BIO}
        accessibilityLabel="Bio"
        accessibilityHint="Describe yourself in a few sentences"
      />
      {bioError ? <Text style={styles.errorText}>{bioError}</Text> : <Text style={styles.charCount}>{bio.length}/{MAX_BIO}</Text>}

      <Text style={styles.sectionTitle}>Personality</Text>
      <View style={styles.personalityRow}>
        <Text style={styles.personalityLabel}>Current: <Text style={styles.personalityValue}>{personalityType || 'Not taken'}</Text></Text>
        <TouchableOpacity style={styles.retakeButton} onPress={() => router.push('/personality-quiz')} accessibilityLabel="Retake personality quiz" accessibilityRole="button">
          <Text style={styles.retakeText}>Retake Quiz</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        style={[styles.saveButton, saving && styles.saveButtonDisabled]}
        onPress={() => void handleSave()}
        disabled={saving || uploadingPhoto}
        accessibilityLabel={saving ? 'Saving changes' : 'Save changes'}
        accessibilityRole="button"
        accessibilityState={{ disabled: saving || uploadingPhoto, busy: saving }}>
        <Text style={styles.saveButtonText}>{saving ? 'Saving...' : '✓ Save Changes'}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.cancelButton} onPress={() => router.back()} accessibilityLabel="Cancel editing" accessibilityRole="button">
        <Text style={styles.cancelButtonText}>Cancel</Text>
      </TouchableOpacity>

      <View style={styles.legalSection}>
        <TouchableOpacity onPress={() => router.push('/privacy')} accessibilityLabel="Privacy Policy" accessibilityRole="link"><Text style={styles.legalLink}>Privacy Policy</Text></TouchableOpacity>
        <Text style={styles.legalDivider}>•</Text>
        <TouchableOpacity onPress={() => router.push('/terms')} accessibilityLabel="Terms of Service" accessibilityRole="link"><Text style={styles.legalLink}>Terms of Service</Text></TouchableOpacity>
      </View>

      <View style={styles.dangerZone}>
        <Text style={styles.dangerZoneTitle}>⚠️ Danger Zone</Text>
        <Text style={styles.dangerZoneText}>Permanently delete your account. This cannot be undone.</Text>
        <TouchableOpacity
          style={[styles.deleteAccountButton, deleting && styles.deleteAccountButtonDisabled]}
          onPress={handleDeleteAccount}
          disabled={deleting}
          accessibilityLabel={deleting ? 'Deleting account' : 'Delete my account'}
          accessibilityRole="button"
          accessibilityState={{ disabled: deleting, busy: deleting }}>
          <Text style={styles.deleteAccountButtonText}>{deleting ? 'Deleting...' : '🗑️ Delete My Account'}</Text>
        </TouchableOpacity>
      </View>

      {/* Camera Modal */}
      <Modal visible={cameraOpen} animationType="slide" onRequestClose={closeCamera}>
        <View style={styles.cameraModal}>
          <Text style={styles.cameraTitle}>Take Photo</Text>
          {IS_WEB ? (
            <View style={styles.camBox}>
              {camError
                ? <View style={styles.camErrorBox}><Text style={styles.camErrorText}>{camError}</Text><TouchableOpacity style={styles.retryBtn} onPress={() => void startWebCam()} accessibilityLabel="Retry camera" accessibilityRole="button"><Text style={styles.retryBtnText}>Retry</Text></TouchableOpacity></View>
                : !webCamReady
                  ? <View style={styles.loadingBox}><ActivityIndicator size="large" color="#53a8b6" /><Text style={styles.loadingTextCam}>Starting camera...</Text></View>
                  : null}
              <View style={webCamReady ? styles.videoBox : styles.hidden}>
                {IS_WEB && React.createElement('video', { id: 'edit-profile-camera', autoPlay: true, playsInline: true, muted: true, style: { width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' } })}
              </View>
            </View>
          ) : (
            <View style={styles.camBox}><CameraView ref={cameraRef} style={styles.nativeCam} facing="front" /></View>
          )}
          <View style={styles.cameraControls}>
            <TouchableOpacity
              style={[styles.captureBtn, IS_WEB && !webCamReady && styles.disabled]}
              onPress={() => void capturePhoto()}
              disabled={IS_WEB && !webCamReady}
              accessibilityLabel="Take photo"
              accessibilityRole="button"
              accessibilityState={{ disabled: IS_WEB && !webCamReady }}>
              <View style={styles.captureBtnInner} />
            </TouchableOpacity>
          </View>
          <TouchableOpacity style={styles.closeCamBtn} onPress={closeCamera} accessibilityLabel="Cancel camera" accessibilityRole="button">
            <Text style={styles.closeCamBtnText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* Prompt Picker Modal */}
      <Modal visible={showPromptPicker} animationType="slide" transparent onRequestClose={() => setShowPromptPicker(false)}>
        <View style={styles.promptModalOverlay}>
          <View style={styles.promptModal}>
            <Text style={styles.promptModalTitle}>Choose a Prompt</Text>
            <ScrollView style={styles.promptList}>
              {ICEBREAKER_PROMPTS.map((p, i) => (
                <TouchableOpacity
                  key={i}
                  style={[styles.promptOption, selectedPrompt === p && styles.promptOptionActive]}
                  onPress={() => { setSelectedPrompt(p); setShowPromptPicker(false); }}
                  accessibilityLabel={p}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selectedPrompt === p }}>
                  <Text style={[styles.promptOptionText, selectedPrompt === p && styles.promptOptionTextActive]}>{p}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity style={styles.promptModalClose} onPress={() => setShowPromptPicker(false)} accessibilityLabel="Cancel" accessibilityRole="button">
              <Text style={styles.promptModalCloseText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container:{flex:1,backgroundColor:'#1a1a2e'},content:{padding:20,paddingBottom:50},loadingContainer:{flex:1,backgroundColor:'#1a1a2e',justifyContent:'center',alignItems:'center'},loadingText:{color:'#aaa',marginTop:15,fontSize:16},title:{fontSize:28,fontWeight:'bold',color:'#eee',marginTop:20,marginBottom:20,textAlign:'center'},
  verificationCard:{backgroundColor:'#16213e',borderRadius:15,padding:20,marginBottom:25,borderWidth:1,borderColor:'#0f3460'},verificationTitle:{fontSize:16,fontWeight:'600',color:'#eee',marginBottom:15,textAlign:'center'},verificationBadge:{alignSelf:'center',paddingVertical:6,paddingHorizontal:20,borderRadius:15,marginBottom:15},verificationBadgeText:{color:'#fff',fontSize:14,fontWeight:'bold'},verificationItems:{marginBottom:15},verificationItem:{flexDirection:'row',alignItems:'center',marginBottom:8},verificationItemIcon:{fontSize:16,color:'#53a8b6',marginRight:10,width:20,textAlign:'center'},verificationItemText:{color:'#888',fontSize:14},verificationItemDone:{color:'#5cb85c'},trustScoreSection:{marginTop:15,marginBottom:15,paddingTop:15,borderTopWidth:1,borderTopColor:'#0f3460'},verifySelfieButton:{backgroundColor:'#3498db',paddingVertical:12,borderRadius:20,alignItems:'center'},verifySelfieButtonText:{color:'#fff',fontSize:14,fontWeight:'600'},verifiedNote:{color:'#5cb85c',fontSize:13,textAlign:'center',fontStyle:'italic'},
  previewButton:{flexDirection:'row',alignItems:'center',backgroundColor:'#16213e',borderRadius:15,padding:16,marginBottom:20,borderWidth:2,borderColor:'#9b59b6'},previewButtonIcon:{fontSize:28,marginRight:12},previewButtonTextContainer:{flex:1},previewButtonText:{color:'#9b59b6',fontSize:16,fontWeight:'bold',marginBottom:2},previewButtonSubtext:{color:'#888',fontSize:12},previewButtonArrow:{color:'#9b59b6',fontSize:20,fontWeight:'bold'},
  socialButton:{backgroundColor:'#0f3460',paddingVertical:15,borderRadius:12,alignItems:'center',marginBottom:15},socialButtonText:{color:'#53a8b6',fontSize:16,fontWeight:'600'},
  sectionTitle:{fontSize:18,fontWeight:'bold',color:'#53a8b6',marginTop:25,marginBottom:10},hint:{fontSize:12,color:'#888',marginBottom:8,fontStyle:'italic'},label:{fontSize:14,color:'#ccc',marginBottom:8,marginTop:12},input:{backgroundColor:'#16213e',color:'#fff',padding:15,borderRadius:10,fontSize:16},inputError:{borderWidth:1,borderColor:'#d9534f'},errorText:{color:'#d9534f',fontSize:12,marginTop:5},
  photoControlsRow:{flexDirection:'row',marginBottom:10},reorderButton:{backgroundColor:'#0f3460',paddingVertical:10,paddingHorizontal:15,borderRadius:20},reorderButtonActive:{backgroundColor:'#5cb85c'},reorderButtonText:{color:'#53a8b6',fontSize:13,fontWeight:'600'},reorderButtonTextActive:{color:'#fff'},uploadingContainer:{flexDirection:'row',alignItems:'center',backgroundColor:'#16213e',padding:12,borderRadius:10,marginBottom:10},uploadingText:{color:'#53a8b6',marginLeft:10,fontSize:14},photosContainer:{flexDirection:'row',flexWrap:'wrap',gap:10},photoWrapper:{position:'relative'},photoTouchable:{borderRadius:10,overflow:'hidden'},photoReorderMode:{borderWidth:2,borderColor:'#53a8b6',borderStyle:'dashed'},photoSelected:{borderColor:'#5cb85c',borderStyle:'solid',borderWidth:3},photo:{width:100,height:130,borderRadius:10},primaryBadge:{position:'absolute',bottom:5,left:5,backgroundColor:'#5cb85c',paddingVertical:2,paddingHorizontal:6,borderRadius:8},primaryBadgeText:{color:'#fff',fontSize:10,fontWeight:'bold'},photoIndexBadge:{position:'absolute',top:5,left:5,backgroundColor:'#53a8b6',width:24,height:24,borderRadius:12,justifyContent:'center',alignItems:'center'},photoIndexText:{color:'#fff',fontSize:12,fontWeight:'bold'},reorderArrows:{flexDirection:'row',justifyContent:'center',gap:5,marginTop:5},arrowButton:{backgroundColor:'#0f3460',paddingVertical:5,paddingHorizontal:10,borderRadius:10},arrowText:{color:'#53a8b6',fontSize:16,fontWeight:'bold'},removeButton:{position:'absolute',top:-8,right:-8,backgroundColor:'#d9534f',borderRadius:15,width:26,height:26,justifyContent:'center',alignItems:'center'},removeButtonText:{color:'#fff',fontSize:14,fontWeight:'bold'},addPhotoButton:{width:100,height:130,borderRadius:10,borderWidth:2,borderColor:'#53a8b6',borderStyle:'dashed',justifyContent:'center',alignItems:'center'},addPhotoIcon:{fontSize:24,marginBottom:5},addPhotoText:{color:'#53a8b6',fontSize:12},
  videoContainer:{backgroundColor:'#16213e',borderRadius:15,padding:15,marginBottom:10},videoHeader:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginBottom:12},videoLabel:{color:'#53a8b6',fontSize:14,fontWeight:'600'},videoOldBadge:{backgroundColor:'#e67e22',paddingVertical:4,paddingHorizontal:10,borderRadius:10},videoOldBadgeText:{color:'#fff',fontSize:11,fontWeight:'600'},videoPreview:{backgroundColor:'#0f3460',borderRadius:12,overflow:'hidden',marginBottom:10,minHeight:200},videoPlayer:{width:'100%',height:200},videoThumbnail:{height:200,justifyContent:'center',alignItems:'center'},videoPlayIcon:{fontSize:50,marginBottom:10},videoTapText:{color:'#888',fontSize:14},videoDate:{color:'#888',fontSize:12,textAlign:'center',marginBottom:10},videoOldWarning:{color:'#e67e22',fontSize:12,textAlign:'center',marginBottom:12,fontStyle:'italic'},videoButtons:{flexDirection:'row',gap:10},recordVideoButton:{flex:1,backgroundColor:'#e67e22',paddingVertical:12,borderRadius:20,alignItems:'center'},recordVideoText:{color:'#fff',fontSize:14,fontWeight:'600'},deleteVideoButton:{backgroundColor:'#d9534f',paddingVertical:12,paddingHorizontal:20,borderRadius:20,alignItems:'center',justifyContent:'center'},deleteVideoText:{color:'#fff',fontSize:14,fontWeight:'600'},addVideoButton:{backgroundColor:'#16213e',borderRadius:15,padding:25,alignItems:'center',borderWidth:2,borderColor:'#e67e22',borderStyle:'dashed'},addVideoIcon:{fontSize:40,marginBottom:10},addVideoText:{color:'#e67e22',fontSize:16,fontWeight:'600',marginBottom:5},addVideoSubtext:{color:'#888',fontSize:12},
  promptSelector:{backgroundColor:'#16213e',padding:15,borderRadius:10,flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginBottom:10},promptSelectorText:{color:'#aaa',fontSize:14,flex:1},promptSelectorArrow:{color:'#53a8b6',fontSize:14},icebreakerInput:{backgroundColor:'#16213e',color:'#fff',padding:15,borderRadius:10,fontSize:16,height:80,textAlignVertical:'top'},
  optionsColumn:{gap:10},optionRow:{backgroundColor:'#16213e',padding:15,borderRadius:12,borderWidth:2,borderColor:'#16213e'},optionRowActive:{backgroundColor:'#0f3460',borderColor:'#53a8b6'},optionRowText:{color:'#eee',fontSize:16,fontWeight:'600',marginBottom:4},optionRowTextActive:{color:'#53a8b6'},optionRowDesc:{color:'#888',fontSize:12},
  heightRow:{flexDirection:'row',alignItems:'center',gap:10},heightInput:{flex:1},heightBadge:{backgroundColor:'#0f3460',paddingVertical:8,paddingHorizontal:12,borderRadius:15},heightBadgeVerified:{backgroundColor:'#1a5c3a'},heightBadgeText:{color:'#5cb85c',fontSize:12,fontWeight:'600'},verifyHeightButton:{backgroundColor:'#0f3460',paddingVertical:12,paddingHorizontal:20,borderRadius:20,marginTop:10,alignItems:'center'},verifyHeightText:{color:'#53a8b6',fontSize:14,fontWeight:'600'},
  locationButton:{backgroundColor:'#0f3460',paddingVertical:15,borderRadius:10,alignItems:'center'},locationButtonText:{color:'#53a8b6',fontSize:16,fontWeight:'600'},bioInput:{backgroundColor:'#16213e',color:'#fff',padding:15,borderRadius:10,fontSize:16,height:100,textAlignVertical:'top'},charCount:{color:'#666',fontSize:12,textAlign:'right',marginTop:5},
  personalityRow:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',backgroundColor:'#16213e',padding:15,borderRadius:10},personalityLabel:{color:'#aaa',fontSize:14},personalityValue:{color:'#e67e22',fontWeight:'bold'},retakeButton:{backgroundColor:'#0f3460',paddingVertical:8,paddingHorizontal:15,borderRadius:15},retakeText:{color:'#53a8b6',fontSize:13,fontWeight:'600'},
  saveButton:{backgroundColor:'#5cb85c',paddingVertical:16,borderRadius:25,marginTop:30,alignItems:'center'},saveButtonDisabled:{backgroundColor:'#555'},saveButtonText:{color:'#fff',fontSize:18,fontWeight:'600'},cancelButton:{paddingVertical:12,marginTop:10,alignItems:'center'},cancelButtonText:{color:'#d9534f',fontSize:16},
  legalSection:{flexDirection:'row',justifyContent:'center',alignItems:'center',marginTop:30,gap:10},legalLink:{color:'#53a8b6',fontSize:14,textDecorationLine:'underline'},legalDivider:{color:'#666',fontSize:14},
  dangerZone:{marginTop:40,padding:20,backgroundColor:'rgba(217,83,79,0.1)',borderRadius:15,borderWidth:2,borderColor:'#d9534f'},dangerZoneTitle:{color:'#d9534f',fontSize:18,fontWeight:'bold',marginBottom:8},dangerZoneText:{color:'#888',fontSize:13,marginBottom:15,lineHeight:20},deleteAccountButton:{backgroundColor:'#d9534f',paddingVertical:14,borderRadius:20,alignItems:'center'},deleteAccountButtonDisabled:{backgroundColor:'#555'},deleteAccountButtonText:{color:'#fff',fontSize:16,fontWeight:'600'},
  cameraModal:{flex:1,backgroundColor:'#1a1a2e',justifyContent:'center',alignItems:'center',padding:20},cameraTitle:{fontSize:22,fontWeight:'bold',color:'#eee',marginBottom:20},camBox:{width:300,height:400,borderRadius:20,overflow:'hidden',backgroundColor:'#000',borderWidth:3,borderColor:'#53a8b6',marginBottom:20},nativeCam:{width:'100%',height:'100%'},videoBox:{width:'100%',height:'100%'},hidden:{width:0,height:0,overflow:'hidden'},camErrorBox:{flex:1,justifyContent:'center',alignItems:'center',padding:20},camErrorText:{color:'#ff6b6b',fontSize:14,textAlign:'center',marginBottom:15},loadingBox:{flex:1,justifyContent:'center',alignItems:'center'},loadingTextCam:{color:'#888',marginTop:10},cameraControls:{alignItems:'center',marginBottom:20},captureBtn:{width:70,height:70,borderRadius:35,backgroundColor:'#fff',justifyContent:'center',alignItems:'center',borderWidth:4,borderColor:'#53a8b6'},captureBtnInner:{width:54,height:54,borderRadius:27,backgroundColor:'#53a8b6'},disabled:{opacity:0.5},closeCamBtn:{padding:12},closeCamBtnText:{color:'#d9534f',fontSize:16},retryBtn:{backgroundColor:'#e67e22',paddingVertical:12,paddingHorizontal:30,borderRadius:20},retryBtnText:{color:'#fff',fontSize:14,fontWeight:'600'},
  promptModalOverlay:{flex:1,backgroundColor:'rgba(0,0,0,0.8)',justifyContent:'flex-end'},promptModal:{backgroundColor:'#1a1a2e',borderTopLeftRadius:20,borderTopRightRadius:20,padding:20,maxHeight:'70%'},promptModalTitle:{color:'#eee',fontSize:18,fontWeight:'bold',textAlign:'center',marginBottom:15},promptList:{marginBottom:15},promptOption:{backgroundColor:'#16213e',padding:15,borderRadius:10,marginBottom:10},promptOptionActive:{backgroundColor:'#0f3460',borderWidth:2,borderColor:'#53a8b6'},promptOptionText:{color:'#aaa',fontSize:14},promptOptionTextActive:{color:'#53a8b6',fontWeight:'600'},promptModalClose:{paddingVertical:12,alignItems:'center'},promptModalCloseText:{color:'#d9534f',fontSize:16},
});