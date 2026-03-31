import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { DealBreakers, DEFAULT_DEAL_BREAKERS, getDealBreakers, saveDealBreakers } from '../utils/dealBreakers';

const RELIGIONS = ['Traditional', 'Modern', 'Spiritual', 'None'];

export default function DealBreakersScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dealBreakers, setDealBreakers] = useState<DealBreakers>(DEFAULT_DEAL_BREAKERS);

  useEffect(() => {
    loadDealBreakers();
  }, []);

  const loadDealBreakers = async () => {
    try {
      const data = await getDealBreakers();
      setDealBreakers(data);
    } catch (error) {
      console.error('[DealBreakers] Load error:', error);
      Alert.alert('Error', 'Failed to load deal breakers.');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const result = await saveDealBreakers(dealBreakers);
      if (result.success) {
        Alert.alert('Saved!', 'Your deal breakers have been updated.');
        router.back();
      } else {
        Alert.alert('Error', 'Failed to save deal breakers.');
      }
    } catch (error) {
      console.error('[DealBreakers] Save error:', error);
      Alert.alert('Error', 'An unexpected error occurred.');
    } finally {
      setSaving(false);
    }
  };

  const updateBreaker = (key: keyof DealBreakers, value: any) => {
    setDealBreakers({ ...dealBreakers, [key]: value });
  };

  if (loading) return <View style={styles.loadingContainer}><ActivityIndicator size="large" color="#53a8b6" /></View>;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}><TouchableOpacity onPress={() => router.back()}><Text style={styles.backButton}>← Back</Text></TouchableOpacity><Text style={styles.title}>Deal Breakers</Text><View style={{ width: 50 }} /></View>
      <Text style={styles.subtitle}>Set hard limits. Profiles that don't match these won't be shown.</Text>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>📸 Profile Quality</Text>
        <View style={styles.toggleRow}><Text style={styles.toggleLabel}>Must be verified</Text><Switch value={dealBreakers.mustHaveVerified} onValueChange={(v) => updateBreaker('mustHaveVerified', v)} trackColor={{ false: '#555', true: '#53a8b6' }} thumbColor="#fff" /></View>
        <View style={styles.toggleRow}><Text style={styles.toggleLabel}>Must have bio</Text><Switch value={dealBreakers.mustHaveBio} onValueChange={(v) => updateBreaker('mustHaveBio', v)} trackColor={{ false: '#555', true: '#53a8b6' }} thumbColor="#fff" /></View>
        <View style={styles.toggleRow}><Text style={styles.toggleLabel}>Must have 3+ photos</Text><Switch value={dealBreakers.mustHaveMultiplePhotos} onValueChange={(v) => updateBreaker('mustHaveMultiplePhotos', v)} trackColor={{ false: '#555', true: '#53a8b6' }} thumbColor="#fff" /></View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>🎂 Age Range</Text>
        <View style={styles.rangeRow}>
          <TextInput style={styles.rangeInput} placeholder="Min" placeholderTextColor="#666" value={dealBreakers.minAge?.toString() || ''} onChangeText={(t) => updateBreaker('minAge', t ? parseInt(t) : null)} keyboardType="number-pad" maxLength={2} />
          <Text style={styles.rangeDash}>to</Text>
          <TextInput style={styles.rangeInput} placeholder="Max" placeholderTextColor="#666" value={dealBreakers.maxAge?.toString() || ''} onChangeText={(t) => updateBreaker('maxAge', t ? parseInt(t) : null)} keyboardType="number-pad" maxLength={2} />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>📏 Height Range (cm)</Text>
        <View style={styles.rangeRow}>
          <TextInput style={styles.rangeInput} placeholder="Min" placeholderTextColor="#666" value={dealBreakers.minHeight?.toString() || ''} onChangeText={(t) => updateBreaker('minHeight', t ? parseInt(t) : null)} keyboardType="number-pad" maxLength={3} />
          <Text style={styles.rangeDash}>to</Text>
          <TextInput style={styles.rangeInput} placeholder="Max" placeholderTextColor="#666" value={dealBreakers.maxHeight?.toString() || ''} onChangeText={(t) => updateBreaker('maxHeight', t ? parseInt(t) : null)} keyboardType="number-pad" maxLength={3} />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>🚬 Lifestyle</Text>
        <View style={styles.toggleRow}><Text style={styles.toggleLabel}>No smoking</Text><Switch value={dealBreakers.noSmoking} onValueChange={(v) => updateBreaker('noSmoking', v)} trackColor={{ false: '#555', true: '#53a8b6' }} thumbColor="#fff" /></View>
        <View style={styles.toggleRow}><Text style={styles.toggleLabel}>No alcohol</Text><Switch value={dealBreakers.noDrinking} onValueChange={(v) => updateBreaker('noDrinking', v)} trackColor={{ false: '#555', true: '#53a8b6' }} thumbColor="#fff" /></View>
        <View style={styles.toggleRow}><Text style={styles.toggleLabel}>No drugs</Text><Switch value={dealBreakers.noDrugs} onValueChange={(v) => updateBreaker('noDrugs', v)} trackColor={{ false: '#555', true: '#53a8b6' }} thumbColor="#fff" /></View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>👶 Kids</Text>
        <View style={styles.toggleRow}><Text style={styles.toggleLabel}>Must want kids</Text><Switch value={dealBreakers.mustWantKids} onValueChange={(v) => { updateBreaker('mustWantKids', v); if (v) updateBreaker('mustNotWantKids', false); }} trackColor={{ false: '#555', true: '#53a8b6' }} thumbColor="#fff" /></View>
        <View style={styles.toggleRow}><Text style={styles.toggleLabel}>Must NOT want kids</Text><Switch value={dealBreakers.mustNotWantKids} onValueChange={(v) => { updateBreaker('mustNotWantKids', v); if (v) updateBreaker('mustWantKids', false); }} trackColor={{ false: '#555', true: '#53a8b6' }} thumbColor="#fff" /></View>
        <View style={styles.toggleRow}><Text style={styles.toggleLabel}>Must already have kids</Text><Switch value={dealBreakers.mustHaveKids} onValueChange={(v) => { updateBreaker('mustHaveKids', v); if (v) updateBreaker('mustNotHaveKids', false); }} trackColor={{ false: '#555', true: '#53a8b6' }} thumbColor="#fff" /></View>
        <View style={styles.toggleRow}><Text style={styles.toggleLabel}>Must NOT have kids</Text><Switch value={dealBreakers.mustNotHaveKids} onValueChange={(v) => { updateBreaker('mustNotHaveKids', v); if (v) updateBreaker('mustHaveKids', false); }} trackColor={{ false: '#555', true: '#53a8b6' }} thumbColor="#fff" /></View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>🙏 Religion</Text>
        <View style={styles.toggleRow}><Text style={styles.toggleLabel}>Same religion only</Text><Switch value={dealBreakers.sameReligionOnly} onValueChange={(v) => { updateBreaker('sameReligionOnly', v); if (v) updateBreaker('requiredReligion', null); }} trackColor={{ false: '#555', true: '#53a8b6' }} thumbColor="#fff" /></View>
        <Text style={styles.orText}>OR specific religion:</Text>
        <View style={styles.religionButtons}>
          {RELIGIONS.map((religion) => (
            <TouchableOpacity key={religion} style={[styles.religionButton, dealBreakers.requiredReligion === religion && styles.religionButtonActive]} onPress={() => { updateBreaker('requiredReligion', dealBreakers.requiredReligion === religion ? null : religion); updateBreaker('sameReligionOnly', false); }}>
              <Text style={[styles.religionButtonText, dealBreakers.requiredReligion === religion && styles.religionButtonTextActive]}>{religion}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>📍 Maximum Distance</Text>
        <View style={styles.distanceRow}>
          <TextInput style={styles.distanceInput} placeholder="No limit" placeholderTextColor="#666" value={dealBreakers.maxDistanceKm?.toString() || ''} onChangeText={(t) => updateBreaker('maxDistanceKm', t ? parseInt(t) : null)} keyboardType="number-pad" maxLength={4} />
          <Text style={styles.distanceUnit}>km</Text>
        </View>
      </View>

      <TouchableOpacity style={[styles.saveButton, saving && styles.saveButtonDisabled]} onPress={handleSave} disabled={saving}><Text style={styles.saveButtonText}>{saving ? 'Saving...' : '✓ Save Deal Breakers'}</Text></TouchableOpacity>
      <TouchableOpacity style={styles.resetButton} onPress={() => setDealBreakers(DEFAULT_DEAL_BREAKERS)}><Text style={styles.resetButtonText}>Reset to Default</Text></TouchableOpacity>
      <View style={{ height: 50 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' }, content: { padding: 20 }, loadingContainer: { flex: 1, backgroundColor: '#1a1a2e', justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, marginTop: 30 }, backButton: { color: '#53a8b6', fontSize: 16 }, title: { fontSize: 24, fontWeight: 'bold', color: '#eee' }, subtitle: { color: '#888', fontSize: 14, textAlign: 'center', marginBottom: 25, lineHeight: 20 },
  section: { backgroundColor: '#16213e', borderRadius: 15, padding: 16, marginBottom: 20 }, sectionTitle: { color: '#53a8b6', fontSize: 16, fontWeight: '600', marginBottom: 15 },
  toggleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#0f3460' }, toggleLabel: { color: '#eee', fontSize: 15 },
  rangeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 15 }, rangeInput: { backgroundColor: '#0f3460', color: '#fff', paddingVertical: 12, paddingHorizontal: 20, borderRadius: 10, fontSize: 18, fontWeight: '600', width: 100, textAlign: 'center' }, rangeDash: { color: '#888', fontSize: 16 },
  orText: { color: '#888', fontSize: 13, marginTop: 15, marginBottom: 10 }, religionButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, religionButton: { backgroundColor: '#0f3460', paddingVertical: 10, paddingHorizontal: 16, borderRadius: 20, borderWidth: 2, borderColor: '#0f3460' }, religionButtonActive: { backgroundColor: '#53a8b6', borderColor: '#53a8b6' }, religionButtonText: { color: '#888', fontSize: 14 }, religionButtonTextActive: { color: '#fff', fontWeight: '600' },
  distanceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 }, distanceInput: { backgroundColor: '#0f3460', color: '#fff', paddingVertical: 12, paddingHorizontal: 20, borderRadius: 10, fontSize: 18, fontWeight: '600', width: 120, textAlign: 'center' }, distanceUnit: { color: '#888', fontSize: 16 },
  saveButton: { backgroundColor: '#5cb85c', paddingVertical: 16, borderRadius: 25, alignItems: 'center', marginTop: 10 }, saveButtonDisabled: { backgroundColor: '#555' }, saveButtonText: { color: '#fff', fontSize: 18, fontWeight: '600' },
  resetButton: { paddingVertical: 14, alignItems: 'center', marginTop: 10 }, resetButtonText: { color: '#d9534f', fontSize: 16 },
});