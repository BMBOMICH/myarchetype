import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Linking,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View
} from 'react-native';
import {
    checkInSafe,
    DatePlan,
    EmergencyContact,
    getActiveDatePlan,
    getEmergencyContacts,
    saveEmergencyContacts,
    shouldShowCheckIn,
    triggerEmergency
} from '../utils/dateSafety';

export default function DateSafetyScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  
  // Emergency contacts
  const [contacts, setContacts] = useState<EmergencyContact[]>([]);
  const [editingContacts, setEditingContacts] = useState(false);
  const [newContactName, setNewContactName] = useState('');
  const [newContactPhone, setNewContactPhone] = useState('');
  const [newContactRelation, setNewContactRelation] = useState('');
  
  // Active date plan
  const [activeDatePlan, setActiveDatePlan] = useState<DatePlan | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const [emergencyContacts, datePlan] = await Promise.all([
      getEmergencyContacts(),
      getActiveDatePlan(),
    ]);

    setContacts(emergencyContacts);
    setActiveDatePlan(datePlan);
    setLoading(false);
  };

  const handleAddContact = async () => {
    if (!newContactName.trim() || !newContactPhone.trim()) {
      Alert.alert('Error', 'Please fill in name and phone number');
      return;
    }

    const newContact: EmergencyContact = {
      name: newContactName.trim(),
      phone: newContactPhone.trim(),
      relationship: newContactRelation.trim() || 'Friend',
    };

    const updated = [...contacts, newContact];
    const success = await saveEmergencyContacts(updated);

    if (success) {
      setContacts(updated);
      setNewContactName('');
      setNewContactPhone('');
      setNewContactRelation('');
      Alert.alert('Success', 'Emergency contact added');
    } else {
      Alert.alert('Error', 'Failed to save contact');
    }
  };

  const handleRemoveContact = async (index: number) => {
    const updated = contacts.filter((_, i) => i !== index);
    const success = await saveEmergencyContacts(updated);

    if (success) {
      setContacts(updated);
      Alert.alert('Success', 'Contact removed');
    }
  };

  const handleCheckIn = async () => {
    if (!activeDatePlan) return;

    const confirmed = confirm('Check in as safe?\n\nThis will notify your emergency contacts that you\'re okay.');
    
    if (!confirmed) return;

    const success = await checkInSafe(activeDatePlan.id);

    if (success) {
      Alert.alert('✅ Checked In', 'You\'ve been marked as safe. Your date plan is now complete.');
      setActiveDatePlan(null);
    } else {
      Alert.alert('Error', 'Failed to check in');
    }
  };

  const handleEmergency = async () => {
    if (!activeDatePlan) {
      // No active date, just call emergency
      Alert.alert(
        '🚨 Call Emergency?',
        'This will call 112 (emergency services).',
        [
          { text: 'Cancel', style: 'cancel' },
          { 
            text: 'Call 112', 
            style: 'destructive',
            onPress: () => Linking.openURL('tel:112')
          },
        ]
      );
      return;
    }

    Alert.alert(
      '🚨 EMERGENCY ALERT',
      'This will:\n\n' +
      '• Call 112 (emergency services)\n' +
      '• Notify your emergency contacts\n' +
      '• Share your date location\n\n' +
      'Only use this if you are in danger!',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'TRIGGER EMERGENCY', 
          style: 'destructive',
          onPress: () => triggerEmergency(activeDatePlan.id)
        },
      ]
    );
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
        <Text style={styles.title}>🛡️ Date Safety</Text>
        <View style={{ width: 60 }} />
      </View>

      {/* Emergency Button (Always Visible) */}
      <TouchableOpacity style={styles.emergencyButton} onPress={handleEmergency}>
        <Text style={styles.emergencyButtonIcon}>🚨</Text>
        <Text style={styles.emergencyButtonText}>EMERGENCY</Text>
        <Text style={styles.emergencyButtonSubtext}>
          Tap if you need immediate help
        </Text>
      </TouchableOpacity>

      {/* Active Date Plan */}
      {activeDatePlan && (
        <View style={styles.activeDateCard}>
          <Text style={styles.activeDateTitle}>📅 Active Date Plan</Text>
          
          <View style={styles.activeDateInfo}>
            <Text style={styles.activeDateLabel}>Meeting:</Text>
            <Text style={styles.activeDateValue}>{activeDatePlan.matchName}</Text>
          </View>

          <View style={styles.activeDateInfo}>
            <Text style={styles.activeDateLabel}>Location:</Text>
            <Text style={styles.activeDateValue}>{activeDatePlan.location}</Text>
          </View>

          <View style={styles.activeDateInfo}>
            <Text style={styles.activeDateLabel}>Time:</Text>
            <Text style={styles.activeDateValue}>
              {new Date(activeDatePlan.dateTime).toLocaleString()}
            </Text>
          </View>

          <View style={styles.activeDateInfo}>
            <Text style={styles.activeDateLabel}>Check-in time:</Text>
            <Text style={styles.activeDateValue}>
              {new Date(activeDatePlan.checkInTime).toLocaleTimeString()}
            </Text>
          </View>

          {shouldShowCheckIn(activeDatePlan) && (
            <TouchableOpacity style={styles.checkInButton} onPress={handleCheckIn}>
              <Text style={styles.checkInButtonText}>✓ Check In (I'm Safe)</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Emergency Contacts */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Emergency Contacts</Text>
          <TouchableOpacity onPress={() => setEditingContacts(!editingContacts)}>
            <Text style={styles.editButton}>
              {editingContacts ? 'Done' : 'Edit'}
            </Text>
          </TouchableOpacity>
        </View>

        {contacts.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyStateText}>
              No emergency contacts added yet.{'\n'}
              Add someone who can help in an emergency.
            </Text>
          </View>
        ) : (
          contacts.map((contact, index) => (
            <View key={index} style={styles.contactCard}>
              <View style={styles.contactInfo}>
                <Text style={styles.contactName}>{contact.name}</Text>
                <Text style={styles.contactPhone}>{contact.phone}</Text>
                <Text style={styles.contactRelation}>{contact.relationship}</Text>
              </View>
              {editingContacts && (
                <TouchableOpacity
                  style={styles.removeButton}
                  onPress={() => handleRemoveContact(index)}
                >
                  <Text style={styles.removeButtonText}>✕</Text>
                </TouchableOpacity>
              )}
            </View>
          ))
        )}

        {editingContacts && (
          <View style={styles.addContactForm}>
            <Text style={styles.formTitle}>Add Emergency Contact</Text>
            
            <TextInput
              style={styles.input}
              placeholder="Name"
              placeholderTextColor="#666"
              value={newContactName}
              onChangeText={setNewContactName}
            />

            <TextInput
              style={styles.input}
              placeholder="Phone Number"
              placeholderTextColor="#666"
              value={newContactPhone}
              onChangeText={setNewContactPhone}
              keyboardType="phone-pad"
            />

            <TextInput
              style={styles.input}
              placeholder="Relationship (e.g., Friend, Parent)"
              placeholderTextColor="#666"
              value={newContactRelation}
              onChangeText={setNewContactRelation}
            />

            <TouchableOpacity style={styles.addButton} onPress={handleAddContact}>
              <Text style={styles.addButtonText}>+ Add Contact</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Safety Tips */}
      <View style={styles.tipsCard}>
        <Text style={styles.tipsTitle}>💡 Safety Tips</Text>
        <Text style={styles.tipsText}>
          • Always meet in public places{'\n'}
          • Tell someone where you're going{'\n'}
          • Keep your phone charged{'\n'}
          • Trust your instincts{'\n'}
          • Don't share personal info too soon{'\n'}
          • Have your own transportation{'\n'}
          • Set up a check-in time
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 30,
    marginBottom: 20,
  },
  backButton: {
    color: '#53a8b6',
    fontSize: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#eee',
  },
  emergencyButton: {
    backgroundColor: '#d9534f',
    borderRadius: 15,
    padding: 25,
    alignItems: 'center',
    marginBottom: 25,
    borderWidth: 3,
    borderColor: '#ff6b6b',
  },
  emergencyButtonIcon: {
    fontSize: 50,
    marginBottom: 10,
  },
  emergencyButtonText: {
    color: '#fff',
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 5,
  },
  emergencyButtonSubtext: {
    color: 'rgba(255, 255, 255, 0.8)',
    fontSize: 14,
  },
  activeDateCard: {
    backgroundColor: '#16213e',
    borderRadius: 15,
    padding: 20,
    marginBottom: 25,
    borderWidth: 2,
    borderColor: '#e67e22',
  },
  activeDateTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#e67e22',
    marginBottom: 15,
  },
  activeDateInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  activeDateLabel: {
    color: '#888',
    fontSize: 14,
  },
  activeDateValue: {
    color: '#eee',
    fontSize: 14,
    fontWeight: '600',
  },
  checkInButton: {
    backgroundColor: '#5cb85c',
    paddingVertical: 15,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 15,
  },
  checkInButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  section: {
    marginBottom: 25,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 15,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#53a8b6',
  },
  editButton: {
    color: '#53a8b6',
    fontSize: 16,
  },
  emptyState: {
    backgroundColor: '#16213e',
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
  },
  emptyStateText: {
    color: '#888',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 22,
  },
  contactCard: {
    backgroundColor: '#16213e',
    borderRadius: 12,
    padding: 15,
    marginBottom: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  contactInfo: {
    flex: 1,
  },
  contactName: {
    color: '#eee',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  contactPhone: {
    color: '#53a8b6',
    fontSize: 14,
    marginBottom: 4,
  },
  contactRelation: {
    color: '#888',
    fontSize: 12,
  },
  removeButton: {
    backgroundColor: '#d9534f',
    width: 30,
    height: 30,
    borderRadius: 15,
    justifyContent: 'center',
    alignItems: 'center',
  },
  removeButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  addContactForm: {
    backgroundColor: '#16213e',
    borderRadius: 15,
    padding: 20,
    marginTop: 15,
  },
  formTitle: {
    color: '#53a8b6',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 15,
  },
  input: {
    backgroundColor: '#0f3460',
    color: '#fff',
    padding: 15,
    borderRadius: 10,
    fontSize: 15,
    marginBottom: 12,
  },
  addButton: {
    backgroundColor: '#5cb85c',
    paddingVertical: 15,
    borderRadius: 10,
    alignItems: 'center',
  },
  addButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  tipsCard: {
    backgroundColor: 'rgba(83, 168, 182, 0.1)',
    borderRadius: 15,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(83, 168, 182, 0.3)',
  },
  tipsTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#53a8b6',
    marginBottom: 12,
  },
  tipsText: {
    color: '#aaa',
    fontSize: 14,
    lineHeight: 24,
  },
});