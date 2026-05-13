import { observable } from '@legendapp/state';
import { observer } from '@legendapp/state/react';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo } from 'react';
import { ActivityIndicator, Alert, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { logger } from '../utils/logger';
import {
  RelationshipStatus,
  calculateRelationshipDuration,
  enterRelationshipMode,
  exitRelationshipMode,
  getNextAnniversary,
  getRelationshipStatus,
} from '../utils/relationshipMode';

const screen$ = observable({
  loading:     true,
  status:      null as RelationshipStatus | null,
  showSetup:   false,
  partnerId:   '',
  partnerName: '',
  startDate:   '',
  entering:    false,
  exiting:     false,
});

// ─── AnniversaryCard ──────────────────────────────────────────────────────────
// Extracted from the IIFE that previously lived inside JSX so the linter
// doesn't flag it as an immediately-invoked function expression in JSX.

interface AnniversaryCardProps {
  anniversary: string;
}

const AnniversaryCard = React.memo<AnniversaryCardProps>(({ anniversary }) => {
  const { date, daysUntil } = getNextAnniversary(anniversary);
  return (
    <View style={styles.anniversaryCard}>
      <Text style={styles.anniversaryIcon}>🎉</Text>
      <View style={styles.anniversaryInfo}>
        <Text style={styles.anniversaryLabel}>Next Anniversary</Text>
        <Text style={styles.anniversaryDate}>{date.toLocaleDateString()}</Text>
        <Text style={styles.anniversaryCountdown}>
          {daysUntil === 0 ? 'Today! 🎊' : daysUntil === 1 ? 'Tomorrow!' : `in ${daysUntil} days`}
        </Text>
      </View>
    </View>
  );
});
AnniversaryCard.displayName = 'AnniversaryCard';

// ─── Screen ───────────────────────────────────────────────────────────────────

export default observer(function RelationshipModeScreen() {
  const router = useRouter();

  const loadStatus = useCallback(async () => {
    try {
      const relationshipStatus = await getRelationshipStatus();
      screen$.status.set(relationshipStatus);
    } catch (error) {
      logger.error('[RelationshipMode] load error:', error);
      Alert.alert('Error', 'Failed to load relationship status.');
    } finally {
      screen$.loading.set(false);
    }
  }, []);

  useEffect(() => { void loadStatus(); }, [loadStatus]);

  const handleEnter = useCallback(async () => {
    const partnerName = screen$.partnerName.get().trim();
    if (!partnerName) {
      Alert.alert('Missing Info', "Please enter your partner's name");
      return;
    }
    screen$.entering.set(true);
    try {
      const partnerId = screen$.partnerId.get();
      const startDate = screen$.startDate.get();
      const result = await enterRelationshipMode(
        partnerId || 'manual',
        partnerName,
        startDate || undefined,
      );
      if (result.success) {
        Alert.alert('💕 Relationship Mode Activated!', 'Your profile is now hidden from discovery. Enjoy your relationship!');
        screen$.showSetup.set(false);
        await loadStatus();
      } else {
        Alert.alert('Error', result.error ?? 'Could not activate relationship mode');
      }
    } catch (error) {
      logger.error('[RelationshipMode] enter error:', error);
      Alert.alert('Error', 'Something went wrong while entering relationship mode.');
    } finally {
      screen$.entering.set(false);
    }
  }, [loadStatus]);

  const handleExit = useCallback(async () => {
    screen$.exiting.set(true);
    try {
      const result = await exitRelationshipMode();
      if (result.success) {
        Alert.alert('Relationship Mode Ended', 'Your profile is now visible again');
        await loadStatus();
      } else {
        Alert.alert('Error', result.error ?? 'Could not exit relationship mode');
      }
    } catch (error) {
      logger.error('[RelationshipMode] exit error:', error);
      Alert.alert('Error', 'Something went wrong while exiting relationship mode.');
    } finally {
      screen$.exiting.set(false);
    }
  }, [loadStatus]);

  const confirmExit = useCallback(() => {
    Alert.alert(
      'Exit Relationship Mode?',
      'This will:\n- Show your profile in discovery again\n- Remove relationship status\n- Allow you to receive likes/matches\n\nAre you sure?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Exit', style: 'destructive', onPress: () => void handleExit() },
      ],
    );
  }, [handleExit]);

  const loading     = screen$.loading.get();
  const status      = screen$.status.get();
  const showSetup   = screen$.showSetup.get();
  const partnerName = screen$.partnerName.get();
  const startDate   = screen$.startDate.get();
  const entering    = screen$.entering.get();
  const exiting     = screen$.exiting.get();

  const exitButtonStyle    = useMemo(() => [styles.exitButton,  exiting  && styles.exitButtonDisabled],  [exiting]);
  const enterButtonStyle   = useMemo(() => [styles.enterButton, entering && styles.enterButtonDisabled], [entering]);
  const onPartnerNameChange = useCallback((v: string) => screen$.partnerName.set(v), []);
  const onStartDateChange   = useCallback((v: string) => screen$.startDate.set(v),   []);
  const onShowSetup         = useCallback(() => screen$.showSetup.set(true),  []);
  const onHideSetup         = useCallback(() => screen$.showSetup.set(false), []);
  const onGoBack            = useCallback(() => router.back(), [router]);
  const onHandleEnter       = useCallback(() => void handleEnter(), [handleEnter]);

  if (loading) return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color="#53a8b6" />
    </View>
  );

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.header}>
        <TouchableOpacity
          onPress={onGoBack}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Text style={styles.backButton}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>💕 Relationship Mode</Text>
        <View style={styles.headerSpacer} />
      </View>

      {status?.inRelationship ? (
        <View>
          <View style={styles.celebrationCard}>
            <Text style={styles.celebrationEmoji}>💕</Text>
            <Text style={styles.celebrationTitle}>In a Relationship!</Text>
            <Text style={styles.celebrationSubtitle}>with {status.partnerName}</Text>
          </View>

          <View style={styles.durationCard}>
            <Text style={styles.durationLabel}>Together for:</Text>
            <Text style={styles.durationValue}>
              {calculateRelationshipDuration(status.startDate ?? status.anniversary ?? '')}
            </Text>
          </View>

          {status.anniversary && (
            <AnniversaryCard anniversary={status.anniversary} />
          )}

          <View style={styles.infoCard}>
            <Text style={styles.infoTitle}>ℹ️ What this means:</Text>
            <Text style={styles.infoItem}>✓ Your profile is hidden from discovery</Text>
            <Text style={styles.infoItem}>✓ You won't receive new likes or matches</Text>
            <Text style={styles.infoItem}>✓ Existing chats remain active</Text>
            <Text style={styles.infoItem}>✓ You can still chat with your partner</Text>
          </View>

          <TouchableOpacity
            style={exitButtonStyle}
            onPress={confirmExit}
            disabled={exiting}
            accessibilityRole="button"
            accessibilityLabel="Exit relationship mode"
          >
            <Text style={styles.exitButtonText}>{exiting ? 'Exiting...' : 'Exit Relationship Mode'}</Text>
          </TouchableOpacity>
        </View>
      ) : showSetup ? (
        <View style={styles.setupForm}>
          <Text style={styles.setupTitle}>Enter Relationship Mode</Text>
          <Text style={styles.setupSubtitle}>
            This will hide your profile from discovery and mark you as "in a relationship"
          </Text>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Partner's Name *</Text>
            <TextInput
              style={styles.input}
              placeholder="Who are you dating?"
              placeholderTextColor="#666"
              value={partnerName}
              onChangeText={onPartnerNameChange}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Relationship Start Date (Optional)</Text>
            <TextInput
              style={styles.input}
              placeholder="YYYY-MM-DD (e.g., 2024-01-15)"
              placeholderTextColor="#666"
              value={startDate}
              onChangeText={onStartDateChange}
            />
            <Text style={styles.inputHint}>For anniversary tracking. Leave blank if unsure.</Text>
          </View>

          <TouchableOpacity
            style={enterButtonStyle}
            onPress={onHandleEnter}
            disabled={entering}
            accessibilityRole="button"
            accessibilityLabel="Activate relationship mode"
          >
            <Text style={styles.enterButtonText}>
              {entering ? 'Activating...' : '💕 Enter Relationship Mode'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.cancelSetupButton}
            onPress={onHideSetup}
            accessibilityRole="button"
            accessibilityLabel="Cancel setup"
          >
            <Text style={styles.cancelSetupButtonText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>💕</Text>
          <Text style={styles.emptyTitle}>Relationship Mode</Text>
          <Text style={styles.emptyText}>Found someone special? Enter relationship mode to:</Text>

          <View style={styles.featuresCard}>
            <Text style={styles.featureItem}>💕 Hide your profile from discovery</Text>
            <Text style={styles.featureItem}>🎉 Track your relationship anniversary</Text>
            <Text style={styles.featureItem}>🔒 Prevent new matches and likes</Text>
            <Text style={styles.featureItem}>💬 Keep chatting with your partner</Text>
            <Text style={styles.featureItem}>✨ Celebrate milestones together</Text>
          </View>

          <TouchableOpacity
            style={styles.setupButton}
            onPress={onShowSetup}
            accessibilityRole="button"
            accessibilityLabel="Enter relationship mode"
          >
            <Text style={styles.setupButtonText}>💕 Enter Relationship Mode</Text>
          </TouchableOpacity>

          <Text style={styles.disclaimer}>
            You can exit relationship mode anytime to start dating again.
          </Text>
        </View>
      )}
    </ScrollView>
  );
});

const styles = StyleSheet.create((theme) => ({
  container:             { flex: 1, backgroundColor: theme.colors.background },
  content:               { padding: 20, paddingBottom: 40 },
  header:                { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 40, marginBottom: 20 },
  headerSpacer:          { width: 50 },
  backButton:            { color: theme.colors.primary, fontSize: 16 },
  title:                 { fontSize: 20, fontWeight: 'bold', color: theme.colors.text },
  celebrationCard:       { backgroundColor: '#16213e', borderRadius: 15, padding: 30, alignItems: 'center', marginBottom: 20, borderWidth: 2, borderColor: '#e74c3c' },
  celebrationEmoji:      { fontSize: 80, marginBottom: 15 },
  celebrationTitle:      { fontSize: 24, fontWeight: 'bold', color: '#e74c3c', marginBottom: 5 },
  celebrationSubtitle:   { fontSize: 16, color: theme.colors.textSecondary },
  durationCard:          { backgroundColor: '#16213e', borderRadius: 15, padding: 20, alignItems: 'center', marginBottom: 15 },
  durationLabel:         { fontSize: 14, color: theme.colors.textSecondary, marginBottom: 8 },
  durationValue:         { fontSize: 28, fontWeight: 'bold', color: '#e74c3c' },
  anniversaryCard:       { backgroundColor: '#16213e', borderRadius: 15, padding: 15, marginBottom: 15, flexDirection: 'row', alignItems: 'center', gap: 15 },
  anniversaryIcon:       { fontSize: 40 },
  anniversaryInfo:       { flex: 1 },
  anniversaryLabel:      { fontSize: 12, color: theme.colors.textSecondary },
  anniversaryDate:       { fontSize: 18, fontWeight: 'bold', color: theme.colors.text, marginTop: 4 },
  anniversaryCountdown:  { fontSize: 14, color: '#e67e22', marginTop: 4 },
  infoCard:              { backgroundColor: '#0f3460', borderRadius: 15, padding: 15, marginBottom: 20 },
  infoTitle:             { fontSize: 14, color: '#53a8b6', marginBottom: 10, fontWeight: '600' },
  infoItem:              { fontSize: 13, color: theme.colors.textSecondary, marginBottom: 6 },
  exitButton:            { backgroundColor: '#d9534f', paddingVertical: 16, borderRadius: 25, alignItems: 'center' },
  exitButtonDisabled:    { backgroundColor: '#555' },
  exitButtonText:        { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  setupForm:             {},
  setupTitle:            { fontSize: 22, fontWeight: 'bold', color: theme.colors.text, marginBottom: 10, textAlign: 'center' },
  setupSubtitle:         { fontSize: 14, color: theme.colors.textSecondary, textAlign: 'center', marginBottom: 25, lineHeight: 20 },
  inputGroup:            { marginBottom: 15 },
  inputLabel:            { color: theme.colors.textSecondary, fontSize: 14, marginBottom: 6 },
  input:                 { backgroundColor: '#16213e', borderRadius: 12, padding: 14, color: theme.colors.text, fontSize: 16, borderWidth: 1, borderColor: '#0f3460' },
  inputHint:             { color: '#666', fontSize: 12, marginTop: 4 },
  enterButton:           { backgroundColor: '#e74c3c', paddingVertical: 16, borderRadius: 25, alignItems: 'center', marginTop: 20 },
  enterButtonDisabled:   { backgroundColor: '#555' },
  enterButtonText:       { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  cancelSetupButton:     { backgroundColor: '#0f3460', paddingVertical: 14, borderRadius: 25, alignItems: 'center', marginTop: 12 },
  cancelSetupButtonText: { color: theme.colors.textSecondary, fontSize: 14 },
  emptyContainer:        { alignItems: 'center', paddingTop: 40 },
  emptyIcon:             { fontSize: 80, marginBottom: 20 },
  emptyTitle:            { fontSize: 24, fontWeight: 'bold', color: theme.colors.text, marginBottom: 15 },
  emptyText:             { fontSize: 16, color: theme.colors.textSecondary, textAlign: 'center', marginBottom: 25 },
  featuresCard:          { backgroundColor: '#16213e', borderRadius: 15, padding: 20, width: '100%', marginBottom: 30 },
  featureItem:           { color: '#aaa', fontSize: 14, marginBottom: 10 },
  setupButton:           { backgroundColor: '#e74c3c', paddingVertical: 16, paddingHorizontal: 40, borderRadius: 25, marginBottom: 20 },
  setupButtonText:       { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  disclaimer:            { color: '#666', fontSize: 12, textAlign: 'center', fontStyle: 'italic' },
}));