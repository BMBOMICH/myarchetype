import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { deleteUser, EmailAuthProvider, reauthenticateWithCredential, signOut } from 'firebase/auth';
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { auth, db } from '../firebaseConfig';
import { Language, languageNames, SUPPORTED_LANGUAGES } from '../utils/i18n';
import { useLanguage } from '../utils/languageContext';

export default function SettingsScreen() {
  const router = useRouter();
  const { language, setLanguage, t } = useLanguage();
  const user = auth.currentUser;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Notification settings
  const [notifyMatches, setNotifyMatches] = useState(true);
  const [notifyMessages, setNotifyMessages] = useState(true);
  const [notifyLikes, setNotifyLikes] = useState(true);
  const [notifyProfileViews, setNotifyProfileViews] = useState(true);

  // Privacy settings
  const [showOnlineStatus, setShowOnlineStatus] = useState(true);
  const [showLastSeen, setShowLastSeen] = useState(true);
  const [showProfileViews, setShowProfileViews] = useState(true);

  // Modals
  const [showLanguageModal, setShowLanguageModal] = useState(false);
  const [showBugReportModal, setShowBugReportModal] = useState(false);
  const [showDonationModal, setShowDonationModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  // Bug report
  const [bugTitle, setBugTitle] = useState('');
  const [bugDescription, setBugDescription] = useState('');
  const [submittingBug, setSubmittingBug] = useState(false);

  // Delete account
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteError, setDeleteError] = useState('');

  // Referral info
  const [referralCode, setReferralCode] = useState('');
  const [referralCount, setReferralCount] = useState(0);

  // ── Load settings ──────────────────────────────────────
  useEffect(() => {
    loadSettings();
  }, []);

  const generateReferralCode = useCallback((uid: string): string => {
    return `MA${uid.substring(0, 6).toUpperCase()}`;
  }, []);

  const loadSettings = useCallback(async () => {
    if (!user) {
      router.replace('/login');
      return;
    }

    // ✅ Verify account still exists
    try {
      await user.reload();
    } catch (error: any) {
      console.log('[Settings] Account no longer valid:', error.code);
      await auth.signOut().catch(() => {});
      router.replace('/login');
      return;
    }

    try {
      const userDoc = await getDoc(doc(db, 'users', user.uid));
      if (userDoc.exists()) {
        const data = userDoc.data();

        // Notification settings
        setNotifyMatches(data.notifyMatches !== false);
        setNotifyMessages(data.notifyMessages !== false);
        setNotifyLikes(data.notifyLikes !== false);
        setNotifyProfileViews(data.notifyProfileViews !== false);

        // Privacy settings
        setShowOnlineStatus(data.showOnlineStatus !== false);
        setShowLastSeen(data.showLastSeen !== false);
        setShowProfileViews(data.showProfileViews !== false);

        // Referral
        setReferralCode(data.referralCode || generateReferralCode(user.uid));
        setReferralCount(data.referralCount || 0);
      }

      // Load saved language
      const savedLang = await AsyncStorage.getItem('app_language');
      if (savedLang) {
        setLanguage(savedLang as Language);
      }
    } catch (error: any) {
      if (error?.code === 'permission-denied') return;
      console.error('[Settings] loadSettings error:', error);
    } finally {
      setLoading(false);
    }
  }, [user, router, generateReferralCode, setLanguage]);

  // ── Save settings ──────────────────────────────────────
  const saveSettings = useCallback(async () => {
    if (!user) return;

    setSaving(true);
    try {
      await updateDoc(doc(db, 'users', user.uid), {
        notifyMatches,
        notifyMessages,
        notifyLikes,
        notifyProfileViews,
        showOnlineStatus,
        showLastSeen,
        showProfileViews,
        referralCode,
        updatedAt: new Date().toISOString(),
      });

      Alert.alert(t.success, 'Settings saved!');
    } catch (error: any) {
      if (error?.code === 'permission-denied') {
        Alert.alert('Error', 'Permission denied. Please log in again.');
        return;
      }
      console.error('[Settings] saveSettings error:', error);
      Alert.alert(t.error, 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  }, [
    user,
    notifyMatches,
    notifyMessages,
    notifyLikes,
    notifyProfileViews,
    showOnlineStatus,
    showLastSeen,
    showProfileViews,
    referralCode,
    t,
  ]);

// ── Delete account ─────────────────────────────────────
const handleDeleteAccount = useCallback(() => {
  const currentUser = auth.currentUser;

  if (!currentUser) {
    Alert.alert('Error', 'Not logged in. Please log in again.');
    router.replace('/login');
    return;
  }

  console.log('[Settings] Delete pressed, user:', currentUser.uid);

  // ✅ On web, Alert.alert doesn't work — open modal directly
  if (typeof window !== 'undefined') {
    setDeletePassword('');
    setDeleteError('');
    setShowDeleteModal(true);
    return;
  }

  // Native — use Alert as normal
  Alert.alert(
    '⚠️ Delete Account',
    'Are you sure? This will permanently delete your account and ALL your data.\n\nThis cannot be undone.',
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Continue',
        style: 'destructive',
        onPress: () => {
          setDeletePassword('');
          setDeleteError('');
          setShowDeleteModal(true);
        },
      },
    ]
  );
}, [router]);

const executeDeleteAccount = useCallback(async () => {
  if (!deletePassword.trim()) {
    setDeleteError('Password is required');
    return;
  }

  // ✅ Get fresh user reference inside handler
  const currentUser = auth.currentUser;

  if (!currentUser) {
    Alert.alert('Error', 'Session expired. Please log in again.');
    router.replace('/login');
    return;
  }

  setDeleting(true);
  setShowDeleteModal(false);

  try {
    console.log('[Settings] Re-authenticating...');

    // ✅ Step 1 — Re-authenticate with password
    const credential = EmailAuthProvider.credential(
      currentUser.email!,
      deletePassword
    );
    await reauthenticateWithCredential(currentUser, credential);

    console.log('[Settings] Re-auth success, deleting...');

    // ✅ Step 2 — Delete Firestore user document
    await deleteDoc(doc(db, 'users', currentUser.uid)).catch(() => {});

    // ✅ Step 3 — Delete Firebase Auth account
    await deleteUser(currentUser);

    console.log('[Settings] Account deleted successfully!');

    // ✅ Step 4 — Redirect to login
    Alert.alert(
      '✅ Account Deleted',
      'Your account has been permanently deleted.'
    );
    router.replace('/login');

  } catch (error: any) {
    console.error('[Settings] deleteAccount error:', error.code);
    setDeleting(false);

    if (
      error.code === 'auth/wrong-password' ||
      error.code === 'auth/invalid-credential'
    ) {
      Alert.alert('❌ Wrong Password', 'Incorrect password. Please try again.');
    } else if (error.code === 'auth/too-many-requests') {
      Alert.alert('⏳ Too Many Attempts', 'Please wait a moment and try again.');
    } else if (error.code === 'auth/requires-recent-login') {
      Alert.alert(
        '🔐 Session Expired',
        'Please log out and log back in, then try again.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Log Out',
            onPress: async () => {
              await signOut(auth).catch(() => {});
              router.replace('/login');
            },
          },
        ]
      );
    } else {
      Alert.alert('Error', 'Failed to delete account: ' + error.code);
    }
  }
}, [deletePassword, router]);

  // ── Language ───────────────────────────────────────────
  const handleLanguageChange = useCallback(async (lang: Language) => {
    await setLanguage(lang);
    setShowLanguageModal(false);
  }, [setLanguage]);

  // ── Referral ───────────────────────────────────────────
  const handleCopyReferralCode = useCallback(async () => {
    await Clipboard.setStringAsync(referralCode);
    Alert.alert(t.success, 'Referral code copied!');
  }, [referralCode, t]);

  const handleShareReferralCode = useCallback(async () => {
    const message =
      `Join me on MyArchetype - the 100% free dating app for genuine connections!\n` +
      `Use my code: ${referralCode}\n\nDownload: https://myarchetype.app`;
    await Clipboard.setStringAsync(message);
    Alert.alert(t.success, 'Share message copied to clipboard!');
  }, [referralCode, t]);

  // ── Bug report ─────────────────────────────────────────
  const handleSubmitBugReport = useCallback(async () => {
    if (!bugTitle.trim() || !bugDescription.trim()) {
      Alert.alert(t.error, 'Please fill in all fields');
      return;
    }

    if (!user) return;

    setSubmittingBug(true);
    try {
      await setDoc(doc(db, 'bugReports', `${user.uid}_${Date.now()}`), {
        userId: user.uid,
        userEmail: user.email,
        title: bugTitle.trim(),
        description: bugDescription.trim(),
        platform: typeof window !== 'undefined' ? 'web' : 'mobile',
        appVersion: '1.0.0',
        createdAt: new Date().toISOString(),
        status: 'new',
      });

      Alert.alert(
        t.success,
        'Bug report submitted. Thank you for helping improve MyArchetype!'
      );
      setBugTitle('');
      setBugDescription('');
      setShowBugReportModal(false);
    } catch (error: any) {
      console.error('[Settings] submitBugReport error:', error);
      Alert.alert(t.error, 'Failed to submit bug report');
    } finally {
      setSubmittingBug(false);
    }
  }, [bugTitle, bugDescription, user, t]);

  // ── Donations ──────────────────────────────────────────
  const openDonationLink = useCallback((platform: string) => {
    const links: Record<string, string> = {
      kofi: 'https://ko-fi.com/myarchetype',
      buymeacoffee: 'https://buymeacoffee.com/myarchetype',
      paypal: 'https://paypal.me/myarchetype',
      patreon: 'https://patreon.com/myarchetype',
    };
    Linking.openURL(links[platform] || links.kofi);
  }, []);

  // ── Loading ────────────────────────────────────────────
  if (loading || deleting) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#53a8b6" />
        <Text style={styles.loadingText}>
          {deleting ? 'Deleting account...' : t.loading}
        </Text>
      </View>
    );
  }

  // ── Render ─────────────────────────────────────────────
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>⚙️ {t.settings}</Text>

      {/* ── LANGUAGE ── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t.language}</Text>
        <TouchableOpacity
          style={styles.settingRow}
          onPress={() => setShowLanguageModal(true)}
        >
          <Text style={styles.settingLabel}>{t.language}</Text>
          <View style={styles.settingValue}>
            <Text style={styles.settingValueText}>{languageNames[language]}</Text>
            <Text style={styles.arrow}>▶</Text>
          </View>
        </TouchableOpacity>
      </View>

      {/* ── NOTIFICATIONS ── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t.notifications}</Text>
        {[
          { label: 'New matches', value: notifyMatches, setter: setNotifyMatches },
          { label: 'New messages', value: notifyMessages, setter: setNotifyMessages },
          { label: 'Someone liked you', value: notifyLikes, setter: setNotifyLikes },
          { label: 'Profile views', value: notifyProfileViews, setter: setNotifyProfileViews },
        ].map((item) => (
          <View key={item.label} style={styles.settingRow}>
            <Text style={styles.settingLabel}>{item.label}</Text>
            <Switch
              value={item.value}
              onValueChange={item.setter}
              trackColor={{ false: '#3a3a4e', true: '#53a8b6' }}
              thumbColor={item.value ? '#fff' : '#888'}
            />
          </View>
        ))}
      </View>

      {/* ── PRIVACY ── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t.privacy}</Text>
        {[
          { label: 'Show online status', value: showOnlineStatus, setter: setShowOnlineStatus },
          { label: 'Show last seen', value: showLastSeen, setter: setShowLastSeen },
          { label: 'Show profile views', value: showProfileViews, setter: setShowProfileViews },
        ].map((item) => (
          <View key={item.label} style={styles.settingRow}>
            <Text style={styles.settingLabel}>{item.label}</Text>
            <Switch
              value={item.value}
              onValueChange={item.setter}
              trackColor={{ false: '#3a3a4e', true: '#53a8b6' }}
              thumbColor={item.value ? '#fff' : '#888'}
            />
          </View>
        ))}
      </View>

      {/* ── REFERRAL ── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>🌟 {t.referralProgram}</Text>
        <View style={styles.referralCard}>
          <Text style={styles.referralLabel}>{t.yourReferralCode}</Text>
          <View style={styles.referralCodeBox}>
            <Text style={styles.referralCode}>{referralCode}</Text>
          </View>
          <View style={styles.referralStats}>
            <Text style={styles.referralCount}>{referralCount}</Text>
            <Text style={styles.referralCountLabel}>{t.referralsCount}</Text>
          </View>
          {referralCount >= 10 && (
            <View style={styles.championBadge}>
              <Text style={styles.championBadgeText}>{t.communityChampion}</Text>
            </View>
          )}
          <View style={styles.referralButtons}>
            <TouchableOpacity
              style={styles.referralButton}
              onPress={handleCopyReferralCode}
            >
              <Text style={styles.referralButtonText}>📋 {t.copyCode}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.referralButton, styles.referralButtonPrimary]}
              onPress={handleShareReferralCode}
            >
              <Text style={styles.referralButtonTextPrimary}>📤 {t.shareCode}</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            style={styles.leaderboardLink}
            onPress={() => router.push('/referral-leaderboard')}
          >
            <Text style={styles.leaderboardLinkText}>🏆 View {t.leaderboard}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* ── SUPPORT ── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t.support}</Text>
        <TouchableOpacity
          style={styles.settingRow}
          onPress={() => setShowBugReportModal(true)}
        >
          <Text style={styles.settingLabel}>{t.reportBug}</Text>
          <Text style={styles.arrow}>▶</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.settingRow}
          onPress={() => setShowDonationModal(true)}
        >
          <Text style={styles.settingLabel}>{t.donate}</Text>
          <Text style={styles.arrow}>▶</Text>
        </TouchableOpacity>
      </View>

      {/* ── LEGAL ── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Legal</Text>
        <TouchableOpacity
          style={styles.settingRow}
          onPress={() => router.push('/privacy')}
        >
          <Text style={styles.settingLabel}>{t.privacyPolicy}</Text>
          <Text style={styles.arrow}>▶</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.settingRow}
          onPress={() => router.push('/terms')}
        >
          <Text style={styles.settingLabel}>{t.termsOfService}</Text>
          <Text style={styles.arrow}>▶</Text>
        </TouchableOpacity>
      </View>

      {/* ── ACCOUNT ── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Account</Text>
        <TouchableOpacity
          style={styles.settingRow}
          onPress={() => router.push('/edit-profile')}
        >
          <Text style={styles.settingLabel}>{t.editProfile}</Text>
          <Text style={styles.arrow}>▶</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.settingRow}
          onPress={() => router.push('/blocked-users')}
        >
          <Text style={styles.settingLabel}>{t.blockedUsers}</Text>
          <Text style={styles.arrow}>▶</Text>
        </TouchableOpacity>

        {/* ✅ Fixed delete account button */}
        <TouchableOpacity
          style={[styles.settingRow, styles.dangerRow]}
          onPress={handleDeleteAccount}
          disabled={deleting}
        >
          <Text style={styles.dangerLabel}>{t.deleteAccount}</Text>
          <Text style={styles.arrow}>▶</Text>
        </TouchableOpacity>
      </View>

      {/* ── SAVE BUTTON ── */}
      <TouchableOpacity
        style={[styles.saveButton, saving && styles.saveButtonDisabled]}
        onPress={saveSettings}
        disabled={saving}
      >
        {saving ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.saveButtonText}>✓ {t.save}</Text>
        )}
      </TouchableOpacity>

      <Text style={styles.version}>MyArchetype v1.0.0</Text>

      {/* ── LANGUAGE MODAL ── */}
      <Modal
        visible={showLanguageModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowLanguageModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{t.language}</Text>
            <ScrollView style={styles.languageList}>
              {SUPPORTED_LANGUAGES.map((lang) => (
                <TouchableOpacity
                  key={lang}
                  style={[
                    styles.languageOption,
                    language === lang && styles.languageOptionActive,
                  ]}
                  onPress={() => handleLanguageChange(lang)}
                >
                  <Text
                    style={[
                      styles.languageOptionText,
                      language === lang && styles.languageOptionTextActive,
                    ]}
                  >
                    {languageNames[lang]}
                  </Text>
                  {language === lang && (
                    <Text style={styles.checkmark}>✓</Text>
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity
              style={styles.modalClose}
              onPress={() => setShowLanguageModal(false)}
            >
              <Text style={styles.modalCloseText}>{t.cancel}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── BUG REPORT MODAL ── */}
      <Modal
        visible={showBugReportModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowBugReportModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>🐛 {t.reportBug}</Text>
            <Text style={styles.inputLabel}>Bug Title</Text>
            <TextInput
              style={styles.input}
              placeholder="Brief description of the issue"
              placeholderTextColor="#666"
              value={bugTitle}
              onChangeText={setBugTitle}
              maxLength={100}
            />
            <Text style={styles.inputLabel}>Details</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="What happened? What did you expect? Steps to reproduce..."
              placeholderTextColor="#666"
              value={bugDescription}
              onChangeText={setBugDescription}
              multiline
              numberOfLines={5}
              maxLength={500}
            />
            <Text style={styles.charCount}>{bugDescription.length}/500</Text>
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalButtonCancel}
                onPress={() => {
                  setShowBugReportModal(false);
                  setBugTitle('');
                  setBugDescription('');
                }}
              >
                <Text style={styles.modalButtonCancelText}>{t.cancel}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.modalButtonSubmit,
                  submittingBug && styles.modalButtonDisabled,
                ]}
                onPress={handleSubmitBugReport}
                disabled={submittingBug}
              >
                {submittingBug ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.modalButtonSubmitText}>Submit</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── DONATION MODAL ── */}
      <Modal
        visible={showDonationModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowDonationModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>☕ {t.supportUs}</Text>
            <Text style={styles.donationMessage}>{t.donationMessage}</Text>
            <View style={styles.donationButtons}>
              {[
                { platform: 'kofi', icon: '☕', label: 'Ko-fi' },
                { platform: 'buymeacoffee', icon: '🍵', label: 'Buy Me a Coffee' },
                { platform: 'paypal', icon: '💳', label: 'PayPal' },
                { platform: 'patreon', icon: '🎨', label: 'Patreon' },
              ].map((item) => (
                <TouchableOpacity
                  key={item.platform}
                  style={styles.donationButton}
                  onPress={() => openDonationLink(item.platform)}
                >
                  <Text style={styles.donationButtonIcon}>{item.icon}</Text>
                  <Text style={styles.donationButtonText}>{item.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.donationNote}>
              100% of donations go towards server costs and app development.
              {'\n'}Thank you for your support! ❤️
            </Text>
            <TouchableOpacity
              style={styles.modalClose}
              onPress={() => setShowDonationModal(false)}
            >
              <Text style={styles.modalCloseText}>{t.cancel}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── DELETE ACCOUNT MODAL ── */}
      <Modal
        visible={showDeleteModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowDeleteModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>🔐 Confirm Deletion</Text>
            <Text style={styles.deleteWarning}>
              Enter your password to permanently delete your account.
              {'\n\n'}⚠️ This cannot be undone.
            </Text>
            <Text style={styles.inputLabel}>Password</Text>
            <TextInput
              style={[styles.input, deleteError ? styles.inputError : null]}
              placeholder="Enter your password"
              placeholderTextColor="#666"
              value={deletePassword}
              onChangeText={(text) => {
                setDeletePassword(text);
                setDeleteError('');
              }}
              secureTextEntry
              autoComplete="password"
              textContentType="password"
              autoCapitalize="none"
              autoCorrect={false}
            />
            {deleteError ? (
              <Text style={styles.errorText}>{deleteError}</Text>
            ) : null}
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalButtonCancel}
                onPress={() => {
                  setShowDeleteModal(false);
                  setDeletePassword('');
                  setDeleteError('');
                }}
              >
                <Text style={styles.modalButtonCancelText}>{t.cancel}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButtonSubmit, styles.deleteButton]}
                onPress={executeDeleteAccount}
                disabled={deleting}
              >
                {deleting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.modalButtonSubmitText}>Delete Forever</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  content: { padding: 20, paddingBottom: 50 },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: { color: '#aaa', marginTop: 15, fontSize: 16 },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#eee',
    marginTop: 20,
    marginBottom: 25,
    textAlign: 'center',
  },
  section: { marginBottom: 25 },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#53a8b6',
    marginBottom: 12,
    paddingLeft: 5,
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#16213e',
    padding: 16,
    borderRadius: 12,
    marginBottom: 8,
  },
  settingLabel: { color: '#eee', fontSize: 15 },
  settingValue: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  settingValueText: { color: '#888', fontSize: 14 },
  arrow: { color: '#53a8b6', fontSize: 12 },
  dangerRow: { borderWidth: 1, borderColor: '#d9534f' },
  dangerLabel: { color: '#d9534f', fontSize: 15 },
  referralCard: {
    backgroundColor: '#16213e',
    borderRadius: 15,
    padding: 20,
    borderWidth: 2,
    borderColor: '#e67e22',
  },
  referralLabel: { color: '#888', fontSize: 12, marginBottom: 8, textAlign: 'center' },
  referralCodeBox: {
    backgroundColor: '#0f3460',
    padding: 15,
    borderRadius: 10,
    marginBottom: 15,
  },
  referralCode: {
    color: '#e67e22',
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
    letterSpacing: 3,
  },
  referralStats: { alignItems: 'center', marginBottom: 15 },
  referralCount: { color: '#5cb85c', fontSize: 36, fontWeight: 'bold' },
  referralCountLabel: { color: '#888', fontSize: 12 },
  championBadge: {
    backgroundColor: '#f1c40f',
    paddingVertical: 8,
    paddingHorizontal: 20,
    borderRadius: 20,
    alignSelf: 'center',
    marginBottom: 15,
  },
  championBadgeText: { color: '#1a1a2e', fontSize: 14, fontWeight: 'bold' },
  referralButtons: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  referralButton: {
    flex: 1,
    backgroundColor: '#0f3460',
    paddingVertical: 12,
    borderRadius: 20,
    alignItems: 'center',
  },
  referralButtonPrimary: { backgroundColor: '#e67e22' },
  referralButtonText: { color: '#53a8b6', fontSize: 13, fontWeight: '600' },
  referralButtonTextPrimary: { color: '#fff', fontSize: 13, fontWeight: '600' },
  leaderboardLink: { paddingVertical: 10, alignItems: 'center' },
  leaderboardLinkText: { color: '#53a8b6', fontSize: 14 },
  saveButton: {
    backgroundColor: '#5cb85c',
    paddingVertical: 16,
    borderRadius: 25,
    alignItems: 'center',
    marginTop: 10,
  },
  saveButtonDisabled: { backgroundColor: '#555' },
  saveButtonText: { color: '#fff', fontSize: 18, fontWeight: '600' },
  version: { color: '#555', fontSize: 12, textAlign: 'center', marginTop: 20 },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#1a1a2e',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: '80%',
  },
  modalTitle: {
    color: '#eee',
    fontSize: 20,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 20,
  },
  modalClose: { paddingVertical: 15, alignItems: 'center', marginTop: 10 },
  modalCloseText: { color: '#d9534f', fontSize: 16 },
  languageList: { maxHeight: 400 },
  languageOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#16213e',
    padding: 16,
    borderRadius: 12,
    marginBottom: 8,
  },
  languageOptionActive: {
    backgroundColor: '#0f3460',
    borderWidth: 2,
    borderColor: '#53a8b6',
  },
  languageOptionText: { color: '#aaa', fontSize: 16 },
  languageOptionTextActive: { color: '#53a8b6', fontWeight: '600' },
  checkmark: { color: '#5cb85c', fontSize: 18, fontWeight: 'bold' },
  inputLabel: { color: '#888', fontSize: 12, marginBottom: 6, marginTop: 10 },
  input: {
    backgroundColor: '#16213e',
    color: '#fff',
    padding: 15,
    borderRadius: 10,
    fontSize: 16,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  inputError: { borderColor: '#d9534f' },
  errorText: { color: '#d9534f', fontSize: 12, marginTop: 5 },
  textArea: { height: 120, textAlignVertical: 'top' },
  charCount: { color: '#666', fontSize: 12, textAlign: 'right', marginTop: 5 },
  modalButtons: { flexDirection: 'row', gap: 10, marginTop: 20 },
  modalButtonCancel: {
    flex: 1,
    backgroundColor: '#16213e',
    paddingVertical: 14,
    borderRadius: 20,
    alignItems: 'center',
  },
  modalButtonCancelText: { color: '#888', fontSize: 16 },
  modalButtonSubmit: {
    flex: 1,
    backgroundColor: '#5cb85c',
    paddingVertical: 14,
    borderRadius: 20,
    alignItems: 'center',
  },
  modalButtonDisabled: { backgroundColor: '#555' },
  modalButtonSubmitText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  deleteButton: { backgroundColor: '#d9534f' },
  deleteWarning: {
    color: '#aaa',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 10,
  },
  donationMessage: {
    color: '#aaa',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 20,
  },
  donationButtons: { gap: 10 },
  donationButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#16213e',
    padding: 16,
    borderRadius: 12,
    gap: 12,
  },
  donationButtonIcon: { fontSize: 24 },
  donationButtonText: { color: '#eee', fontSize: 16 },
  donationNote: {
    color: '#666',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 20,
    lineHeight: 18,
  },
});