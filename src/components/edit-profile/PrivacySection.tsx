import React from 'react';
import { Switch, Text, View } from 'react-native';
import { s } from './styles';

interface PrivacySectionProps {
  showOnProfile: boolean;
  showAge: boolean;
  showDistance: boolean;
  onShowProfileChange: (v: boolean) => void;
  onShowAgeChange: (v: boolean) => void;
  onShowDistanceChange: (v: boolean) => void;
}

export function PrivacySection({
  showOnProfile,
  showAge,
  showDistance,
  onShowProfileChange,
  onShowAgeChange,
  onShowDistanceChange,
}: PrivacySectionProps) {
  return (
    <View style={s.fieldSection}>
      <Text style={s.sectionTitle}>Privacy</Text>

      <View style={s.toggleRow}>
        <View style={s.toggleInfo}>
          <Text style={s.toggleLabel}>Show profile</Text>
          <Text style={s.toggleDesc}>Others can discover your profile</Text>
        </View>
        <Switch
          value={showOnProfile}
          onValueChange={onShowProfileChange}
          trackColor={{ false: '#28285a', true: '#6C63FF' }}
          thumbColor="#fff"
          accessibilityLabel="Show profile"
        />
      </View>

      <View style={s.toggleRow}>
        <View style={s.toggleInfo}>
          <Text style={s.toggleLabel}>Show age</Text>
          <Text style={s.toggleDesc}>Display your age on your profile</Text>
        </View>
        <Switch
          value={showAge}
          onValueChange={onShowAgeChange}
          trackColor={{ false: '#28285a', true: '#6C63FF' }}
          thumbColor="#fff"
          accessibilityLabel="Show age"
        />
      </View>

      <View style={s.toggleRow}>
        <View style={s.toggleInfo}>
          <Text style={s.toggleLabel}>Show distance</Text>
          <Text style={s.toggleDesc}>Display your distance to matches</Text>
        </View>
        <Switch
          value={showDistance}
          onValueChange={onShowDistanceChange}
          trackColor={{ false: '#28285a', true: '#6C63FF' }}
          thumbColor="#fff"
          accessibilityLabel="Show distance"
        />
      </View>
    </View>
  );
}