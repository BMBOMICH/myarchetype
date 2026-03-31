import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import {
  RelationshipStatus,
  calculateRelationshipDuration,
  enterRelationshipMode,
  exitRelationshipMode,
  getNextAnniversary,
  getRelationshipStatus,
} from '../utils/relationshipMode';

export default function RelationshipModeScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<RelationshipStatus | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [partnerId, setPartnerId] = useState('');
  const [partnerName, setPartnerName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [entering, setEntering] = useState(false);
  const [exiting, setExiting] = useState(false);

  useEffect(() => { void loadStatus(); }, []);

  const loadStatus = async () => {
    try {
      const relationshipStatus = await getRelationshipStatus();
      setStatus(relationshipStatus);
    } catch (error) {
      console.error('[RelationshipMode] load error:', error);
      Alert.alert('Error', 'Failed to load relationship status.');
    } finally {
      setLoading(false);
    }
  };

  const handleEnter = async () => {
    if (!partnerName.trim()) {
      Alert.alert('Missing Info', "Please enter your partner's name");
      return;
    }
    setEntering(true);
    try {
      const result = await enterRelationshipMode(partnerId || 'manual', partnerName.trim(), startDate || undefined);
      if (result.success) {
        Alert.alert('💕 Relationship Mode Activated!', 'Your profile is now hidden from discovery. Enjoy your relationship!');
        setShowSetup(false);
        await loadStatus();
      } else {
        Alert.alert('Error', result.error || 'Could not activate relationship mode');
      }
    } catch (error) {
      console.error('[RelationshipMode] enter error:', error);
      Alert.alert('Error', 'Something went wrong while entering relationship mode.');
    } finally {
      setEntering(false);
    }
  };

  const confirmExit = () => {
    Alert.alert(
      'Exit Relationship Mode?',
      'This will:\n- Show your profile in discovery again\n- Remove relationship status\n- Allow you to receive likes/matches\n\nAre you sure?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Exit',
          style: 'destructive',
          onPress: () => void handleExit(),
        },
      ]
    );
  };

  const handleExit = async () => {
    setExiting(true);
    try {
      const result = await exitRelationshipMode();
      if (result.success) {
        Alert.alert('Relationship Mode Ended', 'Your profile is now visible again');
        await loadStatus();
      } else {
        Alert.alert('Error', result.error || 'Could not exit relationship mode');
      }
    } catch (error) {
      console.error('[RelationshipMode] exit error:', error);
      Alert.alert('Error', 'Something went wrong while exiting relationship mode.');
    } finally {
      setExiting(false);
    }
  };

  if (loading) return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color="#53a8b6" />
    </View>
  );

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}><Text style={styles.backButton}>← Back</Text></TouchableOpacity>
        <Text style={styles.title}>💕 Relationship Mode</Text>
        <View style={{ width: 50 }} />
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
            <Text style={styles.durationValue}>{calculateRelationshipDuration(status.startDate || status.anniversary || '')}</Text>
          </View>

          {status.anniversary && (() => {
            const { date, daysUntil } = getNextAnniversary(status.anniversary);
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
          })()}

          <View style={styles.infoCard}>
            <Text style={styles.infoTitle}>ℹ️ What this means:</Text>
            <Text style={styles.infoItem}>✓ Your profile is hidden from discovery</Text>
            <Text style={styles.infoItem}>✓ You won't receive new likes or matches</Text>
            <Text style={styles.infoItem}>✓ Existing chats remain active</Text>
            <Text style={styles.infoItem}>✓ You can still chat with your partner</Text>
          </View>

          <TouchableOpacity style={[styles.exitButton, exiting && styles.exitButtonDisabled]} onPress={confirmExit} disabled={exiting}>
            <Text style={styles.exitButtonText}>{exiting ? 'Exiting...' : 'Exit Relationship Mode'}</Text>
          </TouchableOpacity>
        </View>
      ) : showSetup ? (
        <View style={styles.setupForm}>
          <Text style={styles.setupTitle}>Enter Relationship Mode</Text>
          <Text style={styles.setupSubtitle}>This will hide your profile from discovery and mark you as "in a relationship"</Text>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Partner's Name *</Text>
            <TextInput
              style={styles.input}
              placeholder="Who are you dating?"
              placeholderTextColor="#666"
              value={partnerName}
              onChangeText={setPartnerName}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Relationship Start Date (Optional)</Text>
            <TextInput
              style={styles.input}
              placeholder="YYYY-MM-DD (e.g., 2024-01-15)"
              placeholderTextColor="#666"
              value={startDate}
              onChangeText={setStartDate}
            />
            <Text style={styles.inputHint}>For anniversary tracking. Leave blank if unsure.</Text>
          </View>

          <TouchableOpacity style={[styles.enterButton, entering && styles.enterButtonDisabled]} onPress={() => void handleEnter()} disabled={entering}>
            <Text style={styles.enterButtonText}>{entering ? 'Activating...' : '💕 Enter Relationship Mode'}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.cancelSetupButton} onPress={() => setShowSetup(false)}>
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

          <TouchableOpacity style={styles.setupButton} onPress={() => setShowSetup(true)}>
            <Text style={styles.setupButtonText}>💕 Enter Relationship Mode</Text>
          </TouchableOpacity>

          <Text style={styles.disclaimer}>You can exit relationship mode anytime to start dating again.</Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  content: { padding: 20, paddingBottom: 40 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 40, marginBottom: 20 },
  backButton: { color: '#53a8b6', fontSize: 16 },
  title: { fontSize: 20, fontWeight: 'bold', color: '#eee' },
  celebrationCard: { backgroundColor: '#16213e', borderRadius: 15, padding: 30, alignItems: 'center', marginBottom: 20, borderWidth: 2, borderColor: '#e74c3c' },
  celebrationEmoji: { fontSize: 80, marginBottom: 15 },
  celebrationTitle: { fontSize: 24, fontWeight: 'bold', color: '#e74c3c', marginBottom: 5 },
  celebrationSubtitle: { fontSize: 16, color: '#888' },
  durationCard: { backgroundColor: '#16213e', borderRadius: 15, padding: 20, alignItems: 'center', marginBottom: 15 },
  durationLabel: { fontSize: 14, color: '#888', marginBottom: 8 },
  durationValue: { fontSize: 28, fontWeight: 'bold', color: '#e74c3c' },
  anniversaryCard: { backgroundColor: '#16213e', borderRadius: 15, padding: 15, marginBottom: 15, flexDirection: 'row', alignItems: 'center', gap: 15 },
  anniversaryIcon: { fontSize: 40 },
  anniversaryInfo: { flex: 1 },
  anniversaryLabel: { fontSize: 12, color: '#888' },
  anniversaryDate: { fontSize: 18, fontWeight: 'bold', color: '#eee', marginTop: 4 },
  anniversaryCountdown: { fontSize: 14, color: '#e67e22', marginTop: 4 },
  infoCard: { backgroundColor: '#0f3460', borderRadius: 15, padding: 15, marginBottom: 20 },
  infoTitle: { fontSize: 14, color: '#53a8b6', marginBottom: 10, fontWeight: '600' },
  infoItem: { fontSize: 13, color: '#888', marginBottom: 6 },
  exitButton: { backgroundColor: '#d9534f', paddingVertical: 16, borderRadius: 25, alignItems: 'center' },
  exitButtonDisabled: { backgroundColor: '#555' },
  exitButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  setupForm: {},
  setupTitle: { fontSize: 22, fontWeight: 'bold', color: '#eee', marginBottom: 10, textAlign: 'center' },
  setupSubtitle: { fontSize: 14, color: '#888', textAlign: 'center', marginBottom: 25, lineHeight: 20 },
  inputGroup: { marginBottom: 15 },
  inputLabel: { color: '#888', fontSize: 14, marginBottom: 6 },
  input: { backgroundColor: '#16213e', borderRadius: 12, padding: 14, color: '#eee', fontSize: 16, borderWidth: 1, borderColor: '#0f3460' },
  inputHint: { color: '#666', fontSize: 12, marginTop: 4 },
  enterButton: { backgroundColor: '#e74c3c', paddingVertical: 16, borderRadius: 25, alignItems: 'center', marginTop: 20 },
  enterButtonDisabled: { backgroundColor: '#555' },
  enterButtonText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  cancelSetupButton: { backgroundColor: '#0f3460', paddingVertical: 14, borderRadius: 25, alignItems: 'center', marginTop: 12 },
  cancelSetupButtonText: { color: '#888', fontSize: 14 },
  emptyContainer: { alignItems: 'center', paddingTop: 40 },
  emptyIcon: { fontSize: 80, marginBottom: 20 },
  emptyTitle: { fontSize: 24, fontWeight: 'bold', color: '#eee', marginBottom: 15 },
  emptyText: { fontSize: 16, color: '#888', textAlign: 'center', marginBottom: 25 },
  featuresCard: { backgroundColor: '#16213e', borderRadius: 15, padding: 20, width: '100%', marginBottom: 30 },
  featureItem: { color: '#aaa', fontSize: 14, marginBottom: 10 },
  setupButton: { backgroundColor: '#e74c3c', paddingVertical: 16, paddingHorizontal: 40, borderRadius: 25, marginBottom: 20 },
  setupButtonText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  disclaimer: { color: '#666', fontSize: 12, textAlign: 'center', fontStyle: 'italic' },
});