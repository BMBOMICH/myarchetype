import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { getUserInterests, INTERESTS_CATEGORIES, saveUserInterests } from '../utils/interestsTags';

const MAX_INTERESTS = 15;

export default function InterestsScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedInterests, setSelectedInterests] = useState<string[]>([]);

  useEffect(() => {
    loadInterests();
  }, []);

  const loadInterests = async () => {
    const interests = await getUserInterests();
    setSelectedInterests(interests);
    setLoading(false);
  };

  const toggleInterest = (interest: string) => {
    if (selectedInterests.includes(interest)) {
      setSelectedInterests(selectedInterests.filter(i => i !== interest));
    } else {
      if (selectedInterests.length >= MAX_INTERESTS) {
        Alert.alert('Limit Reached', `You can select up to ${MAX_INTERESTS} interests.`);
        return;
      }
      setSelectedInterests([...selectedInterests, interest]);
    }
  };

  const handleSave = async () => {
    if (selectedInterests.length < 3) {
      Alert.alert('Too Few', 'Please select at least 3 interests.');
      return;
    }

    setSaving(true);
    const result = await saveUserInterests(selectedInterests);
    setSaving(false);

    if (result.success) {
      Alert.alert('Saved!', 'Your interests have been updated.');
      router.back();
    } else {
      Alert.alert('Error', 'Failed to save interests.');
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#53a8b6" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.backButton}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Your Interests</Text>
        <View style={{ width: 50 }} />
      </View>

      <View style={styles.counterBar}>
        <Text style={styles.counterText}>
          {selectedInterests.length} / {MAX_INTERESTS} selected
        </Text>
        {selectedInterests.length < 3 && (
          <Text style={styles.minText}>Min 3 required</Text>
        )}
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        {Object.entries(INTERESTS_CATEGORIES).map(([category, interests]) => (
          <View key={category} style={styles.categorySection}>
            <Text style={styles.categoryTitle}>{category}</Text>
            <View style={styles.interestsGrid}>
              {interests.map((interest) => (
                <TouchableOpacity
                  key={interest}
                  style={[
                    styles.interestChip,
                    selectedInterests.includes(interest) && styles.interestChipActive,
                  ]}
                  onPress={() => toggleInterest(interest)}
                >
                  <Text style={[
                    styles.interestChipText,
                    selectedInterests.includes(interest) && styles.interestChipTextActive,
                  ]}>
                    {interest}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ))}

        <View style={{ height: 100 }} />
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.saveButton, (saving || selectedInterests.length < 3) && styles.saveButtonDisabled]}
          onPress={handleSave}
          disabled={saving || selectedInterests.length < 3}
        >
          <Text style={styles.saveButtonText}>
            {saving ? 'Saving...' : '✓ Save Interests'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  loadingContainer: { flex: 1, backgroundColor: '#1a1a2e', justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingTop: 60, backgroundColor: '#16213e', borderBottomWidth: 1, borderBottomColor: '#0f3460' },
  backButton: { color: '#53a8b6', fontSize: 16 },
  title: { fontSize: 20, fontWeight: 'bold', color: '#eee' },
  counterBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 15, backgroundColor: '#0f3460' },
  counterText: { color: '#53a8b6', fontSize: 14, fontWeight: '600' },
  minText: { color: '#e67e22', fontSize: 12 },
  scrollView: { flex: 1 },
  content: { padding: 20 },
  categorySection: { marginBottom: 25 },
  categoryTitle: { color: '#e67e22', fontSize: 16, fontWeight: 'bold', marginBottom: 12 },
  interestsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  interestChip: { backgroundColor: '#16213e', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 20, borderWidth: 2, borderColor: '#16213e' },
  interestChipActive: { backgroundColor: '#0f3460', borderColor: '#53a8b6' },
  interestChipText: { color: '#888', fontSize: 14 },
  interestChipTextActive: { color: '#53a8b6', fontWeight: '600' },
  footer: { padding: 20, backgroundColor: '#16213e', borderTopWidth: 1, borderTopColor: '#0f3460' },
  saveButton: { backgroundColor: '#5cb85c', paddingVertical: 16, borderRadius: 25, alignItems: 'center' },
  saveButtonDisabled: { backgroundColor: '#555' },
  saveButtonText: { color: '#fff', fontSize: 18, fontWeight: '600' },
});