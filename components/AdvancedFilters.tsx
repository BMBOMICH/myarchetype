import React, { useState, useMemo, useCallback } from 'react';
import { Modal, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

interface FilterOptions {
  minAge: string;
  maxAge: string;
  maxDistance: string;
  bodyTypes: string[];
  religiousViews: string[];
  lifestyles: string[];
  relationshipGoals: string[];
  personalityTypes: string[];
  verifiedOnly: boolean;
  hasPhotos: boolean;
  minHeight: string;
  maxHeight: string;
}

interface AdvancedFiltersProps {
  visible: boolean;
  onClose: () => void;
  onApply: (filters: FilterOptions) => void;
  initialFilters: FilterOptions;
  hasLocation: boolean;
}

const BODY_TYPES           = ['Slim', 'Athletic', 'Average', 'Curvy', 'Plus-size'];
const RELIGIOUS_OPTIONS    = ['Traditional', 'Modern', 'Spiritual', 'None'];
const LIFESTYLE_OPTIONS    = ['Natural', 'Fitness', 'Social', 'Homebody'];
const RELATIONSHIP_OPTIONS = ['Marriage', 'Long-term', 'Exploring'];
const PERSONALITY_OPTIONS  = ['Social Butterfly', 'Balanced Explorer', 'Thoughtful Soul', 'Mixed'];

export const DEFAULT_FILTERS: FilterOptions = {
  minAge: '18',
  maxAge: '99',
  maxDistance: '9999',
  bodyTypes: [],
  religiousViews: [],
  lifestyles: [],
  relationshipGoals: [],
  personalityTypes: [],
  verifiedOnly: false,
  hasPhotos: true,
  minHeight: '',
  maxHeight: '',
};

const DISTANCE_OPTIONS = ['25', '50', '100', '250', '500', '9999'] as const;

// Extracted so each chip gets its own stable callback
interface OptionChipProps {
  option:   string;
  selected: boolean;
  onToggle: (item: string) => void;
}
const OptionChip = React.memo(function OptionChip({ option, selected, onToggle }: OptionChipProps) {
  const chipStyle = useMemo(
    () => [styles.optionChip, selected && styles.optionChipActive],
    [selected],
  );
  const txtStyle = useMemo(
    () => [styles.optionChipText, selected && styles.optionChipTextActive],
    [selected],
  );
  const handlePress = useCallback(() => onToggle(option), [onToggle, option]);
  return (
    <TouchableOpacity
      style={chipStyle}
      onPress={handlePress}
      accessibilityLabel={`${option} ${selected ? 'selected' : ''}`}
      accessibilityRole="button"
      accessibilityState={{ selected }}
    >
      <Text style={txtStyle}>{option}</Text>
    </TouchableOpacity>
  );
});

interface DistanceChipProps {
  dist:    string;
  active:  boolean;
  onPress: (dist: string) => void;
}
const DistanceChip = React.memo(function DistanceChip({ dist, active, onPress }: DistanceChipProps) {
  const chipStyle = useMemo(
    () => [styles.distanceChip, active && styles.distanceChipActive],
    [active],
  );
  const txtStyle = useMemo(
    () => [styles.distanceChipText, active && styles.distanceChipTextActive],
    [active],
  );
  const handlePress = useCallback(() => onPress(dist), [onPress, dist]);
  return (
    <TouchableOpacity
      style={chipStyle}
      onPress={handlePress}
      accessibilityLabel={`Distance: ${dist === '9999' ? 'Any' : `${dist}km`}`}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      <Text style={txtStyle}>{dist === '9999' ? 'Any' : `${dist}km`}</Text>
    </TouchableOpacity>
  );
});

export default function AdvancedFilters({
  visible,
  onClose,
  onApply,
  initialFilters,
  hasLocation,
}: AdvancedFiltersProps) {
  const [filters, setFilters] = useState<FilterOptions>(initialFilters);

  const toggleArrayItem = useCallback((array: string[], item: string): string[] => {
    if (array.includes(item)) return array.filter((i) => i !== item);
    return [...array, item];
  }, []);

  const handleApply = useCallback(() => { onApply(filters); onClose(); }, [onApply, filters, onClose]);
  const handleReset = useCallback(() => { setFilters(DEFAULT_FILTERS); },  []);

  const handleMinAge    = useCallback((t: string) => setFilters(f => ({ ...f, minAge:    t.replace(/[^0-9]/g, '') })), []);
  const handleMaxAge    = useCallback((t: string) => setFilters(f => ({ ...f, maxAge:    t.replace(/[^0-9]/g, '') })), []);
  const handleMinHeight = useCallback((t: string) => setFilters(f => ({ ...f, minHeight: t.replace(/[^0-9]/g, '') })), []);
  const handleMaxHeight = useCallback((t: string) => setFilters(f => ({ ...f, maxHeight: t.replace(/[^0-9]/g, '') })), []);

  const handleDistancePress = useCallback((dist: string) => {
    setFilters(f => ({ ...f, maxDistance: dist }));
  }, []);

  const handleToggleVerified = useCallback(() => {
    setFilters(f => ({ ...f, verifiedOnly: !f.verifiedOnly }));
  }, []);

  const handleTogglePhotos = useCallback(() => {
    setFilters(f => ({ ...f, hasPhotos: !f.hasPhotos }));
  }, []);

  const makeToggler = useCallback(
    (field: keyof FilterOptions) => (item: string) => {
      setFilters(f => ({
        ...f,
        [field]: toggleArrayItem(f[field] as string[], item),
      }));
    },
    [toggleArrayItem],
  );

  const toggleBodyType       = useMemo(() => makeToggler('bodyTypes'),         [makeToggler]);
  const toggleReligious      = useMemo(() => makeToggler('religiousViews'),     [makeToggler]);
  const toggleLifestyle      = useMemo(() => makeToggler('lifestyles'),         [makeToggler]);
  const toggleRelationship   = useMemo(() => makeToggler('relationshipGoals'),  [makeToggler]);
  const togglePersonality    = useMemo(() => makeToggler('personalityTypes'),   [makeToggler]);

  const verifiedBoxStyle = useMemo(
    () => [styles.toggleBox, filters.verifiedOnly && styles.toggleBoxActive],
    [filters.verifiedOnly],
  );
  const photosBoxStyle = useMemo(
    () => [styles.toggleBox, filters.hasPhotos && styles.toggleBoxActive],
    [filters.hasPhotos],
  );

  const renderMultiSelect = (
    title: string,
    options: string[],
    selected: string[],
    onToggle: (item: string) => void,
  ) => (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.optionsGrid}>
        {options.map((option) => (
          <OptionChip
            key={option}
            option={option}
            selected={selected.includes(option)}
            onToggle={onToggle}
          />
        ))}
      </View>
      {selected.length === 0 && (
        <Text style={styles.anyText}>Any (no filter)</Text>
      )}
    </View>
  );

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={onClose}
            accessibilityLabel="Cancel"
            accessibilityRole="button"
          >
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Filters</Text>
          <TouchableOpacity
            onPress={handleReset}
            accessibilityLabel="Reset filters"
            accessibilityRole="button"
          >
            <Text style={styles.resetText}>Reset</Text>
          </TouchableOpacity>
        </View>

        {/*
          ScrollView wraps a bounded filter form (~12 sections).
          This is a static config form, not a scrolling data feed.
          LegendList virtualization is not appropriate here.
        */}
        <ScrollView style={styles.scrollContent} keyboardShouldPersistTaps="handled">
          {/* Age Range */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Age Range</Text>
            <View style={styles.rangeRow}>
              <TextInput
                style={styles.rangeInput}
                value={filters.minAge}
                onChangeText={handleMinAge}
                keyboardType="number-pad"
                maxLength={2}
                placeholder="18"
                placeholderTextColor="#666"
                accessibilityLabel="Minimum age"
              />
              <Text style={styles.rangeDash}>to</Text>
              <TextInput
                style={styles.rangeInput}
                value={filters.maxAge}
                onChangeText={handleMaxAge}
                keyboardType="number-pad"
                maxLength={2}
                placeholder="99"
                placeholderTextColor="#666"
                accessibilityLabel="Maximum age"
              />
            </View>
          </View>

          {/* Distance */}
          {hasLocation && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Max Distance</Text>
              <View style={styles.distanceOptions}>
                {DISTANCE_OPTIONS.map((dist) => (
                  <DistanceChip
                    key={dist}
                    dist={dist}
                    active={filters.maxDistance === dist}
                    onPress={handleDistancePress}
                  />
                ))}
              </View>
            </View>
          )}

          {/* Height Range */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Height Range (cm)</Text>
            <View style={styles.rangeRow}>
              <TextInput
                style={styles.rangeInput}
                value={filters.minHeight}
                onChangeText={handleMinHeight}
                keyboardType="number-pad"
                maxLength={3}
                placeholder="Any"
                placeholderTextColor="#666"
                accessibilityLabel="Minimum height"
              />
              <Text style={styles.rangeDash}>to</Text>
              <TextInput
                style={styles.rangeInput}
                value={filters.maxHeight}
                onChangeText={handleMaxHeight}
                keyboardType="number-pad"
                maxLength={3}
                placeholder="Any"
                placeholderTextColor="#666"
                accessibilityLabel="Maximum height"
              />
            </View>
          </View>

          {renderMultiSelect('Body Type',          BODY_TYPES,           filters.bodyTypes,         toggleBodyType)}
          {renderMultiSelect('Religious Views',    RELIGIOUS_OPTIONS,    filters.religiousViews,    toggleReligious)}
          {renderMultiSelect('Lifestyle',          LIFESTYLE_OPTIONS,    filters.lifestyles,         toggleLifestyle)}
          {renderMultiSelect('Relationship Goal',  RELATIONSHIP_OPTIONS, filters.relationshipGoals, toggleRelationship)}
          {renderMultiSelect('Personality Type',   PERSONALITY_OPTIONS,  filters.personalityTypes,  togglePersonality)}

          {/* Toggles */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Other Filters</Text>
            <TouchableOpacity
              style={styles.toggleRow}
              onPress={handleToggleVerified}
              accessibilityLabel={`Verified users only: ${filters.verifiedOnly ? 'on' : 'off'}`}
              accessibilityRole="switch"
              accessibilityState={{ checked: filters.verifiedOnly }}
            >
              <Text style={styles.toggleText}>Verified users only</Text>
              <View style={verifiedBoxStyle}>
                {filters.verifiedOnly && <Text style={styles.toggleCheck}>✓</Text>}
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.toggleRow}
              onPress={handleTogglePhotos}
              accessibilityLabel={`Must have photos: ${filters.hasPhotos ? 'on' : 'off'}`}
              accessibilityRole="switch"
              accessibilityState={{ checked: filters.hasPhotos }}
            >
              <Text style={styles.toggleText}>Must have photos</Text>
              <View style={photosBoxStyle}>
                {filters.hasPhotos && <Text style={styles.toggleCheck}>✓</Text>}
              </View>
            </TouchableOpacity>
          </View>

          <View style={styles.bottomPadding} />
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity
            style={styles.applyButton}
            onPress={handleApply}
            accessibilityLabel="Apply filters"
            accessibilityRole="button"
          >
            <Text style={styles.applyButtonText}>Apply Filters</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create((theme) => ({
  container:              { flex: 1, backgroundColor: theme.colors.background },
  header:                 { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingTop: 50, borderBottomWidth: 1, borderBottomColor: '#0f3460' },
  cancelText:             { color: '#d9534f', fontSize: 16 },
  title:                  { color: theme.colors.text, fontSize: 18, fontWeight: 'bold' },
  resetText:              { color: '#53a8b6', fontSize: 16 },
  scrollContent:          { flex: 1, padding: 20 },
  section:                { marginBottom: 25 },
  sectionTitle:           { color: '#53a8b6', fontSize: 16, fontWeight: '600', marginBottom: 12 },
  rangeRow:               { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 15 },
  rangeInput:             { backgroundColor: '#16213e', color: theme.colors.text, paddingVertical: 12, paddingHorizontal: 20, borderRadius: 10, fontSize: 18, fontWeight: '600', width: 80, textAlign: 'center' },
  rangeDash:              { color: theme.colors.textSecondary, fontSize: 16 },
  distanceOptions:        { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  distanceChip:           { backgroundColor: '#16213e', paddingVertical: 10, paddingHorizontal: 16, borderRadius: 20 },
  distanceChipActive:     { backgroundColor: '#53a8b6' },
  distanceChipText:       { color: theme.colors.textSecondary, fontSize: 14 },
  distanceChipTextActive: { color: '#fff', fontWeight: '600' },
  optionsGrid:            { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  optionChip:             { backgroundColor: '#16213e', paddingVertical: 10, paddingHorizontal: 16, borderRadius: 20, borderWidth: 2, borderColor: '#16213e' },
  optionChipActive:       { backgroundColor: '#0f3460', borderColor: '#53a8b6' },
  optionChipText:         { color: theme.colors.textSecondary, fontSize: 14 },
  optionChipTextActive:   { color: '#53a8b6', fontWeight: '600' },
  anyText:                { color: '#666', fontSize: 12, marginTop: 8, fontStyle: 'italic' },
  toggleRow:              { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#16213e', padding: 15, borderRadius: 10, marginBottom: 10 },
  toggleText:             { color: theme.colors.text, fontSize: 15 },
  toggleBox:              { width: 26, height: 26, borderRadius: 6, borderWidth: 2, borderColor: '#53a8b6', justifyContent: 'center', alignItems: 'center' },
  toggleBoxActive:        { backgroundColor: '#53a8b6' },
  toggleCheck:            { color: '#fff', fontSize: 14, fontWeight: 'bold' },
  bottomPadding:          { height: 100 },
  footer:                 { padding: 20, borderTopWidth: 1, borderTopColor: '#0f3460' },
  applyButton:            { backgroundColor: '#5cb85c', paddingVertical: 16, borderRadius: 25, alignItems: 'center' },
  applyButtonText:        { color: '#fff', fontSize: 18, fontWeight: '600' },
}));