import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import {
import { logger } from '../utils/logger';
  formatSocialLinkDate,
  getSocialLinks,
  getSocialTrustBonus,
  linkInstagram,
  linkLinkedIn,
  openInstagramProfile,
  openLinkedInProfile,
  SocialLinks,
  unlinkSocial,
} from '../utils/socialVerification';

export default function SocialVerificationScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [socialLinks, setSocialLinks] = useState<SocialLinks>({});
  const [instagramInput, setInstagramInput] = useState('');
  const [linkedinInput, setLinkedinInput] = useState('');
  const [linking, setLinking] = useState<string | null>(null);

  useEffect(() => { void loadSocialLinks(); }, []);

  const loadSocialLinks = async () => {
    try {
      const links = await getSocialLinks();
      setSocialLinks(links);
    } catch (error) {
      logger.error('[SocialVerification] load error:', error);
      Alert.alert('Error', 'Failed to load social links.');
    } finally {
      setLoading(false);
    }
  };

  const handleLinkInstagram = async () => {
    if (!instagramInput.trim()) {
      Alert.alert('Error', 'Please enter your Instagram username');
      return;
    }
    setLinking('instagram');
    try {
      const result = await linkInstagram(instagramInput.trim());
      if (result.success) {
        Alert.alert('✅ Instagram Linked', 'Your Instagram has been linked successfully!');
        setInstagramInput('');
        await loadSocialLinks();
      } else {
        Alert.alert('Error', result.error || 'Failed to link Instagram');
      }
    } catch (error) {
      logger.error('[SocialVerification] instagram error:', error);
      Alert.alert('Error', 'Something went wrong while linking Instagram.');
    } finally {
      setLinking(null);
    }
  };

  const handleLinkLinkedIn = async () => {
    if (!linkedinInput.trim()) {
      Alert.alert('Error', 'Please enter your LinkedIn profile URL');
      return;
    }
    setLinking('linkedin');
    try {
      const result = await linkLinkedIn(linkedinInput.trim());
      if (result.success) {
        Alert.alert('✅ LinkedIn Linked', 'Your LinkedIn has been linked successfully!');
        setLinkedinInput('');
        await loadSocialLinks();
      } else {
        Alert.alert('Error', result.error || 'Failed to link LinkedIn');
      }
    } catch (error) {
      logger.error('[SocialVerification] linkedin error:', error);
      Alert.alert('Error', 'Something went wrong while linking LinkedIn.');
    } finally {
      setLinking(null);
    }
  };

  const doUnlink = async (platform: 'instagram' | 'linkedin' | 'spotify') => {
    const platformName = platform.charAt(0).toUpperCase() + platform.slice(1);
    try {
      const success = await unlinkSocial(platform);
      if (success) {
        Alert.alert('Success', `${platformName} has been unlinked`);
        await loadSocialLinks();
      } else {
        Alert.alert('Error', 'Failed to unlink');
      }
    } catch (error) {
      logger.error('[SocialVerification] unlink error:', error);
      Alert.alert('Error', `Failed to unlink ${platformName}.`);
    }
  };

  const handleUnlink = (platform: 'instagram' | 'linkedin' | 'spotify') => {
    const platformName = platform.charAt(0).toUpperCase() + platform.slice(1);
    Alert.alert(
      `Unlink ${platformName}?`,
      `This will remove your ${platformName} from your profile.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Unlink', style: 'destructive', onPress: () => void doUnlink(platform) },
      ]
    );
  };

  if (loading) return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color="#53a8b6" />
    </View>
  );

  const trustBonus = getSocialTrustBonus(socialLinks);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}><Text style={styles.backButton}>← Back</Text></TouchableOpacity>
        <Text style={styles.title}>🔗 Social Verification</Text>
        <View style={{ width: 60 }} />
      </View>

      <View style={styles.trustCard}>
        <Text style={styles.trustTitle}>Trust Score Bonus</Text>
        <Text style={styles.trustBonus}>+{trustBonus} points</Text>
        <Text style={styles.trustSubtext}>Link social media to boost your trust score</Text>
      </View>

      <View style={styles.infoCard}>
        <Text style={styles.infoTitle}>Why link social media?</Text>
        <Text style={styles.infoText}>• Shows you're a real person{'\n'}• Builds trust with matches{'\n'}• +5-10 trust score bonus per platform{'\n'}• Matches can see your real social life</Text>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionIcon}>📸</Text>
          <Text style={styles.sectionTitle}>Instagram</Text>
          {socialLinks.instagram && <View style={styles.linkedBadge}><Text style={styles.linkedBadgeText}>Linked</Text></View>}
        </View>

        {socialLinks.instagram ? (
          <View style={styles.linkedCard}>
            <TouchableOpacity style={styles.linkedInfo} onPress={() => openInstagramProfile(socialLinks.instagram!.username)}>
              <Text style={styles.linkedUsername}>@{socialLinks.instagram.username}</Text>
              <Text style={styles.linkedDate}>Linked {formatSocialLinkDate(socialLinks.instagram.linkedAt)}</Text>
              <Text style={styles.tapToView}>Tap to view profile →</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.unlinkButton} onPress={() => handleUnlink('instagram')}>
              <Text style={styles.unlinkButtonText}>Unlink</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.linkForm}>
            <TextInput
              style={styles.input}
              placeholder="@username"
              placeholderTextColor="#666"
              value={instagramInput}
              onChangeText={setInstagramInput}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TouchableOpacity style={[styles.linkButton, linking === 'instagram' && styles.linkButtonDisabled]} onPress={() => void handleLinkInstagram()} disabled={linking === 'instagram'}>
              {linking === 'instagram' ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.linkButtonText}>Link</Text>}
            </TouchableOpacity>
          </View>
        )}
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionIcon}>💼</Text>
          <Text style={styles.sectionTitle}>LinkedIn</Text>
          {socialLinks.linkedin && <View style={styles.linkedBadge}><Text style={styles.linkedBadgeText}>Linked</Text></View>}
        </View>

        {socialLinks.linkedin ? (
          <View style={styles.linkedCard}>
            <TouchableOpacity style={styles.linkedInfo} onPress={() => openLinkedInProfile(socialLinks.linkedin!.profileUrl)}>
              <Text style={styles.linkedUsername}>Profile Linked</Text>
              <Text style={styles.linkedDate}>Linked {formatSocialLinkDate(socialLinks.linkedin.linkedAt)}</Text>
              <Text style={styles.tapToView}>Tap to view profile →</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.unlinkButton} onPress={() => handleUnlink('linkedin')}>
              <Text style={styles.unlinkButtonText}>Unlink</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.linkForm}>
            <TextInput
              style={styles.input}
              placeholder="https://linkedin.com/in/yourname"
              placeholderTextColor="#666"
              value={linkedinInput}
              onChangeText={setLinkedinInput}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
            <TouchableOpacity style={[styles.linkButton, linking === 'linkedin' && styles.linkButtonDisabled]} onPress={() => void handleLinkLinkedIn()} disabled={linking === 'linkedin'}>
              {linking === 'linkedin' ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.linkButtonText}>Link</Text>}
            </TouchableOpacity>
          </View>
        )}
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionIcon}>🎵</Text>
          <Text style={styles.sectionTitle}>Spotify</Text>
          <View style={styles.comingSoonBadge}><Text style={styles.comingSoonBadgeText}>Coming Soon</Text></View>
        </View>
        <View style={styles.comingSoonCard}>
          <Text style={styles.comingSoonText}>Connect Spotify to show your music taste and find matches with similar music preferences!</Text>
        </View>
      </View>

      <View style={styles.privacyNote}>
        <Text style={styles.privacyIcon}>🔒</Text>
        <Text style={styles.privacyText}>Your social links are only visible to your matches. We never post on your behalf.</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  content: { padding: 20, paddingBottom: 40 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 30, marginBottom: 20 },
  backButton: { color: '#53a8b6', fontSize: 16 },
  title: { fontSize: 20, fontWeight: 'bold', color: '#eee' },
  trustCard: { backgroundColor: '#16213e', borderRadius: 15, padding: 20, alignItems: 'center', marginBottom: 20, borderWidth: 2, borderColor: '#5cb85c' },
  trustTitle: { fontSize: 14, color: '#888', marginBottom: 5 },
  trustBonus: { fontSize: 36, fontWeight: 'bold', color: '#5cb85c', marginBottom: 5 },
  trustSubtext: { fontSize: 13, color: '#888' },
  infoCard: { backgroundColor: 'rgba(83, 168, 182, 0.1)', borderRadius: 15, padding: 15, marginBottom: 25, borderWidth: 1, borderColor: 'rgba(83, 168, 182, 0.3)' },
  infoTitle: { fontSize: 14, fontWeight: '600', color: '#53a8b6', marginBottom: 8 },
  infoText: { fontSize: 13, color: '#aaa', lineHeight: 22 },
  section: { marginBottom: 25 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 12, gap: 10 },
  sectionIcon: { fontSize: 24 },
  sectionTitle: { fontSize: 18, fontWeight: 'bold', color: '#eee', flex: 1 },
  linkedBadge: { backgroundColor: '#5cb85c', paddingVertical: 4, paddingHorizontal: 10, borderRadius: 10 },
  linkedBadgeText: { color: '#fff', fontSize: 11, fontWeight: 'bold' },
  comingSoonBadge: { backgroundColor: '#e67e22', paddingVertical: 4, paddingHorizontal: 10, borderRadius: 10 },
  comingSoonBadgeText: { color: '#fff', fontSize: 11, fontWeight: 'bold' },
  linkedCard: { backgroundColor: '#16213e', borderRadius: 12, padding: 15, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderWidth: 1, borderColor: '#5cb85c' },
  linkedInfo: { flex: 1 },
  linkedUsername: { fontSize: 16, fontWeight: 'bold', color: '#eee', marginBottom: 4 },
  linkedDate: { fontSize: 12, color: '#888', marginBottom: 4 },
  tapToView: { fontSize: 12, color: '#53a8b6' },
  unlinkButton: { backgroundColor: '#d9534f', paddingVertical: 8, paddingHorizontal: 15, borderRadius: 15 },
  unlinkButtonText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  linkForm: { flexDirection: 'row', gap: 10 },
  input: { flex: 1, backgroundColor: '#16213e', color: '#fff', padding: 15, borderRadius: 12, fontSize: 15, borderWidth: 1, borderColor: '#0f3460' },
  linkButton: { backgroundColor: '#53a8b6', paddingHorizontal: 25, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  linkButtonDisabled: { backgroundColor: '#555' },
  linkButtonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  comingSoonCard: { backgroundColor: '#16213e', borderRadius: 12, padding: 20, borderWidth: 1, borderColor: '#0f3460' },
  comingSoonText: { color: '#888', fontSize: 14, lineHeight: 22, textAlign: 'center' },
  privacyNote: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#16213e', borderRadius: 12, padding: 15, gap: 12 },
  privacyIcon: { fontSize: 20 },
  privacyText: { flex: 1, color: '#888', fontSize: 13, lineHeight: 18 },
});