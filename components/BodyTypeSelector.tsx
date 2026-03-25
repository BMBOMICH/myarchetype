/**
 * BodyTypeSelector
 *
 * Visual body-type picker with anatomically proportioned silhouette
 * illustrations. Supports "describe yourself" and "looking for" modes.
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

// ─── Types ───────────────────────────────────────────────

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

// ─── Design tokens ───────────────────────────────────────

const C = {
  bg: '#1a1a2e',
  surface: '#16213e',
  surfaceActive: '#0f3460',
  border: '#0f3460',
  accent: '#53a8b6',
  success: '#5cb85c',
  danger: '#d9534f',
  warning: '#e67e22',
  textPrimary: '#eeeeee',
  textSecondary: '#aaaaaa',
  textMuted: '#888888',
  textDim: '#666666',
  white: '#ffffff',
  overlay: 'rgba(0, 0, 0, 0.85)',
  skin: '#53a8b6',         // silhouette fill
  skinHighlight: '#6ec5d4', // optional lighter accent
} as const;

const HIT = { top: 12, bottom: 12, left: 12, right: 12 } as const;

// ─── Body-type option data ───────────────────────────────

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

// ─── Anatomical silhouette system ────────────────────────

/**
 * Each torso "slice" can have per-corner border radius for
 * natural body curves (e.g. rounded shoulders, flared hips).
 */
interface TorsoSection {
  readonly w: number;
  readonly h: number;
  readonly rtl?: number; // borderTopLeftRadius
  readonly rtr?: number; // borderTopRightRadius
  readonly rbl?: number; // borderBottomLeftRadius
  readonly rbr?: number; // borderBottomRightRadius
}

/** Each leg is rendered as a tapered column of stacked slices. */
interface LegSection {
  readonly w: number;
  readonly h: number;
}

interface FigureConfig {
  /** Head diameter (rendered as a circle). */
  readonly head: number;
  /** [width, height] of the neck. */
  readonly neck: readonly [number, number];
  /**
   * Torso slices from shoulders → hips. More slices = smoother
   * width transitions = more realistic contours.
   */
  readonly torso: readonly TorsoSection[];
  /**
   * Leg slices from thigh → ankle (each leg is identical).
   * The last slice gets fully-rounded bottom corners (foot hint).
   */
  readonly legs: readonly LegSection[];
  /** Gap between the two leg columns. */
  readonly legGap: number;
}

/**
 * Four anatomically-proportioned figure configs.
 *
 * Design notes:
 * - Head ≈ 1/7.5 of total height (stylised).
 * - Width changes between adjacent torso slices are ≤ 6 px
 *   so curves feel organic, not stepped.
 * - Shoulder slices have large top-corner radii to mimic
 *   the deltoid slope from neck → outer shoulder.
 * - Hip slices use bottom-corner radii for a natural taper
 *   into the thigh gap.
 * - Leg columns taper smoothly: thigh → knee → calf → ankle.
 */
const FIGURES: Record<BodyType, FigureConfig> = {
  /* ── Slim ──────────────────────────────────────────── */
  Slim: {
    head: 20,
    neck: [7, 6],
    torso: [
      // Shoulders — gentle slope
      { w: 30, h: 5, rtl: 12, rtr: 12 },
      { w: 28, h: 4, rtl: 4, rtr: 4 },
      // Chest
      { w: 26, h: 10 },
      { w: 25, h: 10 },
      // Ribcage → waist (barely tapers)
      { w: 24, h: 8 },
      { w: 22, h: 8 },
      // Waist
      { w: 21, h: 6 },
      // Lower torso → hips
      { w: 22, h: 5 },
      { w: 24, h: 5, rbl: 5, rbr: 5 },
    ],
    legs: [
      { w: 8, h: 18 },  // upper thigh
      { w: 7, h: 6 },   // knee
      { w: 7, h: 16 },  // calf
      { w: 6, h: 5 },   // lower calf
      { w: 5, h: 4 },   // ankle
    ],
    legGap: 5,
  },

  /* ── Average ───────────────────────────────────────── */
  Average: {
    head: 22,
    neck: [9, 6],
    torso: [
      { w: 38, h: 6, rtl: 14, rtr: 14 },
      { w: 36, h: 4, rtl: 4, rtr: 4 },
      // Chest
      { w: 34, h: 10 },
      { w: 33, h: 10 },
      // Ribcage
      { w: 31, h: 8 },
      { w: 29, h: 7 },
      // Waist
      { w: 28, h: 6 },
      // Lower torso → hips
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

  /* ── Athletic ──────────────────────────────────────── */
  Athletic: {
    head: 22,
    neck: [11, 6],
    torso: [
      // Broad shoulders
      { w: 48, h: 7, rtl: 16, rtr: 16 },
      { w: 46, h: 4, rtl: 4, rtr: 4 },
      // Wide chest (pecs)
      { w: 44, h: 10 },
      { w: 42, h: 8 },
      // V-taper: chest → narrow waist
      { w: 38, h: 7 },
      { w: 34, h: 6 },
      // Narrow waist
      { w: 30, h: 6 },
      // Lower torso → hips
      { w: 32, h: 5 },
      { w: 34, h: 5, rbl: 5, rbr: 5 },
    ],
    legs: [
      { w: 14, h: 17 },  // muscular thighs
      { w: 12, h: 6 },
      { w: 12, h: 15 },  // muscular calves
      { w: 10, h: 5 },
      { w: 8, h: 4 },
    ],
    legGap: 5,
  },

  /* ── Curvy (hourglass) ─────────────────────────────── */
  Curvy: {
    head: 22,
    neck: [8, 5],
    torso: [
      // Shoulders
      { w: 34, h: 5, rtl: 12, rtr: 12 },
      { w: 36, h: 4, rtl: 4, rtr: 4 },
      // Bust (fuller)
      { w: 40, h: 10 },
      { w: 38, h: 6 },
      // Under-bust taper
      { w: 34, h: 5 },
      // Defined waist (narrowest point — hourglass)
      { w: 28, h: 6 },
      { w: 26, h: 5 },
      // Hips flare out dramatically
      { w: 32, h: 5 },
      { w: 38, h: 5 },
      { w: 44, h: 6, rbl: 8, rbr: 8 },
      { w: 42, h: 4, rbl: 6, rbr: 6 },
    ],
    legs: [
      { w: 16, h: 15 },  // fuller thighs
      { w: 13, h: 6 },
      { w: 11, h: 14 },
      { w: 9, h: 5 },
      { w: 7, h: 4 },
    ],
    legGap: 5,
  },
};

// ─── Silhouette component ────────────────────────────────

const BodyFigure = React.memo(function BodyFigure({
  type,
  color = C.skin,
}: {
  type: BodyType;
  color?: string;
}) {
  const cfg = FIGURES[type];
  const lastLeg = cfg.legs.length - 1;

  return (
    <View
      style={figS.container}
      accessibilityLabel={`${type} body type silhouette`}
    >
      {/* Head */}
      <View
        style={{
          width: cfg.head,
          height: cfg.head,
          borderRadius: cfg.head / 2,
          backgroundColor: color,
        }}
      />

      {/* Neck */}
      <View
        style={{
          width: cfg.neck[0],
          height: cfg.neck[1],
          backgroundColor: color,
          marginTop: -2,
        }}
      />

      {/* Torso sections */}
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

      {/* Legs */}
      <View style={[figS.legsRow, { gap: cfg.legGap }]}>
        {[0, 1].map((side) => (
          <View key={side} style={figS.legCol}>
            {cfg.legs.map((part, i) => (
              <View
                key={`l${i}`}
                style={{
                  width: part.w,
                  height: part.h,
                  backgroundColor: color,
                  // Smooth top corners for thigh attachment
                  borderTopLeftRadius: i === 0 ? 3 : 1,
                  borderTopRightRadius: i === 0 ? 3 : 1,
                  // Rounded bottom for ankle / foot hint
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

const figS = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'flex-start',
    height: 165,
    paddingTop: 5,
  },
  legsRow: {
    flexDirection: 'row',
    marginTop: -1,
  },
  legCol: {
    alignItems: 'center',
  },
});

// ─── Helpers ─────────────────────────────────────────────

function isBodyType(v: BodyTypeValue | ''): v is BodyType {
  return v !== '' && v !== 'Any';
}

// ─── Main component ─────────────────────────────────────

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
    [showLookingFor]
  );

  const selectedOption = useMemo(
    () => options.find((o) => o.value === selectedType),
    [options, selectedType]
  );

  const openModal = useCallback(() => setModalVisible(true), []);

  const closeModal = useCallback(() => {
    setModalVisible(false);
    setPreviewType(null);
  }, []);

  const handleSelect = useCallback(
    (value: BodyTypeValue) => {
      onSelect(value);
      closeModal();
    },
    [onSelect, closeModal]
  );

  return (
    <View style={s.container}>
      <Text style={s.label}>{label}</Text>
      <Text style={s.hint}>Tap to see visual guide</Text>

      {/* Current selection button */}
      <TouchableOpacity
        style={s.selectorBtn}
        onPress={openModal}
        disabled={disabled}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={`Select ${label}: ${selectedOption?.label ?? 'not selected'}`}
        accessibilityHint="Opens body type selection modal"
      >
        <View style={s.selectorRow}>
          {isBodyType(selectedType) && (
            <View style={s.miniSilhouette}>
              <BodyFigure type={selectedType} />
            </View>
          )}
          <View style={s.selectorText}>
            <Text style={s.selectedLabel}>
              {selectedOption?.label ?? 'Select body type'}
            </Text>
            {selectedOption?.description != null && (
              <Text style={s.selectedDesc} numberOfLines={1}>
                {selectedOption.description}
              </Text>
            )}
          </View>
          <Text style={s.arrow}>▼</Text>
        </View>
      </TouchableOpacity>

      {/* Selection modal */}
      <Modal
        visible={modalVisible}
        animationType="slide"
        transparent
        onRequestClose={closeModal}
      >
        <View style={s.overlay}>
          <View style={s.modal}>
            <Text style={s.modalTitle}>Select {label}</Text>
            <Text style={s.modalSub}>
              Choose the option that best describes{' '}
              {showLookingFor ? 'your preference' : 'your body'}
            </Text>

            <ScrollView
              contentContainerStyle={s.grid}
              showsVerticalScrollIndicator={false}
              bounces={false}
            >
              {options.map((opt) => {
                const isSelected = selectedType === opt.value;
                const isPreviewed = previewType === opt.value;

                return (
                  <TouchableOpacity
                    key={opt.value}
                    style={[
                      s.card,
                      isSelected && s.cardSelected,
                      isPreviewed && !isSelected && s.cardPreview,
                    ]}
                    onPress={() => handleSelect(opt.value)}
                    onPressIn={() => setPreviewType(opt.value)}
                    onPressOut={() => setPreviewType(null)}
                    disabled={disabled}
                    activeOpacity={0.8}
                    accessibilityRole="button"
                    accessibilityLabel={`${opt.label}: ${opt.description}`}
                    accessibilityState={{ selected: isSelected }}
                  >
                    {isBodyType(opt.value) ? (
                      <View style={s.figureWrap}>
                        <BodyFigure type={opt.value} />
                      </View>
                    ) : (
                      <View style={s.anyCircle}>
                        <Text style={s.anyText}>ALL</Text>
                      </View>
                    )}

                    <Text
                      style={[
                        s.optLabel,
                        isSelected && s.optLabelSelected,
                      ]}
                    >
                      {opt.label}
                    </Text>

                    <Text style={s.optDesc}>{opt.description}</Text>
                    <Text style={s.optExamples}>{opt.examples}</Text>

                    {isSelected && (
                      <View style={s.checkBadge}>
                        <Text style={s.checkText}>✓</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <TouchableOpacity
              style={s.cancelBtn}
              onPress={closeModal}
              hitSlop={HIT}
              accessibilityRole="button"
              accessibilityLabel="Cancel body type selection"
            >
              <Text style={s.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────

const s = StyleSheet.create({
  container: { marginBottom: 20 },
  label: { fontSize: 16, color: C.textPrimary, marginBottom: 5 },
  hint: { fontSize: 12, color: C.textMuted, marginBottom: 10, fontStyle: 'italic' },

  /* selector button */
  selectorBtn: {
    backgroundColor: C.surface,
    borderRadius: 15,
    padding: 15,
    borderWidth: 2,
    borderColor: C.border,
  },
  selectorRow: { flexDirection: 'row', alignItems: 'center' },
  miniSilhouette: {
    transform: [{ scale: 0.35 }],
    marginRight: -20,
    marginLeft: -15,
    height: 65,
    width: 45,
    overflow: 'hidden',
  },
  selectorText: { flex: 1, marginLeft: 10 },
  selectedLabel: { fontSize: 16, fontWeight: '600', color: C.textPrimary },
  selectedDesc: { fontSize: 12, color: C.textMuted, marginTop: 2 },
  arrow: { color: C.accent, fontSize: 14 },

  /* modal */
  overlay: {
    flex: 1,
    backgroundColor: C.overlay,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modal: {
    backgroundColor: C.bg,
    borderRadius: 20,
    padding: 20,
    width: '100%',
    maxHeight: '90%',
    borderWidth: 2,
    borderColor: C.border,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: C.textPrimary,
    textAlign: 'center',
    marginBottom: 5,
  },
  modalSub: {
    fontSize: 13,
    color: C.textMuted,
    textAlign: 'center',
    marginBottom: 20,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 10,
    paddingBottom: 4,
  },

  /* option cards */
  card: {
    width: '48%',
    backgroundColor: C.surface,
    borderRadius: 15,
    padding: 12,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: C.border,
    marginBottom: 10,
    position: 'relative',
  },
  cardSelected: {
    borderColor: C.accent,
    backgroundColor: C.surfaceActive,
  },
  cardPreview: { borderColor: C.warning },
  figureWrap: {
    transform: [{ scale: 0.55 }],
    height: 95,
    marginTop: -8,
    marginBottom: -18,
  },
  anyCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: C.accent,
    justifyContent: 'center',
    alignItems: 'center',
    marginVertical: 20,
  },
  anyText: { color: C.white, fontSize: 16, fontWeight: 'bold' },
  optLabel: {
    fontSize: 16,
    fontWeight: 'bold',
    color: C.textPrimary,
    marginTop: 5,
    marginBottom: 5,
  },
  optLabelSelected: { color: C.accent },
  optDesc: {
    fontSize: 11,
    color: C.textSecondary,
    textAlign: 'center',
    marginBottom: 4,
  },
  optExamples: {
    fontSize: 10,
    color: C.textDim,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  checkBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: C.success,
    borderRadius: 12,
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkText: { color: C.white, fontSize: 14, fontWeight: 'bold' },
  cancelBtn: { marginTop: 15, paddingVertical: 12, alignItems: 'center' },
  cancelText: { color: C.danger, fontSize: 16 },
});