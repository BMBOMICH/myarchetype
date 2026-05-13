import React from 'react';
import { Image, Platform, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { StyleSheet } from 'react-native-unistyles';
import { AVATAR_SIZE, MAX_FONT_SCALE } from './types';

const getGreeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};

interface ProfileHeaderProps {
  userPhoto: string;
  selfieVerified: boolean;
  isChampion: boolean;
  userName: string;
  loginStreak: number;
  longestStreak: number;
  personalityType: string;
  maskedEmail: string;
  reducedMotion: boolean;
}

export const ProfileHeader = React.memo(function ProfileHeader({
  userPhoto, selfieVerified, isChampion, userName, loginStreak, longestStreak,
  personalityType, maskedEmail, reducedMotion,
}: ProfileHeaderProps) {
  const greeting   = getGreeting();
  const streakA11y = loginStreak > 1
    ? `${loginStreak} day login streak${loginStreak === longestStreak && loginStreak >= 7 ? ', personal best!' : ''}`
    : loginStreak === 1 ? 'Come back tomorrow to start a streak' : '';

  const content = (
    <View style={styles.container} accessibilityRole="summary">
      <View style={styles.photoWrap}>
        {userPhoto ? (
          <Image
            source={{ uri: userPhoto }}
            style={styles.photo}
            resizeMode="cover"
            accessibilityLabel={`${userName}'s profile photo`}
          />
        ) : (
          <View
            style={styles.photoPlaceholder}
            accessibilityLabel="No profile photo. Tap Edit Profile to add one."
            accessibilityRole="image"
          >
            <Text style={styles.photoPlaceholderText} accessibilityElementsHidden>?</Text>
          </View>
        )}
        {selfieVerified && (
          <View style={styles.verifiedBadge} accessibilityLabel="Selfie verified" accessibilityRole="image">
            <Text style={styles.verifiedIcon} accessibilityElementsHidden>✓</Text>
          </View>
        )}
        {isChampion && (
          <View style={styles.championBadge} accessibilityLabel="Community champion" accessibilityRole="image">
            <Text style={styles.championIcon} accessibilityElementsHidden>🌟</Text>
          </View>
        )}
      </View>

      <Text style={styles.welcomeText} maxFontSizeMultiplier={MAX_FONT_SCALE}>{greeting},</Text>
      <Text
        style={styles.userName}
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        accessibilityRole="header"
        accessibilityLabel={`${greeting}, ${userName}`}
      >
        {userName}!
      </Text>

      {loginStreak > 1 && (
        <View style={styles.streakBadge} accessibilityRole="text" accessibilityLabel={streakA11y}>
          <Text style={styles.streakText} maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityElementsHidden>
            🔥 {loginStreak}-day streak!{loginStreak === longestStreak && loginStreak >= 7 ? ' (Personal best!)' : ''}
          </Text>
        </View>
      )}
      {loginStreak === 1 && (
        <View style={styles.streakBadgeOutline} accessibilityRole="text" accessibilityLabel={streakA11y}>
          <Text style={styles.streakTextOutline} maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityElementsHidden>
            🔥 Come back tomorrow to start a streak!
          </Text>
        </View>
      )}
      {isChampion && (
        <View style={styles.championLabel} accessibilityRole="text" accessibilityLabel="Community Champion">
          <Text style={styles.championLabelText} maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityElementsHidden>
            🌟 Community Champion
          </Text>
        </View>
      )}
      {personalityType !== '' && (
        <View style={styles.personalityBadge} accessibilityRole="text" accessibilityLabel={`Personality type: ${personalityType}`}>
          <Text style={styles.personalityBadgeText} maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityElementsHidden>
            {personalityType}
          </Text>
        </View>
      )}
      <Text style={styles.email} maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityLabel={`Email: ${maskedEmail}`}>
        {maskedEmail}
      </Text>
    </View>
  );

  if (!reducedMotion && Platform.OS !== 'web') {
    return <Animated.View entering={FadeInDown.duration(500)}>{content}</Animated.View>;
  }
  return content;
});

const styles = StyleSheet.create((theme) => ({
  container:            { alignItems: 'center', marginBottom: theme.spacing.sm },
  photoWrap:            { position: 'relative', marginBottom: theme.spacing.lg },
  photo: {
    width: AVATAR_SIZE, height: AVATAR_SIZE,
    borderRadius: 50, borderWidth: 3, borderColor: theme.colors.primary,
  },
  photoPlaceholder: {
    width: AVATAR_SIZE, height: AVATAR_SIZE,
    borderRadius: 50, justifyContent: 'center', alignItems: 'center',
    borderWidth: 3, backgroundColor: theme.colors.surface, borderColor: theme.colors.primary,
  },
  photoPlaceholderText: { fontSize: 40, color: theme.colors.textSecondary },
  verifiedBadge: {
    position: 'absolute', bottom: 0, right: 0,
    borderRadius: 15, width: 32, height: 32,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 3, backgroundColor: theme.colors.blue, borderColor: theme.colors.background,
  },
  verifiedIcon:  { fontSize: 14, fontWeight: 'bold', color: theme.colors.white },
  championBadge: {
    position: 'absolute', top: -5, right: -5,
    borderRadius: 15, width: 32, height: 32,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 3, backgroundColor: theme.colors.gold, borderColor: theme.colors.background,
  },
  championIcon:      { fontSize: 14 },
  welcomeText:       { fontSize: 16, color: theme.colors.textSecondary },
  userName:          { fontSize: 28, fontWeight: 'bold', marginTop: theme.spacing.xs, color: theme.colors.text },
  streakBadge: {
    paddingVertical: 6, paddingHorizontal: theme.spacing.lg,
    borderRadius: theme.radius.lg, marginTop: 10, backgroundColor: theme.colors.orange,
  },
  streakText:        { fontSize: 13, fontWeight: 'bold', color: theme.colors.white },
  streakBadgeOutline: {
    paddingVertical: 6, paddingHorizontal: theme.spacing.lg,
    borderRadius: theme.radius.lg, marginTop: 10,
    borderWidth: 1, backgroundColor: theme.colors.surface, borderColor: theme.colors.orange,
  },
  streakTextOutline: { fontSize: 13, fontWeight: 'bold', color: theme.colors.orange },
  championLabel: {
    paddingVertical: theme.spacing.xs, paddingHorizontal: theme.spacing.md,
    borderRadius: theme.radius.md, marginTop: theme.spacing.sm, backgroundColor: theme.colors.gold,
  },
  championLabelText:    { fontSize: 12, fontWeight: 'bold', color: theme.colors.background },
  personalityBadge: {
    paddingVertical: 6, paddingHorizontal: theme.spacing.lg,
    borderRadius: theme.radius.lg, marginTop: 10, backgroundColor: theme.colors.orange,
  },
  personalityBadgeText: { fontSize: 14, fontWeight: '600', color: theme.colors.white },
  email:                { fontSize: 14, marginBottom: theme.spacing.xl, color: theme.colors.primary },
}));