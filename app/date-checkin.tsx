import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import {
  cancelCheckin,
  formatCheckinStatus,
  getActiveCheckin,
  getCheckinProgressPercent,
  getTimeUntilNextCheckin,
  isCheckinOverdue,
  performCheckin,
  startDateCheckin,
  type DateCheckin,
} from '../utils/dateCheckin';
import { logger } from '../utils/logger';

// ─── State ────────────────────────────────────────────────────────────────────

interface DateCheckinState {
  loading: boolean;
  submitting: boolean;
  activeCheckin: DateCheckin | null;
  // form
  matchName: string;
  location: string;
  latitude: string;
  longitude: string;
  durationHours: string;
  intervalMinutes: string;
  contactName: string;
  contactPhone: string;
  // extend
  extendMinutes: string;
  showExtendInput: boolean;
}

type DateCheckinAction =
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_SUBMITTING'; payload: boolean }
  | { type: 'SET_ACTIVE_CHECKIN'; payload: DateCheckin | null }
  | { type: 'SET_MATCH_NAME'; payload: string }
  | { type: 'SET_LOCATION'; payload: string }
  | { type: 'SET_LATITUDE'; payload: string }
  | { type: 'SET_LONGITUDE'; payload: string }
  | { type: 'SET_DURATION_HOURS'; payload: string }
  | { type: 'SET_INTERVAL_MINUTES'; payload: string }
  | { type: 'SET_CONTACT_NAME'; payload: string }
  | { type: 'SET_CONTACT_PHONE'; payload: string }
  | { type: 'SET_EXTEND_MINUTES'; payload: string }
  | { type: 'TOGGLE_EXTEND_INPUT' }
  | { type: 'INIT_FROM_LOAD'; payload: DateCheckin | null };

const initialState: DateCheckinState = {
  loading: true,
  submitting: false,
  activeCheckin: null,
  matchName: '',
  location: '',
  latitude: '',
  longitude: '',
  durationHours: '2',
  intervalMinutes: '60',
  contactName: '',
  contactPhone: '',
  extendMinutes: '30',
  showExtendInput: false,
};

function reducer(
  state: DateCheckinState,
  action: DateCheckinAction,
): DateCheckinState {
  switch (action.type) {
    case 'SET_LOADING':        return { ...state, loading:        action.payload };
    case 'SET_SUBMITTING':     return { ...state, submitting:     action.payload };
    case 'SET_ACTIVE_CHECKIN': return { ...state, activeCheckin:  action.payload };
    case 'SET_MATCH_NAME':     return { ...state, matchName:      action.payload };
    case 'SET_LOCATION':       return { ...state, location:       action.payload };
    case 'SET_LATITUDE':       return { ...state, latitude:       action.payload };
    case 'SET_LONGITUDE':      return { ...state, longitude:      action.payload };
    case 'SET_DURATION_HOURS': return { ...state, durationHours:  action.payload };
    case 'SET_INTERVAL_MINUTES': return { ...state, intervalMinutes: action.payload };
    case 'SET_CONTACT_NAME':   return { ...state, contactName:    action.payload };
    case 'SET_CONTACT_PHONE':  return { ...state, contactPhone:   action.payload };
    case 'SET_EXTEND_MINUTES': return { ...state, extendMinutes:  action.payload };
    case 'TOGGLE_EXTEND_INPUT': return { ...state, showExtendInput: !state.showExtendInput };
    case 'INIT_FROM_LOAD':     return { ...state, loading: false, activeCheckin: action.payload };
    default:                   return state;
  }
}

// ─── Progress bar ─────────────────────────────────────────────────────────────

const ProgressBar = React.memo(function ProgressBar({
  percent,
}: {
  percent: number;
}) {
  const fillStyle = useMemo(
    () => [st.progressFill, { width: `${percent}%` as `${number}%` }],
    [percent],
  );
  return (
    <View style={st.progressTrack}>
      <View style={fillStyle} />
    </View>
  );
});

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function DateCheckinScreen() {
  const router = useRouter();
  const [state, dispatch] = useReducer(reducer, initialState);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  // ── Load active check-in ──────────────────────────────────────────────────

  useEffect(() => {
    void (async () => {
      try {
        const checkin = await getActiveCheckin();
        if (isMounted.current) {
          dispatch({ type: 'INIT_FROM_LOAD', payload: checkin });
        }
      } catch (e) {
        logger.error('[DateCheckin] load error:', e);
        if (isMounted.current) {
          dispatch({ type: 'SET_LOADING', payload: false });
        }
      }
    })();
  }, []);

  // ── Derived state ─────────────────────────────────────────────────────────

  const checkinStatus = useMemo(
    () =>
      state.activeCheckin ? formatCheckinStatus(state.activeCheckin) : null,
    [state.activeCheckin],
  );

  const progressPercent = useMemo(
    () =>
      state.activeCheckin
        ? getCheckinProgressPercent(state.activeCheckin)
        : 0,
    [state.activeCheckin],
  );

  const timeUntilNext = useMemo(
    () =>
      state.activeCheckin
        ? getTimeUntilNextCheckin(state.activeCheckin.nextCheckinDue)
        : null,
    [state.activeCheckin],
  );

  const overdue = useMemo(
    () =>
      state.activeCheckin ? isCheckinOverdue(state.activeCheckin) : false,
    [state.activeCheckin],
  );

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleStart = useCallback(async () => {
    const {
      matchName,
      location,
      latitude,
      longitude,
      durationHours,
      intervalMinutes,
      contactName,
      contactPhone,
    } = state;

    if (!matchName.trim() || !location.trim()) {
      Alert.alert('Missing Fields', 'Enter match name and location.');
      return;
    }

    const duration = parseFloat(durationHours) || 2;
    const interval = parseInt(intervalMinutes) || 60;

    const emergencyContact =
      contactName.trim() && contactPhone.trim()
        ? { name: contactName.trim(), phone: contactPhone.trim() }
        : undefined;

    const lat = latitude.trim() ? parseFloat(latitude) : undefined;
    const lng = longitude.trim() ? parseFloat(longitude) : undefined;

    dispatch({ type: 'SET_SUBMITTING', payload: true });
    try {
      const result = await startDateCheckin(
        'unknown',
        matchName.trim(),
        location.trim(),
        duration,
        interval,
        emergencyContact,
        lat,
        lng,
      );

      if (result.success) {
        const checkin = await getActiveCheckin();
        if (isMounted.current) {
          dispatch({ type: 'SET_ACTIVE_CHECKIN', payload: checkin });
        }
        Alert.alert(
          '🛡️ Check-in Started',
          'You will be reminded to check in. Stay safe!',
        );
      } else {
        Alert.alert('Error', result.error ?? 'Failed to start check-in.');
      }
    } catch (e) {
      logger.error('[DateCheckin] start error:', e);
      Alert.alert('Error', 'Something went wrong.');
    } finally {
      if (isMounted.current) {
        dispatch({ type: 'SET_SUBMITTING', payload: false });
      }
    }
  }, [state]);

  const handleCheckinOk = useCallback(async () => {
    if (!state.activeCheckin) return;
    dispatch({ type: 'SET_SUBMITTING', payload: true });
    try {
      const result = await performCheckin(state.activeCheckin.id, 'ok');
      if (result.success) {
        const updated = await getActiveCheckin();
        if (isMounted.current) {
          dispatch({ type: 'SET_ACTIVE_CHECKIN', payload: updated });
        }
        Alert.alert('✅ Checked In', 'Glad you\'re safe! Next reminder scheduled.');
      } else {
        Alert.alert('Error', result.error ?? 'Failed to check in.');
      }
    } catch (e) {
      logger.error('[DateCheckin] ok error:', e);
      Alert.alert('Error', 'Something went wrong.');
    } finally {
      if (isMounted.current) {
        dispatch({ type: 'SET_SUBMITTING', payload: false });
      }
    }
  }, [state.activeCheckin]);

  const handleExtend = useCallback(async () => {
    if (!state.activeCheckin) return;
    const minutes = parseInt(state.extendMinutes) || 30;
    dispatch({ type: 'SET_SUBMITTING', payload: true });
    try {
      const result = await performCheckin(
        state.activeCheckin.id,
        'extend',
        undefined,
        minutes,
      );
      if (result.success) {
        const updated = await getActiveCheckin();
        if (isMounted.current) {
          dispatch({ type: 'SET_ACTIVE_CHECKIN', payload: updated });
          dispatch({ type: 'TOGGLE_EXTEND_INPUT' });
        }
        Alert.alert('⏰ Extended', `Date extended by ${minutes} minutes.`);
      } else {
        Alert.alert('Error', result.error ?? 'Failed to extend.');
      }
    } catch (e) {
      logger.error('[DateCheckin] extend error:', e);
      Alert.alert('Error', 'Something went wrong.');
    } finally {
      if (isMounted.current) {
        dispatch({ type: 'SET_SUBMITTING', payload: false });
      }
    }
  }, [state.activeCheckin, state.extendMinutes]);

  const handleEnd = useCallback(() => {
    if (!state.activeCheckin) return;
    Alert.alert(
      'End Date Check-in',
      'Mark your date as safely completed?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'End Safely',
          onPress: async () => {
            dispatch({ type: 'SET_SUBMITTING', payload: true });
            try {
              const result = await performCheckin(
                state.activeCheckin!.id,
                'end',
              );
              if (result.success) {
                if (isMounted.current) {
                  dispatch({ type: 'SET_ACTIVE_CHECKIN', payload: null });
                }
                Alert.alert('✅ Date Ended', 'Stay safe! Check-in completed.');
              } else {
                Alert.alert('Error', result.error ?? 'Failed to end.');
              }
            } catch (e) {
              logger.error('[DateCheckin] end error:', e);
              Alert.alert('Error', 'Something went wrong.');
            } finally {
              if (isMounted.current) {
                dispatch({ type: 'SET_SUBMITTING', payload: false });
              }
            }
          },
        },
      ],
    );
  }, [state.activeCheckin]);

  const handleSOS = useCallback(() => {
    if (!state.activeCheckin) return;
    Alert.alert(
      '🚨 EMERGENCY SOS',
      'This will call emergency services and alert your emergency contact immediately.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: '🚨 SEND SOS',
          style: 'destructive',
          onPress: async () => {
            dispatch({ type: 'SET_SUBMITTING', payload: true });
            try {
              await performCheckin(state.activeCheckin!.id, 'sos');
              if (isMounted.current) {
                dispatch({ type: 'SET_ACTIVE_CHECKIN', payload: null });
              }
            } catch (e) {
              logger.error('[DateCheckin] sos error:', e);
            } finally {
              if (isMounted.current) {
                dispatch({ type: 'SET_SUBMITTING', payload: false });
              }
            }
          },
        },
      ],
    );
  }, [state.activeCheckin]);

  const handleCancel = useCallback(() => {
    if (!state.activeCheckin) return;
    Alert.alert(
      'Cancel Check-in',
      'Are you sure you want to cancel your date check-in?',
      [
        { text: 'Keep Active', style: 'cancel' },
        {
          text: 'Cancel Check-in',
          style: 'destructive',
          onPress: async () => {
            dispatch({ type: 'SET_SUBMITTING', payload: true });
            try {
              await cancelCheckin(state.activeCheckin!.id);
              if (isMounted.current) {
                dispatch({ type: 'SET_ACTIVE_CHECKIN', payload: null });
              }
            } catch (e) {
              logger.error('[DateCheckin] cancel error:', e);
              Alert.alert('Error', 'Failed to cancel check-in.');
            } finally {
              if (isMounted.current) {
                dispatch({ type: 'SET_SUBMITTING', payload: false });
              }
            }
          },
        },
      ],
    );
  }, [state.activeCheckin]);

  const handleMatchName     = useCallback((t: string) => dispatch({ type: 'SET_MATCH_NAME',       payload: t }), []);
  const handleLocation      = useCallback((t: string) => dispatch({ type: 'SET_LOCATION',          payload: t }), []);
  const handleLatitude      = useCallback((t: string) => dispatch({ type: 'SET_LATITUDE',          payload: t }), []);
  const handleLongitude     = useCallback((t: string) => dispatch({ type: 'SET_LONGITUDE',         payload: t }), []);
  const handleDuration      = useCallback((t: string) => dispatch({ type: 'SET_DURATION_HOURS',    payload: t }), []);
  const handleInterval      = useCallback((t: string) => dispatch({ type: 'SET_INTERVAL_MINUTES',  payload: t }), []);
  const handleContactName   = useCallback((t: string) => dispatch({ type: 'SET_CONTACT_NAME',      payload: t }), []);
  const handleContactPhone  = useCallback((t: string) => dispatch({ type: 'SET_CONTACT_PHONE',     payload: t }), []);
  const handleExtendMinutes = useCallback((t: string) => dispatch({ type: 'SET_EXTEND_MINUTES',    payload: t }), []);
  const handleToggleExtend  = useCallback(() => dispatch({ type: 'TOGGLE_EXTEND_INPUT' }), []);

  const startButtonStyle = useMemo(
    () => [st.startButton, state.submitting && st.disabled],
    [state.submitting],
  );

  // ── Loading ───────────────────────────────────────────────────────────────

  if (state.loading) {
    return (
      <View style={st.loadingContainer}>
        <ActivityIndicator size="large" color="#53a8b6" />
        <Text style={st.loadingText}>Loading...</Text>
      </View>
    );
  }

  // ── Active check-in view ──────────────────────────────────────────────────

  if (state.activeCheckin) {
    const c = state.activeCheckin;
    return (
      <ScrollView
        style={st.container}
        contentContainerStyle={st.content}
        showsVerticalScrollIndicator={false}
      >
        <Text style={st.title}>🛡️ Date Check-in</Text>

        {/* Status card */}
        <View
          style={[
            st.statusCard,
            overdue && st.statusCardOverdue,
            c.status === 'emergency' && st.statusCardEmergency,
          ]}
        >
          <View style={st.statusRow}>
            <Text style={st.statusIcon}>{checkinStatus?.icon}</Text>
            <Text
              style={[st.statusLabel, { color: checkinStatus?.color ?? '#53a8b6' }]}
            >
              {checkinStatus?.label}
            </Text>
          </View>

          <Text style={st.cardRow}>👤 {c.matchName}</Text>
          <Text style={st.cardRow}>📍 {c.location}</Text>
          <Text style={st.cardRow}>
            🕐 Started: {new Date(c.startTime).toLocaleTimeString()}
          </Text>
          <Text style={st.cardRow}>
            🏁 Ends: {new Date(c.expectedEndTime).toLocaleTimeString()}
          </Text>
          {c.emergencyContact && (
            <Text style={st.cardRow}>
              📱 Contact: {c.emergencyContact.name}
            </Text>
          )}

          {/* Progress */}
          <View style={st.progressSection}>
            <Text style={st.progressLabel}>Date progress: {progressPercent}%</Text>
            <ProgressBar percent={progressPercent} />
          </View>

          {/* Next check-in timer */}
          {c.status === 'active' && (
            <View style={[st.timerBox, overdue && st.timerBoxOverdue]}>
              <Text style={st.timerLabel}>
                {overdue ? '⚠️ Check-in overdue!' : '⏱️ Next check-in in:'}
              </Text>
              <Text style={[st.timerValue, overdue && st.timerValueOverdue]}>
                {timeUntilNext}
              </Text>
            </View>
          )}

          {/* Check-in history */}
          {c.checkins.length > 0 && (
            <View style={st.historyBox}>
              <Text style={st.historyTitle}>
                ✅ {c.checkins.length} check-in
                {c.checkins.length !== 1 ? 's' : ''} recorded
              </Text>
              <Text style={st.historyLast}>
                Last:{' '}
                {new Date(
                  c.checkins[c.checkins.length - 1]!.timestamp,
                ).toLocaleTimeString()}
              </Text>
            </View>
          )}
        </View>

        {/* Actions */}
        {c.status === 'active' && (
          <>
            <TouchableOpacity
              style={st.okButton}
              onPress={handleCheckinOk}
              disabled={state.submitting}
              accessibilityLabel="I am safe check in"
              accessibilityRole="button"
            >
              {state.submitting ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={st.okText}>✅ I&apos;m Safe — Check In</Text>
              )}
            </TouchableOpacity>

            {/* Extend */}
            <TouchableOpacity
              style={st.extendButton}
              onPress={handleToggleExtend}
              accessibilityLabel="Extend date duration"
              accessibilityRole="button"
            >
              <Text style={st.extendText}>
                ⏰ Extend Date {state.showExtendInput ? '▲' : '▼'}
              </Text>
            </TouchableOpacity>

            {state.showExtendInput && (
              <View style={st.extendPanel}>
                <Text style={st.label}>Extend by (minutes)</Text>
                <TextInput
                  style={st.input}
                  value={state.extendMinutes}
                  onChangeText={handleExtendMinutes}
                  keyboardType="number-pad"
                  placeholder="30"
                  placeholderTextColor="#666"
                  accessibilityLabel="Extend minutes"
                />
                <TouchableOpacity
                  style={st.extendConfirmButton}
                  onPress={handleExtend}
                  disabled={state.submitting}
                  accessibilityLabel="Confirm extend"
                  accessibilityRole="button"
                >
                  <Text style={st.extendConfirmText}>Confirm Extension</Text>
                </TouchableOpacity>
              </View>
            )}

            <TouchableOpacity
              style={st.endButton}
              onPress={handleEnd}
              disabled={state.submitting}
              accessibilityLabel="End date safely"
              accessibilityRole="button"
            >
              <Text style={st.endText}>🏁 End Date Safely</Text>
            </TouchableOpacity>
          </>
        )}

        {/* SOS — always visible during active */}
        <TouchableOpacity
          style={st.sosButton}
          onPress={handleSOS}
          accessibilityLabel="Emergency SOS"
          accessibilityRole="button"
        >
          <Text style={st.sosText}>🚨 EMERGENCY SOS</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={st.cancelButton}
          onPress={handleCancel}
          accessibilityLabel="Cancel check-in"
          accessibilityRole="button"
        >
          <Text style={st.cancelText}>✕ Cancel Check-in</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={st.backButton}
          onPress={() => router.back()}
          accessibilityLabel="Go back"
          accessibilityRole="button"
        >
          <Text style={st.backText}>← Back</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  // ── Setup form ────────────────────────────────────────────────────────────

  return (
    <ScrollView
      style={st.container}
      contentContainerStyle={st.content}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <Text style={st.title}>🛡️ Date Check-in</Text>
      <Text style={st.subtitle}>
        Set up a check-in timer for your date. We&apos;ll remind you to confirm
        you&apos;re safe and alert your emergency contact if you miss one.
      </Text>

      <View style={st.section}>
        <Text style={st.sectionTitle}>📋 Date Details</Text>

        <Text style={st.label}>Match Name *</Text>
        <TextInput
          style={st.input}
          value={state.matchName}
          onChangeText={handleMatchName}
          placeholder="Their name"
          placeholderTextColor="#666"
          accessibilityLabel="Match name"
        />

        <Text style={st.label}>Location *</Text>
        <TextInput
          style={st.input}
          value={state.location}
          onChangeText={handleLocation}
          placeholder="e.g. Starbucks, Central Park"
          placeholderTextColor="#666"
          accessibilityLabel="Location"
        />

        <Text style={st.label}>Duration (hours)</Text>
        <TextInput
          style={st.input}
          value={state.durationHours}
          onChangeText={handleDuration}
          placeholder="2"
          placeholderTextColor="#666"
          keyboardType="decimal-pad"
          accessibilityLabel="Duration in hours"
        />

        <Text style={st.label}>Check-in Interval (minutes)</Text>
        <TextInput
          style={st.input}
          value={state.intervalMinutes}
          onChangeText={handleInterval}
          placeholder="60"
          placeholderTextColor="#666"
          keyboardType="number-pad"
          accessibilityLabel="Check-in interval in minutes"
        />
      </View>

      <View style={st.section}>
        <Text style={st.sectionTitle}>📍 Location Coordinates (optional)</Text>
        <Text style={st.hint}>
          Adding coordinates lets your emergency contact open the exact spot in
          Maps.
        </Text>

        <Text style={st.label}>Latitude</Text>
        <TextInput
          style={st.input}
          value={state.latitude}
          onChangeText={handleLatitude}
          placeholder="40.7128"
          placeholderTextColor="#666"
          keyboardType="decimal-pad"
          accessibilityLabel="Latitude"
        />

        <Text style={st.label}>Longitude</Text>
        <TextInput
          style={st.input}
          value={state.longitude}
          onChangeText={handleLongitude}
          placeholder="-74.0060"
          placeholderTextColor="#666"
          keyboardType="decimal-pad"
          accessibilityLabel="Longitude"
        />
      </View>

      <View style={st.section}>
        <Text style={st.sectionTitle}>📱 Emergency Contact (optional)</Text>
        <Text style={st.hint}>
          This person will receive an SMS if you miss a check-in or trigger SOS.
        </Text>

        <Text style={st.label}>Contact Name</Text>
        <TextInput
          style={st.input}
          value={state.contactName}
          onChangeText={handleContactName}
          placeholder="Parent, friend, or sibling"
          placeholderTextColor="#666"
          accessibilityLabel="Emergency contact name"
        />

        <Text style={st.label}>Contact Phone</Text>
        <TextInput
          style={st.input}
          value={state.contactPhone}
          onChangeText={handleContactPhone}
          placeholder="+994 50 123 4567"
          placeholderTextColor="#666"
          keyboardType="phone-pad"
          accessibilityLabel="Emergency contact phone"
        />
      </View>

      <TouchableOpacity
        style={startButtonStyle}
        onPress={handleStart}
        disabled={state.submitting}
        accessibilityLabel="Start date check-in"
        accessibilityRole="button"
      >
        {state.submitting ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Text style={st.startText}>🛡️ Start Check-in</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        style={st.backButton}
        onPress={() => router.back()}
        accessibilityLabel="Go back"
        accessibilityRole="button"
      >
        <Text style={st.backText}>← Back</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const st = StyleSheet.create((theme) => ({
  container:          { flex: 1, backgroundColor: theme.colors.background },
  content:            { padding: 20, paddingBottom: 60 },
  loadingContainer:   { flex: 1, backgroundColor: theme.colors.background, justifyContent: 'center', alignItems: 'center' },
  loadingText:        { color: theme.colors.textSecondary, marginTop: 12, fontSize: 16 },
  title:              { fontSize: 28, fontWeight: 'bold', color: theme.colors.text, textAlign: 'center', marginTop: 20, marginBottom: 8 },
  subtitle:           { fontSize: 13, color: theme.colors.textSecondary, textAlign: 'center', marginBottom: 24, lineHeight: 20 },
  section:            { marginBottom: 24 },
  sectionTitle:       { fontSize: 16, fontWeight: '700', color: '#53a8b6', marginBottom: 10 },
  hint:               { fontSize: 12, color: theme.colors.textSecondary, marginBottom: 10, fontStyle: 'italic', lineHeight: 18 },
  label:              { fontSize: 14, color: '#ccc', marginBottom: 6, marginTop: 10 },
  input:              { backgroundColor: '#16213e', color: theme.colors.text, padding: 14, borderRadius: 10, fontSize: 16 },

  // Status card
  statusCard:         { backgroundColor: '#16213e', borderRadius: 15, padding: 20, marginBottom: 20, borderWidth: 1, borderColor: '#0f3460' },
  statusCardOverdue:  { borderColor: '#e67e22' },
  statusCardEmergency:{ borderColor: '#d9534f' },
  statusRow:          { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  statusIcon:         { fontSize: 28, marginRight: 10 },
  statusLabel:        { fontSize: 20, fontWeight: '700' },
  cardRow:            { color: '#ccc', fontSize: 14, marginBottom: 6 },

  // Progress
  progressSection:    { marginTop: 14, marginBottom: 6 },
  progressLabel:      { color: theme.colors.textSecondary, fontSize: 12, marginBottom: 6 },
  progressTrack:      { height: 8, backgroundColor: '#0f3460', borderRadius: 4, overflow: 'hidden' },
  progressFill:       { height: '100%', backgroundColor: '#53a8b6', borderRadius: 4 },

  // Timer
  timerBox:           { backgroundColor: '#0f3460', borderRadius: 10, padding: 12, marginTop: 12, alignItems: 'center' },
  timerBoxOverdue:    { backgroundColor: 'rgba(230,126,34,0.15)', borderColor: '#e67e22', borderWidth: 1 },
  timerLabel:         { color: theme.colors.textSecondary, fontSize: 12, marginBottom: 4 },
  timerValue:         { color: '#53a8b6', fontSize: 32, fontWeight: '700' },
  timerValueOverdue:  { color: '#e67e22' },

  // History
  historyBox:         { backgroundColor: 'rgba(83,168,182,0.1)', borderRadius: 10, padding: 10, marginTop: 12 },
  historyTitle:       { color: '#53a8b6', fontSize: 13, fontWeight: '600' },
  historyLast:        { color: theme.colors.textSecondary, fontSize: 11, marginTop: 2 },

  // Action buttons
  okButton:           { backgroundColor: '#27ae60', paddingVertical: 16, borderRadius: 25, alignItems: 'center', marginBottom: 10 },
  okText:             { color: '#fff', fontSize: 17, fontWeight: '700' },
  extendButton:       { backgroundColor: '#16213e', paddingVertical: 13, borderRadius: 15, alignItems: 'center', marginBottom: 6, borderWidth: 1, borderColor: '#0f3460' },
  extendText:         { color: '#53a8b6', fontSize: 15, fontWeight: '500' },
  extendPanel:        { backgroundColor: '#16213e', borderRadius: 12, padding: 14, marginBottom: 10 },
  extendConfirmButton:{ backgroundColor: '#53a8b6', paddingVertical: 12, borderRadius: 12, alignItems: 'center', marginTop: 10 },
  extendConfirmText:  { color: '#fff', fontSize: 15, fontWeight: '600' },
  endButton:          { backgroundColor: '#0f3460', paddingVertical: 14, borderRadius: 20, alignItems: 'center', marginBottom: 10 },
  endText:            { color: '#53a8b6', fontSize: 15, fontWeight: '600' },
  sosButton:          { backgroundColor: '#d9534f', paddingVertical: 16, borderRadius: 25, alignItems: 'center', marginBottom: 10 },
  sosText:            { color: '#fff', fontSize: 17, fontWeight: '800', letterSpacing: 1 },
  cancelButton:       { paddingVertical: 12, alignItems: 'center', marginBottom: 6 },
  cancelText:         { color: '#666', fontSize: 14 },

  // Start form
  startButton:        { backgroundColor: '#53a8b6', paddingVertical: 16, borderRadius: 25, alignItems: 'center', marginTop: 6, marginBottom: 10 },
  startText:          { color: '#fff', fontSize: 17, fontWeight: '700' },
  disabled:           { opacity: 0.5 },

  backButton:         { paddingVertical: 14, alignItems: 'center', marginTop: 10 },
  backText:           { color: '#d9534f', fontSize: 16 },
}));