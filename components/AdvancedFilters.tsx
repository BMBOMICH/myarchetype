import React, { useState } from 'react';
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

export default function AdvancedFilters({
  visible,
  onClose,
  onApply,
  initialFilters,
  hasLocation,
}: AdvancedFiltersProps) {
  const [filters, setFilters] = useState<FilterOptions>(initialFilters);

  const toggleArrayItem = (array: string[], item: string): string[] => {
    if (array.includes(item)) return array.filter((i) => i !== item);
    return [...array, item];
  };

  const handleApply = () => { onApply(filters); onClose(); };
  const handleReset = () => { setFilters(DEFAULT_FILTERS); };

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
          <TouchableOpacity
            key={option}
            style={[styles.optionChip, selected.includes(option) && styles.optionChipActive]}
            onPress={() = accessibilityLabel="button"> onToggle(option)}
            accessibilityLabel={`${option} ${selected.includes(option) ? 'selected' : ''}`}
            accessibilityRole="button"
          >
            <Text style={[styles.optionChipText, selected.includes(option) && styles.optionChipTextActive]}>
              {option}
            </Text>
          </TouchableOpacity>
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
          <TouchableOpacity onPress={onClose} accessibilityLabel="Cancel" accessibilityRole="button">
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Filters</Text>
          <TouchableOpacity onPress={handleReset} accessibilityLabel="Reset filters" accessibilityRole="button">
            <Text style={styles.resetText}>Reset</Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.scrollContent} keyboardShouldPersistTaps="handled">
          {/* Age Range */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Age Range</Text>
            <View style={styles.rangeRow}>
              <TextInput
                style={styles.rangeInput}
                value={filters.minAge}
                onChangeText={(t) => setFilters({ ...filters, minAge: t.replace(/[^0-9]/g, '') })}
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
                onChangeText={(t) => setFilters({ ...filters, maxAge: t.replace(/[^0-9]/g, '') })}
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
                {['25', '50', '100', '250', '500', '9999'].map((dist) => (
                  <TouchableOpacity
                    key={dist}
                    style={[styles.distanceChip, filters.maxDistance === dist && styles.distanceChipActive]}
                    onPress={() = accessibilityLabel="button"> setFilters({ ...filters, maxDistance: dist })}
                    accessibilityLabel={`Distance: ${dist === '9999' ? 'Any' : `${dist}km`}`}
                    accessibilityRole="button"
                  >
                    <Text style={[styles.distanceChipText, filters.maxDistance === dist && styles.distanceChipTextActive]}>
                      {dist === '9999' ? 'Any' : `${dist}km`}
                    </Text>
                  </TouchableOpacity>
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
                onChangeText={(t) => setFilters({ ...filters, minHeight: t.replace(/[^0-9]/g, '') })}
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
                onChangeText={(t) => setFilters({ ...filters, maxHeight: t.replace(/[^0-9]/g, '') })}
                keyboardType="number-pad"
                maxLength={3}
                placeholder="Any"
                placeholderTextColor="#666"
                accessibilityLabel="Maximum height"
              />
            </View>
          </View>

          {renderMultiSelect('Body Type', BODY_TYPES, filters.bodyTypes, (item) =>
            setFilters({ ...filters, bodyTypes: toggleArrayItem(filters.bodyTypes, item) })
          )}
          {renderMultiSelect('Religious Views', RELIGIOUS_OPTIONS, filters.religiousViews, (item) =>
            setFilters({ ...filters, religiousViews: toggleArrayItem(filters.religiousViews, item) })
          )}
          {renderMultiSelect('Lifestyle', LIFESTYLE_OPTIONS, filters.lifestyles, (item) =>
            setFilters({ ...filters, lifestyles: toggleArrayItem(filters.lifestyles, item) })
          )}
          {renderMultiSelect('Relationship Goal', RELATIONSHIP_OPTIONS, filters.relationshipGoals, (item) =>
            setFilters({ ...filters, relationshipGoals: toggleArrayItem(filters.relationshipGoals, item) })
          )}
          {renderMultiSelect('Personality Type', PERSONALITY_OPTIONS, filters.personalityTypes, (item) =>
            setFilters({ ...filters, personalityTypes: toggleArrayItem(filters.personalityTypes, item) })
          )}

          {/* Toggles */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Other Filters</Text>
            <TouchableOpacity
              style={styles.toggleRow}
              onPress={() = accessibilityLabel="button"> setFilters({ ...filters, verifiedOnly: !filters.verifiedOnly })}
              accessibilityLabel={`Verified users only: ${filters.verifiedOnly ? 'on' : 'off'}`}
              accessibilityRole="switch"
            >
              <Text style={styles.toggleText}>Verified users only</Text>
              <View style={[styles.toggleBox, filters.verifiedOnly && styles.toggleBoxActive]}>
                {filters.verifiedOnly && <Text style={styles.toggleCheck}>✓</Text>}
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.toggleRow}
              onPress={() = accessibilityLabel="button"> setFilters({ ...filters, hasPhotos: !filters.hasPhotos })}
              accessibilityLabel={`Must have photos: ${filters.hasPhotos ? 'on' : 'off'}`}
              accessibilityRole="switch"
            >
              <Text style={styles.toggleText}>Must have photos</Text>
              <View style={[styles.toggleBox, filters.hasPhotos && styles.toggleBoxActive]}>
                {filters.hasPhotos && <Text style={styles.toggleCheck}>✓</Text>}
              </View>
            </TouchableOpacity>
          </View>

          <View style={styles.bottomPadding} />
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity style={styles.applyButton} onPress={handleApply} accessibilityLabel="Apply filters" accessibilityRole="button">
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