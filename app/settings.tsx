import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import {
  deleteUser, EmailAuthProvider,
  reauthenticateWithCredential, signOut,
} from 'firebase/auth';
import {
  deleteDoc, doc, getDoc,
  serverTimestamp, setDoc, updateDoc,
} from 'firebase/firestore';
import React, { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import {
  ActivityIndicator, Alert, Modal, Platform,
  ScrollView, StyleSheet, Switch, Text,
  TextInput, TouchableOpacity, View,
} from 'react-native';
import { auth, db } from '../firebaseConfig';
import { Language, languageNames, SUPPORTED_LANGUAGES } from '../utils/i18n';
import { useLanguage } from '../utils/LanguageContext';
import logger from '../utils/logger';
import { checkTextSafety } from '../utils/moderation';
import { profileStorage as storage } from '../utils/storage';

// ─── Types ────────────────────────────────────────────────

interface SettingsState {
  notifyMatches: boolean; notifyMessages: boolean;
  notifyLikes: boolean; notifyProfileViews: boolean;
  showOnlineStatus: boolean; showLastSeen: boolean;
  showProfileViews: boolean; referralCode: string; referralCount: number;
}

type SettingsAction =
  | { type: 'SET_FIELD'; field: keyof SettingsState; value: boolean | string | number }
  | { type: 'LOAD'; payload: Partial<SettingsState> };

interface ModalState { language: boolean; bugReport: boolean; donation: boolean; deleteAccount: boolean; }
type ModalAction = { type: 'OPEN' | 'CLOSE'; modal: keyof ModalState };

interface BugState { title: string; description: string; submitting: boolean; }
type BugAction =
  | { type: 'SET_TITLE'; value: string }
  | { type: 'SET_DESC';  value: string }
  | { type: 'SET_SUBMITTING'; value: boolean }
  | { type: 'RESET' };

interface FirestoreUserData {
  notifyMatches?: boolean; notifyMessages?: boolean;
  notifyLikes?: boolean; notifyProfileViews?: boolean;
  showOnlineStatus?: boolean; showLastSeen?: boolean;
  showProfileViews?: boolean; referralCode?: string; referralCount?: number;
}

// ─── Reducers ─────────────────────────────────────────────

const defaultSettings: SettingsState = {
  notifyMatches: true, notifyMessages: true,
  notifyLikes: true, notifyProfileViews: true,
  showOnlineStatus: true, showLastSeen: true,
  showProfileViews: true, referralCode: '', referralCount: 0,
};

function settingsReducer(state: SettingsState, action: SettingsAction): SettingsState {
  switch (action.type) {
    case 'SET_FIELD': return { ...state, [action.field]: action.value };
    case 'LOAD':      return { ...state, ...action.payload };
    default:          return state;
  }
}

function modalReducer(state: ModalState, action: ModalAction): ModalState {
  return { ...state, [action.modal]: action.type === 'OPEN' };
}

function bugReducer(state: BugState, action: BugAction): BugState {
  switch (action.type) {
    case 'SET_TITLE':      return { ...state, title: action.value };
    case 'SET_DESC':       return { ...state, description: action.value };
    case 'SET_SUBMITTING': return { ...state, submitting: action.value };
    case 'RESET':          return { title: '', description: '', submitting: false };
    default:               return state;
  }
}

// ─── Constants ────────────────────────────────────────────

const DONATION_LINKS: Record<string, string> = {
  kofi: 'https://ko-fi.com/myarchetype', buymeacoffee: 'https://buymeacoffee.com/myarchetype',
  paypal: 'https://paypal.me/myarchetype', patreon: 'https://patreon.com/myarchetype',
};
const DONATION_ITEMS = [
  { platform: 'kofi', icon: '☕', label: 'Ko-fi' },
  { platform: 'buymeacoffee', icon: '🍵', label: 'Buy Me a Coffee' },
  { platform: 'paypal', icon: '💳', label: 'PayPal' },
  { platform: 'patreon', icon: '🎨', label: 'Patreon' },
] as const;

const SWITCH_TRACK = { false: '#3a3a4e', true: '#53a8b6' } as const;

// ─── Sub-components ───────────────────────────────────────

interface SwitchRowProps {
  label: string; field: keyof SettingsState;
  value: boolean; onToggle: (field: keyof SettingsState, value: boolean) => void;
}
const SwitchRow = React.memo(function SwitchRow({ label, field, value, onToggle }: SwitchRowProps) {
  const handleChange = useCallback((v: boolean) => onToggle(field, v), [onToggle, field]);
  return (
    <View style={styles.settingRow}>
      <Text style={styles.settingLabel}>{label}</Text>
      <Switch value={value} onValueChange={handleChange} trackColor={SWITCH_TRACK}
        thumbColor={value ? '#fff' : '#888'} accessibilityLabel={label} accessibilityRole="switch" />
    </View>
  );
});

interface NavRowProps { label: string; onPress: () => void; danger?: boolean; disabled?: boolean; }
const NavRow = React.memo(function NavRow({ label, onPress, danger, disabled }: NavRowProps) {
  return (
    <TouchableOpacity style={[styles.settingRow, danger && styles.dangerRow]} onPress={onPress}
      disabled={disabled} accessibilityLabel={label} accessibilityRole="button">
      <Text style={danger ? styles.dangerLabel : styles.settingLabel}>{label}</Text>
      <Text style={styles.arrow}>▶</Text>
    </TouchableOpacity>
  );
});

interface LangOptionProps { lang: Language; selected: boolean; onSelect: (lang: Language) => void; }
const LangOption = React.memo(function LangOption({ lang, selected, onSelect }: LangOptionProps) {
  const handlePress = useCallback(() => onSelect(lang), [onSelect, lang]);
  return (
    <TouchableOpacity style={[styles.languageOption, selected && styles.languageOptionActive]} onPress={handlePress}
      accessibilityLabel={`Select ${languageNames[lang]}${selected ? ', currently selected' : ''}`}
      accessibilityRole="button" accessibilityState={{ selected }}>
      <Text style={[styles.languageOptionText, selected && styles.languageOptionTextActive]}>{languageNames[lang]}</Text>
      {selected && <Text style={styles.checkmark}>✓</Text>}
    </TouchableOpacity>
  );
});

interface DonateOptionProps { platform: string; icon: string; label: string; onPress: (p: string) => void; }
const DonateOption = React.memo(function DonateOption({ platform, icon, label, onPress }: DonateOptionProps) {
  const handlePress = useCallback(() => onPress(platform), [onPress, platform]);
  return (
    <TouchableOpacity style={styles.donationButton} onPress={handlePress}
      accessibilityLabel={`Donate via ${label}`} accessibilityRole="link">
      <Text style={styles.donationButtonIcon}>{icon}</Text>
      <Text style={styles.donationButtonText}>{label}</Text>
    </TouchableOpacity>
  );
});

// ─── Component ────────────────────────────────────────────

export default function SettingsScreen() {
  const router = useRouter();
  const { language, setLanguage, t } = useLanguage();
  const user = auth.currentUser;

  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteError,    setDeleteError]    = useState('');

  const [settings, dispatchSettings] = useReducer(settingsReducer, defaultSettings);
  const [modals,   dispatchModals]   = useReducer(modalReducer, { language: false, bugReport: false, donation: false, deleteAccount: false });
  const [bug, dispatchBug] = useReducer(bugReducer, { title: '', description: '', submitting: false });

  const openModal  = useCallback((m: keyof ModalState) => dispatchModals({ type: 'OPEN',  modal: m }), []);
  const closeModal = useCallback((m: keyof ModalState) => dispatchModals({ type: 'CLOSE', modal: m }), []);
  const setField   = useCallback((field: keyof SettingsState, value: boolean | string | number) =>
    dispatchSettings({ type: 'SET_FIELD', field, value }), []);

  // ── Extracted handlers (eliminates all inline arrows) ──
  const handleOpenLangModal    = useCallback(() => openModal('language'),      [openModal]);
  const handleOpenBugModal     = useCallback(() => openModal('bugReport'),     [openModal]);
  const handleOpenDonateModal  = useCallback(() => openModal('donation'),      [openModal]);
  const handleCloseLangModal   = useCallback(() => closeModal('language'),     [closeModal]);
  const handleCloseDonateModal = useCallback(() => closeModal('donation'),     [closeModal]);
  const handleCancelBug        = useCallback(() => { closeModal('bugReport'); dispatchBug({ type: 'RESET' }); }, [closeModal]);
  const handleCancelDelete     = useCallback(() => { closeModal('deleteAccount'); setDeletePassword(''); setDeleteError(''); }, [closeModal]);
  const handleBugTitle         = useCallback((v: string) => dispatchBug({ type: 'SET_TITLE', value: v }), []);
  const handleBugDesc          = useCallback((v: string) => dispatchBug({ type: 'SET_DESC',  value: v }), []);
  const handleDeletePwChange   = useCallback((text: string) => { setDeletePassword(text); setDeleteError(''); }, []);

  const handleGoPrivacy      = useCallback(() => router.push('/privacy'),              [router]);
  const handleGoTerms        = useCallback(() => router.push('/terms'),                [router]);
  const handleGoEditProfile  = useCallback(() => router.push('/edit-profile'),         [router]);
  const handleGoBlockedUsers = useCallback(() => router.push('/blocked-users'),        [router]);
  const handleGoLeaderboard  = useCallback(() => router.push('/referral-leaderboard'), [router]);

  // ── Memoised item arrays ───────────────────────────────
  const notifItems = useMemo(() => [
    { label: 'New matches',       field: 'notifyMatches'      as const, value: settings.notifyMatches },
    { label: 'New messages',      field: 'notifyMessages'     as const, value: settings.notifyMessages },
    { label: 'Someone liked you', field: 'notifyLikes'        as const, value: settings.notifyLikes },
    { label: 'Profile views',     field: 'notifyProfileViews' as const, value: settings.notifyProfileViews },
  ], [settings.notifyMatches, settings.notifyMessages, settings.notifyLikes, settings.notifyProfileViews]);

  const privacyItems = useMemo(() => [
    { label: 'Show online status', field: 'showOnlineStatus' as const, value: settings.showOnlineStatus },
    { label: 'Show last seen',     field: 'showLastSeen'     as const, value: settings.showLastSeen },
    { label: 'Show profile views', field: 'showProfileViews' as const, value: settings.showProfileViews },
  ], [settings.showOnlineStatus, settings.showLastSeen, settings.showProfileViews]);

  // ── Load ───────────────────────────────────────────────

  const generateReferralCode = useCallback((uid: string) => `MA${uid.substring(0, 6).toUpperCase()}`, []);

  const loadSettings = useCallback(async () => {
    if (!user) { router.replace('/login'); return; }
    try { await user.reload(); } catch (error) {
      const err = error as { code?: string };
      logger.info('[Settings] Account no longer valid:', err.code);
      await auth.signOut().catch(() => {});
      router.replace('/login');
      return;
    }
    try {
      const snap = await getDoc(doc(db, 'users', user.uid));
      if (snap.exists()) {
        const d = snap.data() as FirestoreUserData;
        dispatchSettings({
          type: 'LOAD', payload: {
            notifyMatches: d.notifyMatches !== false, notifyMessages: d.notifyMessages !== false,
            notifyLikes: d.notifyLikes !== false, notifyProfileViews: d.notifyProfileViews !== false,
            showOnlineStatus: d.showOnlineStatus !== false, showLastSeen: d.showLastSeen !== false,
            showProfileViews: d.showProfileViews !== false,
            referralCode: d.referralCode ?? generateReferralCode(user.uid),
            referralCount: d.referralCount ?? 0,
          },
        });
      }
      const savedLang = storage.getString('app_language');
      if (savedLang) setLanguage(savedLang as Language);
    } catch (error) {
      const err = error as { code?: string };
      if (err?.code === 'permission-denied') return;
      logger.error('[Settings] loadSettings error:', error);
    } finally { setLoading(false); }
  }, [user, router, generateReferralCode, setLanguage]);

  useEffect(() => { loadSettings(); }, [loadSettings]);

  // ── Save ───────────────────────────────────────────────

  const saveSettings = useCallback(async () => {
    if (!user) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, 'users', user.uid), { ...settings, updatedAt: new Date().toISOString() });
      Alert.alert(t.success, 'Settings saved!');
    } catch (error) {
      const err = error as { code?: string };
      if (err?.code === 'permission-denied') { Alert.alert('Error', 'Permission denied. Please log in again.'); return; }
      logger.error('[Settings] saveSettings error:', error);
      Alert.alert(t.error, 'Failed to save settings');
    } finally { setSaving(false); }
  }, [user, settings, t]);

  // ── Delete account ────────────────────────────────────

  const handleDeleteAccount = useCallback(() => {
    if (!auth.currentUser) { Alert.alert('Error', 'Not logged in.'); router.replace('/login'); return; }
    setDeletePassword(''); setDeleteError('');
    if (typeof window !== 'undefined') { openModal('deleteAccount'); return; }
    Alert.alert('⚠️ Delete Account', 'Are you sure? This will permanently delete your account and ALL your data.\n\nThis cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Continue', style: 'destructive', onPress: () => openModal('deleteAccount') },
    ]);
  }, [router, openModal]);

  const executeDeleteAccount = useCallback(async () => {
    if (!deletePassword.trim()) { setDeleteError('Password is required'); return; }
    const currentUser = auth.currentUser;
    if (!currentUser) { Alert.alert('Error', 'Session expired.'); router.replace('/login'); return; }
    setDeleting(true);
    closeModal('deleteAccount');
    try {
      const credential = EmailAuthProvider.credential(currentUser.email!, deletePassword);
      await reauthenticateWithCredential(currentUser, credential);
      await deleteDoc(doc(db, 'users', currentUser.uid)).catch(() => {});
      await deleteUser(currentUser);
      Alert.alert('✅ Account Deleted', 'Your account has been permanently deleted.');
      router.replace('/login');
    } catch (error) {
      const err = error as { code?: string };
      logger.error('[Settings] deleteAccount error:', err.code);
      setDeleting(false);
      const msg: Record<string, [string, string]> = {
        'auth/wrong-password':     ['❌ Wrong Password',    'Incorrect password. Please try again.'],
        'auth/invalid-credential': ['❌ Wrong Password',    'Incorrect password. Please try again.'],
        'auth/too-many-requests':  ['⏳ Too Many Attempts', 'Please wait a moment and try again.'],
      };
      const known = err.code ? msg[err.code] : undefined;
      if (known) { Alert.alert(known[0], known[1]); }
      else if (err.code === 'auth/requires-recent-login') {
        Alert.alert('🔐 Session Expired', 'Please log out and log back in, then try again.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Log Out', onPress: async () => { await signOut(auth).catch(() => {}); router.replace('/login'); } },
        ]);
      } else { Alert.alert('Error', `Failed to delete account: ${err.code ?? 'unknown'}`); }
    }
  }, [deletePassword, router, closeModal]);

  // ── Language ──────────────────────────────────────────

  const handleLanguageChange = useCallback(async (lang: Language) => {
    storage.set('app_language', lang);
    await setLanguage(lang);
    closeModal('language');
  }, [setLanguage, closeModal]);

  // ── Referral ──────────────────────────────────────────

  const handleCopyReferralCode = useCallback(async () => {
    await Clipboard.setStringAsync(settings.referralCode);
    Alert.alert(t.success, 'Referral code copied!');
  }, [settings.referralCode, t]);

  const handleShareReferralCode = useCallback(async () => {
    await Clipboard.setStringAsync(
      `Join me on MyArchetype - the 100% free dating app for genuine connections!\nUse my code: ${settings.referralCode}\n\nDownload: https://myarchetype.app`
    );
    Alert.alert(t.success, 'Share message copied to clipboard!');
  }, [settings.referralCode, t]);

  // ── Bug report ────────────────────────────────────────

  const handleSubmitBugReport = useCallback(async () => {
    if (!bug.title.trim() || !bug.description.trim()) { Alert.alert(t.error, 'Please fill in all fields'); return; }
    if (!user) return;
    const titleCheck = checkTextSafety(bug.title);
    if (!titleCheck.safe) { Alert.alert('Not Allowed', titleCheck.reason); return; }
    const descCheck = checkTextSafety(bug.description);
    if (!descCheck.safe) { Alert.alert('Not Allowed', descCheck.reason); return; }
    dispatchBug({ type: 'SET_SUBMITTING', value: true });
    try {
      await setDoc(doc(db, 'bugReports', `${user.uid}_${Date.now()}`), {
        reporterId: user.uid, title: bug.title.trim(), description: bug.description.trim(),
        createdAt: serverTimestamp(), severity: 'medium', deviceInfo: Platform.OS, appVersion: '1.0.0',
      });
      Alert.alert(t.success, 'Bug report submitted. Thank you for helping improve MyArchetype!');
      dispatchBug({ type: 'RESET' });
      closeModal('bugReport');
    } catch (error) {
      logger.error('[Settings] submitBugReport error:', error);
      Alert.alert(t.error, 'Failed to submit bug report');
    } finally { dispatchBug({ type: 'SET_SUBMITTING', value: false }); }
  }, [bug, user, t, closeModal]);

  // ── Donations ─────────────────────────────────────────

  const openDonationLink = useCallback((platform: string) => {
    Linking.openURL(DONATION_LINKS[platform] ?? DONATION_LINKS.kofi!);
  }, []);

  // ── Loading ───────────────────────────────────────────

  if (loading || deleting) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#53a8b6" />
        <Text style={styles.loadingText}>{deleting ? 'Deleting account...' : t.loading}</Text>
      </View>
    );
  }

  // ── Render ────────────────────────────────────────────

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>⚙️ {t.settings}</Text>

      {/* LANGUAGE */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t.language}</Text>
        <TouchableOpacity style={styles.settingRow} onPress={handleOpenLangModal}
          accessibilityLabel={`Change language, currently ${languageNames[language]}`} accessibilityRole="button">
          <Text style={styles.settingLabel}>{t.language}</Text>
          <View style={styles.settingValue}>
            <Text style={styles.settingValueText}>{languageNames[language]}</Text>
            <Text style={styles.arrow}>▶</Text>
          </View>
        </TouchableOpacity>
      </View>

      {/* NOTIFICATIONS */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t.notifications}</Text>
        {notifItems.map(item => (
          <SwitchRow key={item.field} label={item.label} field={item.field} value={item.value} onToggle={setField} />
        ))}
      </View>

      {/* PRIVACY */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t.privacy}</Text>
        {privacyItems.map(item => (
          <SwitchRow key={item.field} label={item.label} field={item.field} value={item.value} onToggle={setField} />
        ))}
      </View>

      {/* REFERRAL */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>🌟 {t.referralProgram}</Text>
        <View style={styles.referralCard}>
          <Text style={styles.referralLabel}>{t.yourReferralCode}</Text>
          <View style={styles.referralCodeBox}>
            <Text style={styles.referralCode}>{settings.referralCode}</Text>
          </View>
          <View style={styles.referralStats}>
            <Text style={styles.referralCount}>{settings.referralCount}</Text>
            <Text style={styles.referralCountLabel}>{t.referralsCount}</Text>
          </View>
          {settings.referralCount >= 10 && (
            <View style={styles.championBadge}><Text style={styles.championBadgeText}>{t.communityChampion}</Text></View>
          )}
          <View style={styles.referralButtons}>
            <TouchableOpacity style={styles.referralButton} onPress={handleCopyReferralCode}
              accessibilityLabel="Copy referral code" accessibilityRole="button">
              <Text style={styles.referralButtonText}>📋 {t.copyCode}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.referralButton, styles.referralButtonPrimary]} onPress={handleShareReferralCode}
              accessibilityLabel="Share referral code" accessibilityRole="button">
              <Text style={styles.referralButtonTextPrimary}>📤 {t.shareCode}</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity style={styles.leaderboardLink} onPress={handleGoLeaderboard}
            accessibilityLabel="View referral leaderboard" accessibilityRole="button">
            <Text style={styles.leaderboardLinkText}>🏆 View {t.leaderboard}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* SUPPORT */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t.support}</Text>
        <NavRow label={t.reportBug} onPress={handleOpenBugModal} />
        <NavRow label={t.donate} onPress={handleOpenDonateModal} />
      </View>

      {/* LEGAL */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Legal</Text>
        <NavRow label={t.privacyPolicy} onPress={handleGoPrivacy} />
        <NavRow label={t.termsOfService} onPress={handleGoTerms} />
      </View>

      {/* ACCOUNT */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Account</Text>
        <NavRow label={t.editProfile} onPress={handleGoEditProfile} />
        <NavRow label={t.blockedUsers} onPress={handleGoBlockedUsers} />
        <NavRow label={t.deleteAccount} onPress={handleDeleteAccount} danger disabled={deleting} />
      </View>

      {/* SAVE */}
      <TouchableOpacity style={[styles.saveButton, saving && styles.saveButtonDisabled]} onPress={saveSettings}
        disabled={saving} accessibilityLabel="Save settings" accessibilityRole="button">
        {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveButtonText}>✓ {t.save}</Text>}
      </TouchableOpacity>

      <Text style={styles.version}>MyArchetype v1.0.0</Text>

      {/* LANGUAGE MODAL */}
      <Modal visible={modals.language} animationType="slide" transparent onRequestClose={handleCloseLangModal}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{t.language}</Text>
            <ScrollView style={styles.languageList}>
              {SUPPORTED_LANGUAGES.map(lang => (
                <LangOption key={lang} lang={lang} selected={language === lang} onSelect={handleLanguageChange} />
              ))}
            </ScrollView>
            <TouchableOpacity style={styles.modalClose} onPress={handleCloseLangModal}
              accessibilityLabel="Close language picker" accessibilityRole="button">
              <Text style={styles.modalCloseText}>{t.cancel}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* BUG REPORT MODAL */}
      <Modal visible={modals.bugReport} animationType="slide" transparent onRequestClose={handleCancelBug}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>🐛 {t.reportBug}</Text>
            <Text style={styles.inputLabel}>Bug Title</Text>
            <TextInput style={styles.input} placeholder="Brief description of the issue" placeholderTextColor="#666"
              value={bug.title} onChangeText={handleBugTitle} maxLength={100} accessibilityLabel="Bug title" />
            <Text style={styles.inputLabel}>Details</Text>
            <TextInput style={[styles.input, styles.textArea]} placeholder="What happened? What did you expect? Steps to reproduce..."
              placeholderTextColor="#666" value={bug.description} onChangeText={handleBugDesc}
              multiline numberOfLines={5} maxLength={500} accessibilityLabel="Bug description" />
            <Text style={styles.charCount}>{bug.description.length}/500</Text>
            <View style={styles.modalButtons}>
              <TouchableOpacity style={styles.modalButtonCancel} onPress={handleCancelBug}
                accessibilityLabel="Cancel bug report" accessibilityRole="button">
                <Text style={styles.modalButtonCancelText}>{t.cancel}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalButtonSubmit, bug.submitting && styles.modalButtonDisabled]}
                onPress={handleSubmitBugReport} disabled={bug.submitting}
                accessibilityLabel="Submit bug report" accessibilityRole="button">
                {bug.submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.modalButtonSubmitText}>Submit</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* DONATION MODAL */}
      <Modal visible={modals.donation} animationType="slide" transparent onRequestClose={handleCloseDonateModal}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>☕ {t.supportUs}</Text>
            <Text style={styles.donationMessage}>{t.donationMessage}</Text>
            <View style={styles.donationButtons}>
              {DONATION_ITEMS.map(item => (
                <DonateOption key={item.platform} platform={item.platform} icon={item.icon}
                  label={item.label} onPress={openDonationLink} />
              ))}
            </View>
            <Text style={styles.donationNote}>
              100% of donations go towards server costs and app development.{'\n'}Thank you for your support! ❤️
            </Text>
            <TouchableOpacity style={styles.modalClose} onPress={handleCloseDonateModal}
              accessibilityLabel="Close donation modal" accessibilityRole="button">
              <Text style={styles.modalCloseText}>{t.cancel}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* DELETE MODAL */}
      <Modal visible={modals.deleteAccount} animationType="slide" transparent onRequestClose={handleCancelDelete}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>🔐 Confirm Deletion</Text>
            <Text style={styles.deleteWarning}>
              Enter your password to permanently delete your account.{'\n\n'}⚠️ This cannot be undone.
            </Text>
            <Text style={styles.inputLabel}>Password</Text>
            <TextInput style={[styles.input, deleteError ? styles.inputError : null]}
              placeholder="Enter your password" placeholderTextColor="#666"
              value={deletePassword} onChangeText={handleDeletePwChange}
              secureTextEntry autoComplete="password" textContentType="password"
              autoCapitalize="none" autoCorrect={false} accessibilityLabel="Password for account deletion" />
            {deleteError ? <Text style={styles.errorText}>{deleteError}</Text> : null}
            <View style={styles.modalButtons}>
              <TouchableOpacity style={styles.modalButtonCancel} onPress={handleCancelDelete}
                accessibilityLabel="Cancel account deletion" accessibilityRole="button">
                <Text style={styles.modalButtonCancelText}>{t.cancel}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalButtonSubmit, styles.deleteButton]}
                onPress={executeDeleteAccount} disabled={deleting}
                accessibilityLabel="Confirm delete account forever" accessibilityRole="button">
                {deleting ? <ActivityIndicator color="#fff" /> : <Text style={styles.modalButtonSubmitText}>Delete Forever</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────

const styles = StyleSheet.create({
  container:{flex:1,backgroundColor:'#1a1a2e'},content:{padding:20,paddingBottom:50},loadingContainer:{flex:1,backgroundColor:'#1a1a2e',justifyContent:'center',alignItems:'center'},loadingText:{color:'#aaa',marginTop:15,fontSize:16},title:{fontSize:28,fontWeight:'bold',color:'#eee',marginTop:20,marginBottom:25,textAlign:'center'},
  section:{marginBottom:25},sectionTitle:{fontSize:16,fontWeight:'600',color:'#53a8b6',marginBottom:12,paddingLeft:5},settingRow:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',backgroundColor:'#16213e',padding:16,borderRadius:12,marginBottom:8},settingLabel:{color:'#eee',fontSize:15},settingValue:{flexDirection:'row',alignItems:'center',gap:8},settingValueText:{color:'#888',fontSize:14},arrow:{color:'#53a8b6',fontSize:12},dangerRow:{borderWidth:1,borderColor:'#d9534f'},dangerLabel:{color:'#d9534f',fontSize:15},
  referralCard:{backgroundColor:'#16213e',borderRadius:15,padding:20,borderWidth:2,borderColor:'#e67e22'},referralLabel:{color:'#888',fontSize:12,marginBottom:8,textAlign:'center'},referralCodeBox:{backgroundColor:'#0f3460',padding:15,borderRadius:10,marginBottom:15},referralCode:{color:'#e67e22',fontSize:24,fontWeight:'bold',textAlign:'center',letterSpacing:3},referralStats:{alignItems:'center',marginBottom:15},referralCount:{color:'#5cb85c',fontSize:36,fontWeight:'bold'},referralCountLabel:{color:'#888',fontSize:12},championBadge:{backgroundColor:'#f1c40f',paddingVertical:8,paddingHorizontal:20,borderRadius:20,alignSelf:'center',marginBottom:15},championBadgeText:{color:'#1a1a2e',fontSize:14,fontWeight:'bold'},referralButtons:{flexDirection:'row',gap:10,marginBottom:10},referralButton:{flex:1,backgroundColor:'#0f3460',paddingVertical:12,borderRadius:20,alignItems:'center'},referralButtonPrimary:{backgroundColor:'#e67e22'},referralButtonText:{color:'#53a8b6',fontSize:13,fontWeight:'600'},referralButtonTextPrimary:{color:'#fff',fontSize:13,fontWeight:'600'},leaderboardLink:{paddingVertical:10,alignItems:'center'},leaderboardLinkText:{color:'#53a8b6',fontSize:14},
  saveButton:{backgroundColor:'#5cb85c',paddingVertical:16,borderRadius:25,alignItems:'center',marginTop:10},saveButtonDisabled:{backgroundColor:'#555'},saveButtonText:{color:'#fff',fontSize:18,fontWeight:'600'},version:{color:'#555',fontSize:12,textAlign:'center',marginTop:20},
  modalOverlay:{flex:1,backgroundColor:'rgba(0,0,0,0.8)',justifyContent:'flex-end'},modalContent:{backgroundColor:'#1a1a2e',borderTopLeftRadius:20,borderTopRightRadius:20,padding:20,maxHeight:'80%'},modalTitle:{color:'#eee',fontSize:20,fontWeight:'bold',textAlign:'center',marginBottom:20},modalClose:{paddingVertical:15,alignItems:'center',marginTop:10},modalCloseText:{color:'#d9534f',fontSize:16},
  languageList:{maxHeight:400},languageOption:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',backgroundColor:'#16213e',padding:16,borderRadius:12,marginBottom:8},languageOptionActive:{backgroundColor:'#0f3460',borderWidth:2,borderColor:'#53a8b6'},languageOptionText:{color:'#aaa',fontSize:16},languageOptionTextActive:{color:'#53a8b6',fontWeight:'600'},checkmark:{color:'#5cb85c',fontSize:18,fontWeight:'bold'},
  inputLabel:{color:'#888',fontSize:12,marginBottom:6,marginTop:10},input:{backgroundColor:'#16213e',color:'#fff',padding:15,borderRadius:10,fontSize:16,borderWidth:2,borderColor:'transparent'},inputError:{borderColor:'#d9534f'},errorText:{color:'#d9534f',fontSize:12,marginTop:5},textArea:{height:120,textAlignVertical:'top'},charCount:{color:'#666',fontSize:12,textAlign:'right',marginTop:5},
  modalButtons:{flexDirection:'row',gap:10,marginTop:20},modalButtonCancel:{flex:1,backgroundColor:'#16213e',paddingVertical:14,borderRadius:20,alignItems:'center'},modalButtonCancelText:{color:'#888',fontSize:16},modalButtonSubmit:{flex:1,backgroundColor:'#5cb85c',paddingVertical:14,borderRadius:20,alignItems:'center'},modalButtonDisabled:{backgroundColor:'#555'},modalButtonSubmitText:{color:'#fff',fontSize:16,fontWeight:'600'},deleteButton:{backgroundColor:'#d9534f'},deleteWarning:{color:'#aaa',fontSize:14,textAlign:'center',lineHeight:22,marginBottom:10},
  donationMessage:{color:'#aaa',fontSize:14,textAlign:'center',lineHeight:22,marginBottom:20},donationButtons:{gap:10},donationButton:{flexDirection:'row',alignItems:'center',backgroundColor:'#16213e',padding:16,borderRadius:12,gap:12},donationButtonIcon:{fontSize:24},donationButtonText:{color:'#eee',fontSize:16},donationNote:{color:'#666',fontSize:12,textAlign:'center',marginTop:20,lineHeight:18},
});