import React, { useCallback, useMemo, useState } from 'react';
import {
  Modal,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

export type BodyType = 'Slim' | 'Average' | 'Athletic' | 'Curvy';
export type BodyTypeValue = BodyType | 'Any';

interface BodyTypeOption {
  readonly value: BodyTypeValue;
  readonly label: string;
  readonly description: string;
  readonly examples: string;
}

export interface BodyTypeSelectorProps {
  selectedType: BodyTypeValue | '';
  onSelect: (type: BodyTypeValue) => void;
  disabled?: boolean;
  label?: string;
  showLookingFor?: boolean;
}

const PALETTE = {
  surfaceActive: '#0f3460',
  success:       '#5cb85c',
  warning:       '#e67e22',
  white:         '#ffffff',
  overlay:       'rgba(0, 0, 0, 0.85)',
  skin:          '#53a8b6',
} as const;

const DEFAULT_HIT_SLOP = { top: 12, bottom: 12, left: 12, right: 12 } as const;

const BODY_TYPES: readonly BodyTypeOption[] = [
  {
    value: 'Slim',
    label: 'Slim',
    description: 'Thin frame, low body fat, narrow shoulders and hips',
    examples: "Runner's build, lean physique, model-like",
  },
  {
    value: 'Average',
    label: 'Average',
    description: 'Medium build, balanced proportions, moderate body fat',
    examples: 'Not muscular, not overweight, typical build',
  },
  {
    value: 'Athletic',
    label: 'Athletic',
    description: 'Muscular, toned, defined muscles, active build',
    examples: 'Gym-goer, sports player, visible muscle definition',
  },
  {
    value: 'Curvy',
    label: 'Curvy',
    description: 'Fuller figure, wider hips, feminine curves',
    examples: 'Hourglass shape, pear shape, full-figured',
  },
];

const ANY_OPTION: BodyTypeOption = {
  value: 'Any',
  label: 'Any',
  description: 'No preference',
  examples: 'Open to all body types',
};

interface TorsoSection {
  readonly w: number;
  readonly h: number;
  readonly rtl?: number;
  readonly rtr?: number;
  readonly rbl?: number;
  readonly rbr?: number;
}

interface LegSection {
  readonly w: number;
  readonly h: number;
}

interface FigureConfig {
  readonly head: number;
  readonly neck: readonly [number, number];
  readonly torso: readonly TorsoSection[];
  readonly legs: readonly LegSection[];
  readonly legGap: number;
}

const FIGURES: Record<BodyType, FigureConfig> = {
  Slim: {
    head: 20,
    neck: [7, 6],
    torso: [
      { w: 30, h: 5, rtl: 12, rtr: 12 },
      { w: 28, h: 4, rtl: 4, rtr: 4 },
      { w: 26, h: 10 },
      { w: 25, h: 10 },
      { w: 24, h: 8 },
      { w: 22, h: 8 },
      { w: 21, h: 6 },
      { w: 22, h: 5 },
      { w: 24, h: 5, rbl: 5, rbr: 5 },
    ],
    legs: [
      { w: 8, h: 18 },
      { w: 7, h: 6 },
      { w: 7, h: 16 },
      { w: 6, h: 5 },
      { w: 5, h: 4 },
    ],
    legGap: 5,
  },

  Average: {
    head: 22,
    neck: [9, 6],
    torso: [
      { w: 38, h: 6, rtl: 14, rtr: 14 },
      { w: 36, h: 4, rtl: 4, rtr: 4 },
      { w: 34, h: 10 },
      { w: 33, h: 10 },
      { w: 31, h: 8 },
      { w: 29, h: 7 },
      { w: 28, h: 6 },
      { w: 30, h: 5 },
      { w: 32, h: 5, rbl: 5, rbr: 5 },
    ],
    legs: [
      { w: 11, h: 17 },
      { w: 10, h: 6 },
      { w: 9, h: 15 },
      { w: 8, h: 5 },
      { w: 7, h: 4 },
    ],
    legGap: 5,
  },

  Athletic: {
    head: 22,
    neck: [11, 6],
    torso: [
      { w: 48, h: 7, rtl: 16, rtr: 16 },
      { w: 46, h: 4, rtl: 4, rtr: 4 },
      { w: 44, h: 10 },
      { w: 42, h: 8 },
      { w: 38, h: 7 },
      { w: 34, h: 6 },
      { w: 30, h: 6 },
      { w: 32, h: 5 },
      { w: 34, h: 5, rbl: 5, rbr: 5 },
    ],
    legs: [
      { w: 14, h: 17 },
      { w: 12, h: 6 },
      { w: 12, h: 15 },
      { w: 10, h: 5 },
      { w: 8, h: 4 },
    ],
    legGap: 5,
  },

  Curvy: {
    head: 22,
    neck: [8, 5],
    torso: [
      { w: 34, h: 5, rtl: 12, rtr: 12 },
      { w: 36, h: 4, rtl: 4, rtr: 4 },
      { w: 40, h: 10 },
      { w: 38, h: 6 },
      { w: 34, h: 5 },
      { w: 28, h: 6 },
      { w: 26, h: 5 },
      { w: 32, h: 5 },
      { w: 38, h: 5 },
      { w: 44, h: 6, rbl: 8, rbr: 8 },
      { w: 42, h: 4, rbl: 6, rbr: 6 },
    ],
    legs: [
      { w: 16, h: 15 },
      { w: 13, h: 6 },
      { w: 11, h: 14 },
      { w: 9, h: 5 },
      { w: 7, h: 4 },
    ],
    legGap: 5,
  },
};

const BodyFigure = React.memo(function BodyFigure({
  type,
  color = PALETTE.skin,
}: {
  type: BodyType;
  color?: string;
}) {
  const cfg = FIGURES[type];
  const lastLeg = cfg.legs.length - 1;

  const legsRowStyle = useMemo(
    () => ({ flexDirection: 'row' as const, gap: cfg.legGap }),
    [cfg.legGap],
  );

  return (
    <View
      accessible
      accessibilityLabel={`${type} body type silhouette`}
    >
      <View
        style={{
          width: cfg.head,
          height: cfg.head,
          borderRadius: cfg.head / 2,
          backgroundColor: color,
        }}
      />
      <View
        style={{
          width: cfg.neck[0],
          height: cfg.neck[1],
          backgroundColor: color,
          marginTop: -2,
        }}
      />
      {cfg.torso.map((sec, i) => (
        <View
          key={`t${i}`}
          style={{
            width: sec.w,
            height: sec.h,
            backgroundColor: color,
            borderTopLeftRadius: sec.rtl ?? 0,
            borderTopRightRadius: sec.rtr ?? 0,
            borderBottomLeftRadius: sec.rbl ?? 0,
            borderBottomRightRadius: sec.rbr ?? 0,
            marginTop: -1,
          }}
        />
      ))}
      <View style={legsRowStyle}>
        {[0, 1].map((side) => (
          <View key={side}>
            {cfg.legs.map((part, i) => (
              <View
                key={`l${i}`}
                style={{
                  width: part.w,
                  height: part.h,
                  backgroundColor: color,
                  borderTopLeftRadius: i === 0 ? 3 : 1,
                  borderTopRightRadius: i === 0 ? 3 : 1,
                  borderBottomLeftRadius: i === lastLeg ? part.w / 2 : 1,
                  borderBottomRightRadius: i === lastLeg ? part.w / 2 : 1,
                  marginTop: i === 0 ? 0 : -1,
                }}
              />
            ))}
          </View>
        ))}
      </View>
    </View>
  );
});

function isBodyType(v: BodyTypeValue | ''): v is BodyType {
  return v !== '' && v !== 'Any';
}

interface OptionCardProps {
  option: BodyTypeOption;
  isSelected: boolean;
  isPreviewed: boolean;
  disabled: boolean;
  onSelect: (value: BodyTypeValue) => void;
  onPressIn: (value: BodyTypeValue) => void;
  onPressOut: () => void;
}

const OptionCard = React.memo(function OptionCard({
  option,
  isSelected,
  isPreviewed,
  disabled,
  onSelect,
  onPressIn,
  onPressOut,
}: OptionCardProps) {
  const cardStyle = useMemo(
    () => [
      styles.card,
      isSelected && styles.cardSelected,
      isPreviewed && !isSelected && styles.cardPreview,
    ],
    [isSelected, isPreviewed],
  );
  const labelStyle = useMemo(
    () => [styles.optLabel, isSelected && styles.optLabelSelected],
    [isSelected],
  );
  const handlePress = useCallback(() => onSelect(option.value), [onSelect, option.value]);
  const handlePressIn = useCallback(() => onPressIn(option.value), [onPressIn, option.value]);
  const handlePressOut = useCallback(() => onPressOut(), [onPressOut]);

  return (
    <TouchableOpacity
      style={cardStyle}
      onPress={handlePress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={disabled}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={`${option.label}: ${option.description}`}
      accessibilityState={{ selected: isSelected }}
      testID={`body-type-option-${option.value}`}
    >
      {isBodyType(option.value) ? (
        <View style={styles.figureWrap} accessible={false}>
          <BodyFigure type={option.value} />
        </View>
      ) : (
        <View style={styles.anyCircle}>
          <Text style={styles.anyText}>ALL</Text>
        </View>
      )}
      <Text style={labelStyle}>{option.label}</Text>
      <Text style={styles.optDesc}>{option.description}</Text>
      <Text style={styles.optExamples}>{option.examples}</Text>
      {isSelected && (
        <View style={styles.checkBadge}>
          <Text style={styles.checkText}>✓</Text>
        </View>
      )}
    </TouchableOpacity>
  );
});

export default function BodyTypeSelector({
  selectedType,
  onSelect,
  disabled = false,
  label = 'Body Type',
  showLookingFor = false,
}: BodyTypeSelectorProps) {
  const [modalVisible, setModalVisible] = useState(false);
  const [previewType, setPreviewType] = useState<BodyTypeValue | null>(null);

  const options = useMemo<readonly BodyTypeOption[]>(
    () => (showLookingFor ? [...BODY_TYPES, ANY_OPTION] : BODY_TYPES),
    [showLookingFor],
  );

  const selectedOption = useMemo(
    () => options.find((o) => o.value === selectedType),
    [options, selectedType],
  );

  const openModal = useCallback(() => setModalVisible(true), []);
  const closeModal = useCallback(() => {
    setModalVisible(false);
    setPreviewType(null);
  }, []);

  const handleSelect = useCallback((value: BodyTypeValue) => { onSelect(value); closeModal(); }, [onSelect, closeModal]);
  const handlePressIn = useCallback((value: BodyTypeValue) => setPreviewType(value), []);
  const handlePressOut = useCallback(() => setPreviewType(null), []);

  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.hint}>Tap to see visual guide</Text>
      <TouchableOpacity
        style={styles.selectorBtn}
        onPress={openModal}
        disabled={disabled}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={`Select ${label}: ${selectedOption?.label ?? 'not selected'}`}
        accessibilityHint="Opens body type selection modal"
        testID="body-type-selector-button"
      >
        <View style={styles.selectorRow}>
          {isBodyType(selectedType) && (
            <View style={styles.miniSilhouette} accessible={false}>
              <BodyFigure type={selectedType} />
            </View>
          )}
          <View style={styles.selectorText}>
            <Text style={styles.selectedLabel}>
              {selectedOption?.label ?? 'Select body type'}
            </Text>
            {selectedOption?.description != null && (
              <Text style={styles.selectedDesc} numberOfLines={1}>
                {selectedOption.description}
              </Text>
            )}
          </View>
          <Text style={styles.arrow}>▼</Text>
        </View>
      </TouchableOpacity>
      <Modal
        visible={modalVisible}
        animationType="slide"
        transparent
        onRequestClose={closeModal}
      >
        <View style={styles.overlay}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Select {label}</Text>
            <Text style={styles.modalSub}>
              Choose the option that best describes{' '}
              {showLookingFor ? 'your preference' : 'your body'}
            </Text>
            <ScrollView
              contentContainerStyle={styles.grid}
              showsVerticalScrollIndicator={false}
              bounces={false}
            >
              {options.map((option) => (
                <OptionCard
                  key={option.value}
                  option={option}
                  isSelected={selectedType === option.value}
                  isPreviewed={previewType === option.value}
                  disabled={disabled}
                  onSelect={handleSelect}
                  onPressIn={handlePressIn}
                  onPressOut={handlePressOut}
                />
              ))}
            </ScrollView>
            <TouchableOpacity
              style={styles.cancelBtn}
              onPress={closeModal}
              hitSlop={DEFAULT_HIT_SLOP}
              accessibilityRole="button"
              accessibilityLabel="Cancel body type selection"
              testID="body-type-cancel-button"
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: { marginBottom: 20 },
  label: { fontSize: 16, color: theme.colors.text, marginBottom: 5 },
  hint: { fontSize: 12, color: theme.colors.textSecondary, marginBottom: 10, fontStyle: 'italic' },
  selectorBtn: { backgroundColor: theme.colors.surface, borderRadius: 15, padding: 15, borderWidth: 2, borderColor: theme.colors.border },
  selectorRow: { flexDirection: 'row', alignItems: 'center' },
  miniSilhouette: { transform: [{ scale: 0.35 }], marginRight: -20, marginLeft: -15, height: 65, width: 45, overflow: 'hidden' },
  selectorText: { flex: 1, marginLeft: 10 },
  selectedLabel: { fontSize: 16, fontWeight: '600', color: theme.colors.text },
  selectedDesc: { fontSize: 12, color: theme.colors.textSecondary, marginTop: 2 },
  arrow: { color: theme.colors.primary, fontSize: 14 },
  overlay: { flex: 1, backgroundColor: PALETTE.overlay, justifyContent: 'center', alignItems: 'center', padding: 20 },
  modal: { backgroundColor: theme.colors.background, borderRadius: 20, padding: 20, width: '100%', maxHeight: '90%', borderWidth: 2, borderColor: theme.colors.border },
  modalTitle: { fontSize: 22, fontWeight: 'bold', color: theme.colors.text, textAlign: 'center', marginBottom: 5 },
  modalSub: { fontSize: 13, color: theme.colors.textSecondary, textAlign: 'center', marginBottom: 20 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 10, paddingBottom: 4 },
  card: { width: '48%', backgroundColor: theme.colors.surface, borderRadius: 15, padding: 12, alignItems: 'center', borderWidth: 2, borderColor: theme.colors.border, marginBottom: 10, position: 'relative' },
  cardSelected: { borderColor: theme.colors.primary, backgroundColor: PALETTE.surfaceActive },
  cardPreview: { borderColor: PALETTE.warning },
  figureWrap: { transform: [{ scale: 0.55 }], height: 95, marginTop: -8, marginBottom: -18 },
  anyCircle: { width: 60, height: 60, borderRadius: 30, backgroundColor: theme.colors.primary, justifyContent: 'center', alignItems: 'center', marginVertical: 20 },
  anyText: { color: PALETTE.white, fontSize: 16, fontWeight: 'bold' },
  optLabel: { fontSize: 16, fontWeight: 'bold', color: theme.colors.text, marginTop: 5, marginBottom: 5 },
  optLabelSelected: { color: theme.colors.primary },
  optDesc: { fontSize: 11, color: theme.colors.textSecondary, textAlign: 'center', marginBottom: 4 },
  optExamples: { fontSize: 10, color: theme.colors.textSecondary, textAlign: 'center', fontStyle: 'italic' },
  checkBadge: { position: 'absolute', top: 8, right: 8, backgroundColor: PALETTE.success, borderRadius: 12, width: 24, height: 24, justifyContent: 'center', alignItems: 'center' },
  checkText: { color: PALETTE.white, fontSize: 14, fontWeight: 'bold' },
  cancelBtn: { marginTop: 15, paddingVertical: 12, alignItems: 'center' },
  cancelText: { color: theme.colors.error, fontSize: 16 },
}));