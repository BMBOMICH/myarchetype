import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import {
    cancelCheckin,
    DateCheckin,
    formatCheckinStatus,
    getActiveCheckin,
    getTimeUntilNextCheckin,
    performCheckin,
    startDateCheckin,
} from '../utils/dateCheckin';

export default function DateCheckinScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [activeCheckin, setActiveCheckin] = useState<DateCheckin | null>(null);
  const [showSetup, setShowSetup] = useState(false);

  // Setup form
  const [matchId, setMatchId] = useState('');
  const [matchName, setMatchName] = useState('');
  const [location, setLocation] = useState('');
  const [duration, setDuration] = useState('2');
  const [intervalMinutes, setIntervalMinutes] = useState('60');
  const [emergencyName, setEmergencyName] = useState('');
  const [emergencyPhone, setEmergencyPhone] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    loadCheckin();
    const interval = setInterval(loadCheckin, 30000); // Refresh every 30 sec
    return () => clearInterval(interval);
  }, []);

  const loadCheckin = async () => {
    const checkin = await getActiveCheckin();
    setActiveCheckin(checkin);
    setLoading(false);
  };

  const handleStartCheckin = async () => {
    if (!matchName || !location) {
      Alert.alert('Missing Info', 'Please fill in match name and location');
      return;
    }

    setCreating(true);
    const result = await startDateCheckin(
      matchId || 'manual',
      matchName,
      location,
      parseFloat(duration),
      parseInt(intervalMinutes),
      emergencyName && emergencyPhone ? { name: emergencyName, phone: emergencyPhone } : undefined
    );
    setCreating(false);

    if (result.success) {
      Alert.alert('✅ Check-in Started!', 'We\'ll remind you to check in periodically. Stay safe!');
      setShowSetup(false);
      loadCheckin();
    } else {
      Alert.alert('Error', result.error || 'Could not start check-in');
    }
  };

  const handleCheckin = async (status: 'ok' | 'extend' | 'end' | 'sos') => {
    if (!activeCheckin) return;

    let extendTime: number | undefined;
    let note: string | undefined;

    if (status === 'extend') {
      const input = prompt('Extend by how many hours?', '1');
      if (!input) return;
      extendTime = parseFloat(input) * 60;
    }

    if (status === 'sos') {
      const confirmed = confirm(
        '🚨 EMERGENCY ALERT\n\n' +
        'This will:\n' +
        '- Alert your emergency contact\n' +
        '- Share your location\n' +
        '- Log the incident\n\n' +
        'Are you in danger?'
      );
      if (!confirmed) return;
    }

    const result = await performCheckin(activeCheckin.id, status, note, extendTime);

    if (result.success) {
      if (status === 'ok') {
        Alert.alert('✅ Checked In', 'Great! Next check-in in ' + intervalMinutes + ' minutes');
      } else if (status === 'extend') {
        Alert.alert('⏰ Extended', 'Date time extended. Have fun!');
      } else if (status === 'end') {
        Alert.alert('✅ Date Ended', 'Hope you had a great time!');
      } else if (status === 'sos') {
        Alert.alert('🚨 ALERT SENT', 'Emergency contacts have been notified. Stay safe!');
      }
      loadCheckin();
    }
  };

  const handleCancel = async () => {
    if (!activeCheckin) return;

    const confirmed = confirm('Cancel safety check-in?');
    if (!confirmed) return;

    const result = await cancelCheckin(activeCheckin.id);
    if (result.success) {
      loadCheckin();
    }
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#53a8b6" />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.backButton}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>🛡️ Date Check-In</Text>
        <View style={{ width: 50 }} />
      </View>

      {/* Active Check-in */}
      {activeCheckin ? (
        <View>
          {/* Status Card */}
          <View style={styles.statusCard}>
            {(() => {
              const status = formatCheckinStatus(activeCheckin);
              return (
                <>
                  <Text style={styles.statusIcon}>{status.icon}</Text>
                  <Text style={[styles.statusLabel, { color: status.color }]}>{status.label}</Text>
                </>
              );
            })()}
          </View>

          {/* Info */}
          <View style={styles.infoCard}>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>With:</Text>
              <Text style={styles.infoValue}>{activeCheckin.matchName}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Location:</Text>
              <Text style={styles.infoValue}>{activeCheckin.location}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Started:</Text>
              <Text style={styles.infoValue}>
                {new Date(activeCheckin.startTime).toLocaleTimeString()}
              </Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Expected End:</Text>
              <Text style={styles.infoValue}>
                {new Date(activeCheckin.expectedEndTime).toLocaleTimeString()}
              </Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Next Check-in:</Text>
              <Text style={styles.infoValue}>
                {getTimeUntilNextCheckin(activeCheckin.nextCheckinDue)}
              </Text>
            </View>
          </View>

          {/* Emergency Contact */}
          {activeCheckin.emergencyContact && (
            <View style={styles.emergencyCard}>
              <Text style={styles.emergencyLabel}>Emergency Contact</Text>
              <Text style={styles.emergencyName}>{activeCheckin.emergencyContact.name}</Text>
              <Text style={styles.emergencyPhone}>{activeCheckin.emergencyContact.phone}</Text>
            </View>
          )}

          {/* Check-in History */}
          {activeCheckin.checkins.length > 0 && (
            <View style={styles.historyCard}>
              <Text style={styles.historyTitle}>Check-in History</Text>
              {activeCheckin.checkins.map((checkin, index) => (
                <View key={index} style={styles.historyItem}>
                  <Text style={styles.historyTime}>
                    {new Date(checkin.timestamp).toLocaleTimeString()}
                  </Text>
                  <Text style={styles.historyStatus}>
                    {checkin.status === 'ok' ? '✅ Safe' :
                     checkin.status === 'extend' ? '⏰ Extended' :
                     checkin.status === 'end' ? '🏁 Ended' :
                     '🚨 SOS'}
                  </Text>
                </View>
              ))}
            </View>
          )}

          {/* Actions */}
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.actionButton, styles.actionOk]}
              onPress={() => handleCheckin('ok')}
            >
              <Text style={styles.actionButtonText}>✓ I'm Safe</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionButton, styles.actionExtend]}
              onPress={() => handleCheckin('extend')}
            >
              <Text style={styles.actionButtonText}>⏰ Extend Time</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionButton, styles.actionEnd]}
              onPress={() => handleCheckin('end')}
            >
              <Text style={styles.actionButtonText}>🏁 End Date</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionButton, styles.actionSOS]}
              onPress={() => handleCheckin('sos')}
            >
              <Text style={styles.actionButtonText}>🚨 EMERGENCY</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.cancelButton}
              onPress={handleCancel}
            >
              <Text style={styles.cancelButtonText}>Cancel Check-in</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : showSetup ? (
        /* Setup Form */
        <View style={styles.setupForm}>
          <Text style={styles.setupTitle}>Start Date Check-In</Text>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Match Name *</Text>
            <TextInput
              style={styles.input}
              placeholder="Who are you meeting?"
              placeholderTextColor="#666"
              value={matchName}
              onChangeText={setMatchName}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Location *</Text>
            <TextInput
              style={styles.input}
              placeholder="Restaurant name or address"
              placeholderTextColor="#666"
              value={location}
              onChangeText={setLocation}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Expected Duration (hours)</Text>
            <TextInput
              style={styles.input}
              placeholder="2"
              placeholderTextColor="#666"
              keyboardType="decimal-pad"
              value={duration}
              onChangeText={setDuration}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Check-in Interval (minutes)</Text>
            <TextInput
              style={styles.input}
              placeholder="60"
              placeholderTextColor="#666"
              keyboardType="number-pad"
              value={intervalMinutes}
              onChangeText={setIntervalMinutes}
            />
          </View>

          <Text style={styles.sectionTitle}>Emergency Contact (Optional)</Text>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Name</Text>
            <TextInput
              style={styles.input}
              placeholder="Friend or family member"
              placeholderTextColor="#666"
              value={emergencyName}
              onChangeText={setEmergencyName}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Phone</Text>
            <TextInput
              style={styles.input}
              placeholder="+1234567890"
              placeholderTextColor="#666"
              keyboardType="phone-pad"
              value={emergencyPhone}
              onChangeText={setEmergencyPhone}
            />
          </View>

          <TouchableOpacity
            style={[styles.startButton, creating && styles.startButtonDisabled]}
            onPress={handleStartCheckin}
            disabled={creating}
          >
            <Text style={styles.startButtonText}>
              {creating ? 'Starting...' : '🛡️ Start Check-In'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.cancelSetupButton}
            onPress={() => setShowSetup(false)}
          >
            <Text style={styles.cancelSetupButtonText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      ) : (
        /* No Active Check-in */
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>🛡️</Text>
          <Text style={styles.emptyTitle}>Date Safety Check-In</Text>
          <Text style={styles.emptyText}>
            Going on a first date? Let us know so we can check in on you periodically and make sure you're safe.
          </Text>

          <View style={styles.featuresCard}>
            <Text style={styles.featuresTitle}>How it works:</Text>
            <Text style={styles.featureItem}>✓ Set your expected date duration</Text>
            <Text style={styles.featureItem}>✓ We'll remind you to check in every hour</Text>
            <Text style={styles.featureItem}>✓ Optional emergency contact</Text>
            <Text style={styles.featureItem}>✓ SOS button if you need help</Text>
          </View>

          <TouchableOpacity
            style={styles.setupButton}
            onPress={() => setShowSetup(true)}
          >
            <Text style={styles.setupButtonText}>🛡️ Set Up Check-In</Text>
          </TouchableOpacity>
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

  // Active check-in
  statusCard: { backgroundColor: '#16213e', borderRadius: 15, padding: 25, alignItems: 'center', marginBottom: 20, borderWidth: 2, borderColor: '#5cb85c' },
  statusIcon: { fontSize: 60, marginBottom: 10 },
  statusLabel: { fontSize: 20, fontWeight: 'bold' },

  infoCard: { backgroundColor: '#16213e', borderRadius: 15, padding: 15, marginBottom: 15 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#0f3460' },
  infoLabel: { color: '#888', fontSize: 14 },
  infoValue: { color: '#eee', fontSize: 14, fontWeight: '600' },

  emergencyCard: { backgroundColor: '#d9534f', borderRadius: 15, padding: 15, marginBottom: 15 },
  emergencyLabel: { color: '#fff', fontSize: 12, marginBottom: 5 },
  emergencyName: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  emergencyPhone: { color: '#fff', fontSize: 14, marginTop: 2 },

  historyCard: { backgroundColor: '#16213e', borderRadius: 15, padding: 15, marginBottom: 20 },
  historyTitle: { color: '#53a8b6', fontSize: 14, fontWeight: 'bold', marginBottom: 10 },
  historyItem: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  historyTime: { color: '#888', fontSize: 13 },
  historyStatus: { color: '#eee', fontSize: 13 },

  actions: { gap: 12 },
  actionButton: { paddingVertical: 16, borderRadius: 25, alignItems: 'center' },
  actionOk: { backgroundColor: '#5cb85c' },
  actionExtend: { backgroundColor: '#e67e22' },
  actionEnd: { backgroundColor: '#3498db' },
  actionSOS: { backgroundColor: '#d9534f' },
  actionButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  cancelButton: { backgroundColor: '#0f3460', paddingVertical: 14, borderRadius: 25, alignItems: 'center', marginTop: 10 },
  cancelButtonText: { color: '#888', fontSize: 14 },

  // Setup
  setupForm: {},
  setupTitle: { fontSize: 22, fontWeight: 'bold', color: '#eee', marginBottom: 20, textAlign: 'center' },
  inputGroup: { marginBottom: 15 },
  inputLabel: { color: '#888', fontSize: 14, marginBottom: 6 },
  input: { backgroundColor: '#16213e', borderRadius: 12, padding: 14, color: '#eee', fontSize: 16, borderWidth: 1, borderColor: '#0f3460' },
  sectionTitle: { fontSize: 16, fontWeight: 'bold', color: '#53a8b6', marginTop: 20, marginBottom: 15 },
  startButton: { backgroundColor: '#5cb85c', paddingVertical: 16, borderRadius: 25, alignItems: 'center', marginTop: 20 },
  startButtonDisabled: { backgroundColor: '#555' },
  startButtonText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  cancelSetupButton: { backgroundColor: '#0f3460', paddingVertical: 14, borderRadius: 25, alignItems: 'center', marginTop: 12 },
  cancelSetupButtonText: { color: '#888', fontSize: 14 },

  // Empty state
  emptyContainer: { alignItems: 'center', paddingTop: 40 },
  emptyIcon: { fontSize: 80, marginBottom: 20 },
  emptyTitle: { fontSize: 24, fontWeight: 'bold', color: '#eee', marginBottom: 15 },
  emptyText: { fontSize: 16, color: '#888', textAlign: 'center', lineHeight: 24, marginBottom: 30 },
  featuresCard: { backgroundColor: '#16213e', borderRadius: 15, padding: 20, width: '100%', marginBottom: 30 },
  featuresTitle: { color: '#53a8b6', fontSize: 16, fontWeight: 'bold', marginBottom: 12 },
  featureItem: { color: '#aaa', fontSize: 14, marginBottom: 8 },
  setupButton: { backgroundColor: '#5cb85c', paddingVertical: 16, paddingHorizontal: 40, borderRadius: 25 },
  setupButtonText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
});