import type { LegendListRenderItemProps } from '@legendapp/list';
import { LegendList } from '@legendapp/list';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, InteractionManager, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { DealBreakers, DEFAULT_DEAL_BREAKERS, getDealBreakers, saveDealBreakers } from '../utils/dealBreakers';
import { logger } from '../utils/logger';

const RELIGIONS = ['Traditional', 'Modern', 'Spiritual', 'None'] as const;

interface ToggleRowProps { label: string; value: boolean; onChange: (v: boolean) => void; last?: boolean; }
const ToggleRow = React.memo(function ToggleRow({ label, value, onChange, last }: ToggleRowProps) {
  return (
    <View style={[styles.toggleRow, last && styles.toggleRowLast]}>
      <Text style={styles.toggleLabel}>{label}</Text>
      <Switch value={value} onValueChange={onChange} trackColor={{ false: '#555', true: '#53a8b6' }} thumbColor="#fff" accessibilityLabel={label} accessibilityRole="switch" accessibilityState={{ checked: value }} />
    </View>
  );
});

interface ReligionButtonProps { religion: string; active: boolean; onPress: (r: string) => void; }
const ReligionButton = React.memo(function ReligionButton({ religion, active, onPress }: ReligionButtonProps) {
  const handlePress = useCallback(() => onPress(religion), [onPress, religion]);
  return (
    <TouchableOpacity style={[styles.religionButton, active && styles.religionButtonActive]} onPress={handlePress}
      accessibilityLabel={`Religion: ${religion}${active ? ', selected' : ''}`}
      accessibilityRole="radio" accessibilityState={{ selected: active }}>
      <Text style={[styles.religionButtonText, active && styles.religionButtonTextActive]}>{religion}</Text>
    </TouchableOpacity>
  );
});

interface ProfileQualitySectionProps { mustHaveVerified: boolean; mustHaveBio: boolean; mustHaveMultiplePhotos: boolean; onChange: (key: keyof DealBreakers, value: unknown) => void; }
const ProfileQualitySection = React.memo(function ProfileQualitySection({ mustHaveVerified, mustHaveBio, mustHaveMultiplePhotos, onChange }: ProfileQualitySectionProps) {
  const onVerified = useCallback((v: boolean) => onChange('mustHaveVerified', v), [onChange]);
  const onBio      = useCallback((v: boolean) => onChange('mustHaveBio', v), [onChange]);
  const onPhotos   = useCallback((v: boolean) => onChange('mustHaveMultiplePhotos', v), [onChange]);
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>📸 Profile Quality</Text>
      <ToggleRow label="Must be verified"    value={mustHaveVerified}       onChange={onVerified} />
      <ToggleRow label="Must have bio"       value={mustHaveBio}            onChange={onBio} />
      <ToggleRow label="Must have 3+ photos" value={mustHaveMultiplePhotos} onChange={onPhotos} last />
    </View>
  );
});

interface AgeRangeSectionProps { minAge: number | null; maxAge: number | null; onChange: (key: keyof DealBreakers, value: unknown) => void; }
const AgeRangeSection = React.memo(function AgeRangeSection({ minAge, maxAge, onChange }: AgeRangeSectionProps) {
  const onMin = useCallback((t: string) => onChange('minAge', t ? parseInt(t) : null), [onChange]);
  const onMax = useCallback((t: string) => onChange('maxAge', t ? parseInt(t) : null), [onChange]);
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>🎂 Age Range</Text>
      <View style={styles.rangeRow}>
        <TextInput style={styles.rangeInput} placeholder="Min" placeholderTextColor="#666" value={minAge?.toString() ?? ''} onChangeText={onMin} keyboardType="number-pad" maxLength={2} accessibilityLabel="Minimum age" />
        <Text style={styles.rangeDash}>to</Text>
        <TextInput style={styles.rangeInput} placeholder="Max" placeholderTextColor="#666" value={maxAge?.toString() ?? ''} onChangeText={onMax} keyboardType="number-pad" maxLength={2} accessibilityLabel="Maximum age" />
      </View>
    </View>
  );
});

interface HeightRangeSectionProps { minHeight: number | null; maxHeight: number | null; onChange: (key: keyof DealBreakers, value: unknown) => void; }
const HeightRangeSection = React.memo(function HeightRangeSection({ minHeight, maxHeight, onChange }: HeightRangeSectionProps) {
  const onMin = useCallback((t: string) => onChange('minHeight', t ? parseInt(t) : null), [onChange]);
  const onMax = useCallback((t: string) => onChange('maxHeight', t ? parseInt(t) : null), [onChange]);
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>📏 Height Range (cm)</Text>
      <View style={styles.rangeRow}>
        <TextInput style={styles.rangeInput} placeholder="Min" placeholderTextColor="#666" value={minHeight?.toString() ?? ''} onChangeText={onMin} keyboardType="number-pad" maxLength={3} accessibilityLabel="Minimum height in centimeters" />
        <Text style={styles.rangeDash}>to</Text>
        <TextInput style={styles.rangeInput} placeholder="Max" placeholderTextColor="#666" value={maxHeight?.toString() ?? ''} onChangeText={onMax} keyboardType="number-pad" maxLength={3} accessibilityLabel="Maximum height in centimeters" />
      </View>
    </View>
  );
});

interface LifestyleSectionProps { noSmoking: boolean; noDrinking: boolean; noDrugs: boolean; onChange: (key: keyof DealBreakers, value: unknown) => void; }
const LifestyleSection = React.memo(function LifestyleSection({ noSmoking, noDrinking, noDrugs, onChange }: LifestyleSectionProps) {
  const onSmoke = useCallback((v: boolean) => onChange('noSmoking', v), [onChange]);
  const onDrink = useCallback((v: boolean) => onChange('noDrinking', v), [onChange]);
  const onDrugs = useCallback((v: boolean) => onChange('noDrugs', v), [onChange]);
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>🚬 Lifestyle</Text>
      <ToggleRow label="No smoking" value={noSmoking}  onChange={onSmoke} />
      <ToggleRow label="No alcohol" value={noDrinking} onChange={onDrink} />
      <ToggleRow label="No drugs"   value={noDrugs}    onChange={onDrugs} last />
    </View>
  );
});

interface KidsSectionProps { mustWantKids: boolean; mustNotWantKids: boolean; mustHaveKids: boolean; mustNotHaveKids: boolean; onChange: (key: keyof DealBreakers, value: unknown) => void; }
const KidsSection = React.memo(function KidsSection({ mustWantKids, mustNotWantKids, mustHaveKids, mustNotHaveKids, onChange }: KidsSectionProps) {
  const onWantKids    = useCallback((v: boolean) => { onChange('mustWantKids', v); if (v) onChange('mustNotWantKids', false); }, [onChange]);
  const onNotWantKids = useCallback((v: boolean) => { onChange('mustNotWantKids', v); if (v) onChange('mustWantKids', false); }, [onChange]);
  const onHaveKids    = useCallback((v: boolean) => { onChange('mustHaveKids', v); if (v) onChange('mustNotHaveKids', false); }, [onChange]);
  const onNotHaveKids = useCallback((v: boolean) => { onChange('mustNotHaveKids', v); if (v) onChange('mustHaveKids', false); }, [onChange]);
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>👶 Kids</Text>
      <ToggleRow label="Must want kids"         value={mustWantKids}    onChange={onWantKids} />
      <ToggleRow label="Must NOT want kids"     value={mustNotWantKids} onChange={onNotWantKids} />
      <ToggleRow label="Must already have kids" value={mustHaveKids}    onChange={onHaveKids} />
      <ToggleRow label="Must NOT have kids"     value={mustNotHaveKids} onChange={onNotHaveKids} last />
    </View>
  );
});

interface ReligionSectionProps { sameReligionOnly: boolean; requiredReligion: string | null; onChange: (key: keyof DealBreakers, value: unknown) => void; }
const ReligionSection = React.memo(function ReligionSection({ sameReligionOnly, requiredReligion, onChange }: ReligionSectionProps) {
  const onSameOnly = useCallback((v: boolean) => { onChange('sameReligionOnly', v); if (v) onChange('requiredReligion', null); }, [onChange]);
  const onReligion = useCallback((r: string) => {
    onChange('requiredReligion', requiredReligion === r ? null : r);
    onChange('sameReligionOnly', false);
  }, [onChange, requiredReligion]);
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>🙏 Religion</Text>
      <ToggleRow label="Same religion only" value={sameReligionOnly} onChange={onSameOnly} last />
      <Text style={styles.orText}>OR specific religion:</Text>
      <View style={styles.religionButtons}>
        {RELIGIONS.map(r => (
          <ReligionButton key={r} religion={r} active={requiredReligion === r} onPress={onReligion} />
        ))}
      </View>
    </View>
  );
});

interface DistanceSectionProps { maxDistanceKm: number | null; onChange: (key: keyof DealBreakers, value: unknown) => void; }
const DistanceSection = React.memo(function DistanceSection({ maxDistanceKm, onChange }: DistanceSectionProps) {
  const onDistance = useCallback((t: string) => onChange('maxDistanceKm', t ? parseInt(t) : null), [onChange]);
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>📍 Maximum Distance</Text>
      <View style={styles.distanceRow}>
        <TextInput style={styles.distanceInput} placeholder="No limit" placeholderTextColor="#666" value={maxDistanceKm?.toString() ?? ''} onChangeText={onDistance} keyboardType="number-pad" maxLength={4} accessibilityLabel="Maximum distance in kilometers" />
        <Text style={styles.distanceUnit}>km</Text>
      </View>
    </View>
  );
});

type SectionKey = 'quality' | 'age' | 'height' | 'lifestyle' | 'kids' | 'religion' | 'distance';
interface SectionItem { key: SectionKey; }
const SECTION_DATA: SectionItem[] = [
  { key: 'quality' }, { key: 'age' }, { key: 'height' },
  { key: 'lifestyle' }, { key: 'kids' }, { key: 'religion' }, { key: 'distance' },
];

export default function DealBreakersScreen() {
  const router = useRouter();
  const [loading,      setLoading]      = useState(true);
  const [saving,       setSaving]       = useState(false);
  const [dealBreakers, setDealBreakers] = useState<DealBreakers>(DEFAULT_DEAL_BREAKERS);
  const isMounted                       = useRef(true);

  const updateBreaker = useCallback(<K extends keyof DealBreakers>(key: K, value: DealBreakers[K]) => {
    setDealBreakers(prev => ({ ...prev, [key]: value }));
  }, []);

  const loadDealBreakers = useCallback(async () => {
    try {
      const data = await getDealBreakers();
      if (!isMounted.current) return;
      setDealBreakers(data);
    } catch (error) {
      logger.error('[DealBreakers] Load error:', error);
      if (!isMounted.current) return;
      Alert.alert('Error', 'Failed to load deal breakers.');
    } finally {
      if (isMounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    isMounted.current = true;
    const task = InteractionManager.runAfterInteractions(() => {
      void loadDealBreakers();
    }, []);
    return () => {
      isMounted.current = false;
      task.cancel();
    };
  }, [loadDealBreakers]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const result = await saveDealBreakers(dealBreakers);
      if (result.success) { Alert.alert('Saved!', 'Your deal breakers have been updated.'); router.back(); }
      else Alert.alert('Error', 'Failed to save deal breakers.');
    } catch (error) {
      logger.error('[DealBreakers] Save error:', error);
      Alert.alert('Error', 'An unexpected error occurred.');
    } finally { setSaving(false); }
  }, [dealBreakers, router]);

  const handleReset     = useCallback(() => setDealBreakers(DEFAULT_DEAL_BREAKERS), []);
  const handleBack      = useCallback(() => router.back(), [router]);
  const handleSavePress = useCallback(() => void handleSave(), [handleSave]);

  const renderSection = useCallback(({ item }: LegendListRenderItemProps<SectionItem>) => {
    switch (item.key) {
      case 'quality':   return <ProfileQualitySection mustHaveVerified={dealBreakers.mustHaveVerified} mustHaveBio={dealBreakers.mustHaveBio} mustHaveMultiplePhotos={dealBreakers.mustHaveMultiplePhotos} onChange={updateBreaker} />;
      case 'age':       return <AgeRangeSection minAge={dealBreakers.minAge ?? null} maxAge={dealBreakers.maxAge ?? null} onChange={updateBreaker} />;
      case 'height':    return <HeightRangeSection minHeight={dealBreakers.minHeight ?? null} maxHeight={dealBreakers.maxHeight ?? null} onChange={updateBreaker} />;
      case 'lifestyle': return <LifestyleSection noSmoking={dealBreakers.noSmoking} noDrinking={dealBreakers.noDrinking} noDrugs={dealBreakers.noDrugs} onChange={updateBreaker} />;
      case 'kids':      return <KidsSection mustWantKids={dealBreakers.mustWantKids} mustNotWantKids={dealBreakers.mustNotWantKids} mustHaveKids={dealBreakers.mustHaveKids} mustNotHaveKids={dealBreakers.mustNotHaveKids} onChange={updateBreaker} />;
      case 'religion':  return <ReligionSection sameReligionOnly={dealBreakers.sameReligionOnly} requiredReligion={dealBreakers.requiredReligion ?? null} onChange={updateBreaker} />;
      case 'distance':  return <DistanceSection maxDistanceKm={dealBreakers.maxDistanceKm ?? null} onChange={updateBreaker} />;
    }
  }, [dealBreakers, updateBreaker]);

  const keyExtractor = useCallback((item: SectionItem) => item.key, []);

  const ListHeader = useMemo(() => (
    <View>
      <View style={styles.header}>
        <TouchableOpacity onPress={handleBack} accessibilityLabel="Go back" accessibilityRole="button">
          <Text style={styles.backButton}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Deal Breakers</Text>
        <View style={styles.headerSpacer} />
      </View>
      <Text style={styles.subtitle}>Set hard limits. Profiles that don't match these won't be shown.</Text>
    </View>
  ), [handleBack]);

  const ListFooter = useMemo(() => (
    <View>
      <TouchableOpacity style={[styles.saveButton, saving && styles.saveButtonDisabled]} onPress={handleSavePress} disabled={saving} accessibilityLabel={saving ? 'Saving deal breakers' : 'Save deal breakers'} accessibilityRole="button" accessibilityState={{ disabled: saving, busy: saving }}>
        <Text style={styles.saveButtonText}>{saving ? 'Saving...' : '✓ Save Deal Breakers'}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.resetButton} onPress={handleReset} accessibilityLabel="Reset to default deal breakers" accessibilityRole="button">
        <Text style={styles.resetButtonText}>Reset to Default</Text>
      </TouchableOpacity>
      <View style={styles.bottomSpacer} />
    </View>
  ), [saving, handleSavePress, handleReset]);

  if (loading) return <View style={styles.loadingContainer}><ActivityIndicator size="large" color="#53a8b6" /></View>;

  return (
    <LegendList
      style={styles.container}
      contentContainerStyle={styles.content}
      data={SECTION_DATA}
      renderItem={renderSection}
      keyExtractor={keyExtractor}
      ListHeaderComponent={ListHeader}
      ListFooterComponent={ListFooter}
      estimatedItemSize={200}
      recycleItems={false}
      keyboardShouldPersistTaps="handled"
      accessibilityLabel="Deal breakers settings"
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  container:               { flex: 1, backgroundColor: theme.colors.background },
  content:                 { padding: 20 },
  loadingContainer:        { flex: 1, backgroundColor: theme.colors.background, justifyContent: 'center', alignItems: 'center' },
  header:                  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, marginTop: 30 },
  headerSpacer:            { width: 50 },
  backButton:              { color: '#53a8b6', fontSize: 16 },
  title:                   { fontSize: 24, fontWeight: 'bold', color: theme.colors.text },
  subtitle:                { color: theme.colors.textSecondary, fontSize: 14, textAlign: 'center', marginBottom: 25, lineHeight: 20 },
  section:                 { backgroundColor: '#16213e', borderRadius: 15, padding: 16, marginBottom: 20 },
  sectionTitle:            { color: '#53a8b6', fontSize: 16, fontWeight: '600', marginBottom: 15 },
  toggleRow:               { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#0f3460' },
  toggleRowLast:           { borderBottomWidth: 0 },
  toggleLabel:             { color: theme.colors.text, fontSize: 15 },
  rangeRow:                { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 15 },
  rangeInput:              { backgroundColor: '#0f3460', color: theme.colors.text, paddingVertical: 12, paddingHorizontal: 20, borderRadius: 10, fontSize: 18, fontWeight: '600', width: 100, textAlign: 'center' },
  rangeDash:               { color: theme.colors.textSecondary, fontSize: 16 },
  orText:                  { color: theme.colors.textSecondary, fontSize: 13, marginTop: 15, marginBottom: 10 },
  religionButtons:         { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  religionButton:          { backgroundColor: '#0f3460', paddingVertical: 10, paddingHorizontal: 16, borderRadius: 20, borderWidth: 2, borderColor: '#0f3460' },
  religionButtonActive:    { backgroundColor: '#53a8b6', borderColor: '#53a8b6' },
  religionButtonText:      { color: theme.colors.textSecondary, fontSize: 14 },
  religionButtonTextActive:{ color: '#fff', fontWeight: '600' },
  distanceRow:             { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  distanceInput:           { backgroundColor: '#0f3460', color: theme.colors.text, paddingVertical: 12, paddingHorizontal: 20, borderRadius: 10, fontSize: 18, fontWeight: '600', width: 120, textAlign: 'center' },
  distanceUnit:            { color: theme.colors.textSecondary, fontSize: 16 },
  saveButton:              { backgroundColor: '#5cb85c', paddingVertical: 16, borderRadius: 25, alignItems: 'center', marginTop: 10 },
  saveButtonDisabled:      { backgroundColor: '#555' },
  saveButtonText:          { color: '#fff', fontSize: 18, fontWeight: '600' },
  resetButton:             { paddingVertical: 14, alignItems: 'center', marginTop: 10 },
  resetButtonText:         { color: '#d9534f', fontSize: 16 },
  bottomSpacer:            { height: 50 },
}));