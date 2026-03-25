import { useRouter } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import {
    calculateProfileCompletion,
    getCompletionColor,
    getCompletionMessage,
} from '../utils/profileCompletion';

interface ProfileCompletionCardProps {
  userData: any;
  showDetails?: boolean;
}

export default function ProfileCompletionCard({
  userData,
  showDetails = true,
}: ProfileCompletionCardProps) {
  const router = useRouter();
  const completion = calculateProfileCompletion(userData);
  const color = getCompletionColor(completion.percentage);
  const message = getCompletionMessage(completion.percentage);

  if (completion.percentage >= 100 && !showDetails) {
    return null; // Don't show if complete and not in detail mode
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Profile Completion</Text>
        <Text style={[styles.percentage, { color }]}>{completion.percentage}%</Text>
      </View>

      {/* Progress Bar */}
      <View style={styles.progressBarBg}>
        <View
          style={[
            styles.progressBarFill,
            { width: `${completion.percentage}%`, backgroundColor: color },
          ]}
        />
      </View>

      <Text style={styles.message}>{message}</Text>

      {/* Missing Items */}
      {showDetails && completion.missing.length > 0 && (
        <View style={styles.missingSection}>
          <Text style={styles.missingTitle}>Missing:</Text>
          <View style={styles.missingList}>
            {completion.missing.slice(0, 5).map((item, index) => (
              <View key={index} style={styles.missingItem}>
                <Text style={styles.missingDot}>○</Text>
                <Text style={styles.missingText}>{item}</Text>
              </View>
            ))}
            {completion.missing.length > 5 && (
              <Text style={styles.moreText}>
                +{completion.missing.length - 5} more
              </Text>
            )}
          </View>
        </View>
      )}

      {/* Tips */}
      {showDetails && completion.tips.length > 0 && (
        <View style={styles.tipsSection}>
          <Text style={styles.tipsTitle}>💡 Tips:</Text>
          {completion.tips.map((tip, index) => (
            <Text key={index} style={styles.tipText}>• {tip}</Text>
          ))}
        </View>
      )}

      {/* Edit Profile Button */}
      {completion.percentage < 100 && (
        <TouchableOpacity
          style={[styles.editButton, { backgroundColor: color }]}
          onPress={() => router.push('/edit-profile')}
        >
          <Text style={styles.editButtonText}>Complete Profile</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#16213e',
    borderRadius: 15,
    padding: 20,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#0f3460',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    color: '#eee',
  },
  percentage: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  progressBarBg: {
    height: 10,
    backgroundColor: '#0f3460',
    borderRadius: 5,
    overflow: 'hidden',
    marginBottom: 10,
  },
  progressBarFill: {
    height: 10,
    borderRadius: 5,
  },
  message: {
    fontSize: 13,
    color: '#aaa',
    marginBottom: 15,
  },
  missingSection: {
    marginBottom: 15,
  },
  missingTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#d9534f',
    marginBottom: 8,
  },
  missingList: {
    gap: 4,
  },
  missingItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  missingDot: {
    color: '#888',
    marginRight: 8,
    fontSize: 12,
  },
  missingText: {
    color: '#888',
    fontSize: 13,
  },
  moreText: {
    color: '#666',
    fontSize: 12,
    marginTop: 4,
    fontStyle: 'italic',
  },
  tipsSection: {
    backgroundColor: '#0f3460',
    borderRadius: 10,
    padding: 12,
    marginBottom: 15,
  },
  tipsTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#e67e22',
    marginBottom: 8,
  },
  tipText: {
    color: '#ccc',
    fontSize: 13,
    marginBottom: 4,
    lineHeight: 18,
  },
  editButton: {
    paddingVertical: 12,
    borderRadius: 20,
    alignItems: 'center',
  },
  editButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
});