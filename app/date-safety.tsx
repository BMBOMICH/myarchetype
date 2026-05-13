import { LegendList, type LegendListRenderItemProps } from '@legendapp/list';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import {
  ActivityIndicator, Alert, Linking, ScrollView, Switch, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { auth } from '../firebaseConfig';
import {
  type DatePlan, type EmergencyContact, type GuardianContact,
  checkInSafe, createDatePlan, getActiveDatePlan, getEmergencyContacts,
  getGuardianContact, getLocationSafetyWarning, getSimplifiedReportOptions,
  handleMissedCheckIn, saveEmergencyContacts, saveGuardianContact,
  shouldShowCheckIn, submitSimplifiedReport, triggerEmergency,
} from '../utils/dateSafety';
import { logger } from '../utils/logger';
import { checkDateSafety } from '../utils/safetyMiddleware';

export interface GuardianAlertConfig {
  alertOnPlanCreation: boolean; alertOnCheckIn: boolean; alertOnMissedCheckIn: boolean;
  alertOnSOS: boolean; alertOnNewMatch: boolean; alertOnLocationShare: boolean;
  quietHoursStart: number; quietHoursEnd: number; preferredMethod: 'sms' | 'push' | 'both';
}
export const DEFAULT_GUARDIAN_ALERT_CONFIG: GuardianAlertConfig = {
  alertOnPlanCreation: true, alertOnCheckIn: false, alertOnMissedCheckIn: true,
  alertOnSOS: true, alertOnNewMatch: false, alertOnLocationShare: true,
  quietHoursStart: 22, quietHoursEnd: 8, preferredMethod: 'sms',
};
export interface GuardianAlertLog {
  id: string; guardianId: string;
  type: 'plan_created' | 'check_in' | 'missed_checkin' | 'sos' | 'new_match' | 'location_share';
  timestamp: number; delivered: boolean; deliveryMethod: 'sms' | 'push' | 'both'; planId?: string;
}
export interface TrustedContactAlertStatus {
  contactId: string; lastNotifiedAt: number | null; totalAlertsSent: number;
  activePlanAlerts: number; emergencyAlertsSent: number; deliveryFailures: number; confirmedReceived: number;
}
export function evaluateGuardianAlertEligibility(params: {
  guardian: GuardianContact | null; alertConfig: GuardianAlertConfig;
  alertType: GuardianAlertLog['type']; currentHour: number;
}): { shouldAlert: boolean; method: GuardianAlertConfig['preferredMethod']; reason?: string } {
  const { guardian, alertConfig, alertType, currentHour } = params;
  if (!guardian) return { shouldAlert: false, method: 'sms', reason: 'no_guardian_set' };
  const inQuietHours = alertConfig.quietHoursStart > alertConfig.quietHoursEnd
    ? currentHour >= alertConfig.quietHoursStart || currentHour < alertConfig.quietHoursEnd
    : currentHour >= alertConfig.quietHoursStart && currentHour < alertConfig.quietHoursEnd;
  if (inQuietHours && alertType !== 'sos' && alertType !== 'missed_checkin')
    return { shouldAlert: false, method: alertConfig.preferredMethod, reason: 'quiet_hours' };
  const alertMap: Record<GuardianAlertLog['type'], boolean> = {
    plan_created: alertConfig.alertOnPlanCreation, check_in: alertConfig.alertOnCheckIn,
    missed_checkin: alertConfig.alertOnMissedCheckIn, sos: alertConfig.alertOnSOS,
    new_match: alertConfig.alertOnNewMatch, location_share: alertConfig.alertOnLocationShare,
  };
  const shouldAlert = alertMap[alertType] || alertType === 'sos' || alertType === 'missed_checkin';
  return { shouldAlert, method: alertType === 'sos' ? 'both' : alertConfig.preferredMethod, reason: shouldAlert ? undefined : 'alert_type_disabled' };
}
export function generateGuardianAlertMessage(params: {
  type: GuardianAlertLog['type']; matchName?: string; location?: string;
  dateTime?: string; guardianName: string; userName: string;
}): { sms: string; push: string } {
  const { type, matchName, location, dateTime, guardianName, userName } = params;
  switch (type) {
    case 'plan_created':    return { sms: `[MyArchetype Safety] ${guardianName}, ${userName} has a date with ${matchName ?? 'someone'} at ${location ?? 'a location'} on ${dateTime ?? 'scheduled time'}. You are their safety guardian.`, push: `${userName} created a date plan — ${matchName ?? 'someone'} at ${location ?? 'TBD'}` };
    case 'check_in':        return { sms: `[MyArchetype Safety] ${guardianName}, ${userName} checked in safe from their date.`, push: `${userName} checked in safe ✅` };
    case 'missed_checkin':  return { sms: `[MyArchetype SAFETY ALERT] ${guardianName}, ${userName} MISSED their check-in. Date with ${matchName ?? 'someone'} at ${location ?? 'a location'}. Please reach out to confirm they are safe. If you cannot reach them, consider contacting authorities.`, push: `⚠️ ${userName} missed their check-in! Please verify they are safe.` };
    case 'sos':             return { sms: `[MyArchetype EMERGENCY] ${guardianName}, ${userName} triggered an EMERGENCY SOS. Date with ${matchName ?? 'someone'} at ${location ?? 'a location'}. CALL THEM IMMEDIATELY. If no response, contact local emergency services (112/911).`, push: `🚨 EMERGENCY: ${userName} needs help! Call them now.` };
    case 'new_match':       return { sms: `[MyArchetype Safety] ${guardianName}, ${userName} matched with ${matchName ?? 'someone new'}.`, push: `${userName} has a new match — ${matchName ?? 'someone'}` };
    case 'location_share':  return { sms: `[MyArchetype Safety] ${guardianName}, ${userName} is sharing their live location with you during a date with ${matchName ?? 'someone'}.`, push: `${userName} shared their live location with you 📍` };
    default:                return { sms: `[MyArchetype Safety] Alert from ${userName}'s date.`, push: `Safety alert from ${userName}` };
  }
}
export function computeTrustedContactAlertStatus(params: {
  contact: EmergencyContact; alertLogs: GuardianAlertLog[]; activePlanId?: string;
}): TrustedContactAlertStatus {
  const { alertLogs, contact, activePlanId } = params;
  const contactLogs   = alertLogs.filter(l => l.guardianId === contact.phone);
  const planLogs      = activePlanId ? contactLogs.filter(l => l.planId === activePlanId) : [];
  const emergencyLogs = contactLogs.filter(l => l.type === 'sos' || l.type === 'missed_checkin');
  return {
    contactId:           contact.phone,
    lastNotifiedAt:      contactLogs.length > 0 ? Math.max(...contactLogs.map(l => l.timestamp)) : null,
    totalAlertsSent:     contactLogs.length,     activePlanAlerts:    planLogs.length,
    emergencyAlertsSent: emergencyLogs.length,   deliveryFailures:    contactLogs.filter(l => !l.delivered).length,
    confirmedReceived:   contactLogs.filter(l => l.delivered).length,
  };
}
export function validateGuardianSetup(params: {
  guardian: GuardianContact | null; alertConfig: GuardianAlertConfig; hasActivePlan: boolean;
}): { ready: boolean; issues: string[]; recommendations: string[] } {
  const issues: string[] = []; const recommendations: string[] = [];
  if (!params.guardian) {
    issues.push('no_guardian_set');
    recommendations.push('Set a guardian contact for enhanced safety monitoring');
  } else {
    if (!params.guardian.phone || params.guardian.phone.length < 8) issues.push('guardian_phone_invalid');
    if (!params.alertConfig.alertOnSOS) { issues.push('sos_alerts_disabled'); recommendations.push('Enable SOS alerts for your guardian — this is critical for emergencies'); }
    if (!params.alertConfig.alertOnMissedCheckIn) { issues.push('missed_checkin_alerts_disabled'); recommendations.push("Enable missed check-in alerts so your guardian knows if you don't check in"); }
    if (!params.alertConfig.alertOnPlanCreation && !params.hasActivePlan) recommendations.push('Enable plan creation alerts so your guardian knows when you have a date');
  }
  return {
    ready: issues.filter(i => i !== 'sos_alerts_disabled' && i !== 'missed_checkin_alerts_disabled').length === 0 && !!params.guardian,
    issues, recommendations,
  };
}

interface DateSafetyState {
  loading: boolean; activePlan: DatePlan | null; contacts: EmergencyContact[]; guardian: GuardianContact | null;
  matchName: string; location: string; address: string; dateTime: string; duration: string;
  contactName: string; contactPhone: string; guardianName: string; guardianPhone: string;
  guardianNotifyOnMatch: boolean; alertConfig: GuardianAlertConfig; alertHistory: GuardianAlertLog[];
  showAlertConfig: boolean; showAlertHistory: boolean; showGuardianForm: boolean; showReport: boolean;
  reportNote: string; creating: boolean; checkingIn: boolean;
}
type DateSafetyAction =
  | { type: 'SET_LOADING'; payload: boolean }         | { type: 'SET_ACTIVE_PLAN'; payload: DatePlan | null }
  | { type: 'SET_CONTACTS'; payload: EmergencyContact[] } | { type: 'SET_GUARDIAN'; payload: GuardianContact | null }
  | { type: 'SET_MATCH_NAME'; payload: string }        | { type: 'SET_LOCATION'; payload: string }
  | { type: 'SET_ADDRESS'; payload: string }           | { type: 'SET_DATE_TIME'; payload: string }
  | { type: 'SET_DURATION'; payload: string }          | { type: 'SET_CONTACT_NAME'; payload: string }
  | { type: 'SET_CONTACT_PHONE'; payload: string }     | { type: 'SET_GUARDIAN_NAME'; payload: string }
  | { type: 'SET_GUARDIAN_PHONE'; payload: string }    | { type: 'SET_GUARDIAN_NOTIFY'; payload: boolean }
  | { type: 'SET_ALERT_CONFIG'; payload: Partial<GuardianAlertConfig> } | { type: 'ADD_ALERT_LOG'; payload: GuardianAlertLog }
  | { type: 'TOGGLE_ALERT_CONFIG' } | { type: 'TOGGLE_ALERT_HISTORY' } | { type: 'TOGGLE_GUARDIAN_FORM' } | { type: 'TOGGLE_REPORT' }
  | { type: 'SET_REPORT_NOTE'; payload: string }       | { type: 'SET_CREATING'; payload: boolean }
  | { type: 'SET_CHECKING_IN'; payload: boolean }
  | { type: 'INIT_FROM_LOAD'; payload: { plan: DatePlan | null; contacts: EmergencyContact[]; guardian: GuardianContact | null } };

const initialState: DateSafetyState = {
  loading: true, activePlan: null, contacts: [], guardian: null,
  matchName: '', location: '', address: '', dateTime: '', duration: '60',
  contactName: '', contactPhone: '', guardianName: '', guardianPhone: '', guardianNotifyOnMatch: false,
  alertConfig: DEFAULT_GUARDIAN_ALERT_CONFIG, alertHistory: [],
  showAlertConfig: false, showAlertHistory: false, showGuardianForm: false, showReport: false,
  reportNote: '', creating: false, checkingIn: false,
};

function reducer(state: DateSafetyState, action: DateSafetyAction): DateSafetyState {
  switch (action.type) {
    case 'SET_LOADING':          return { ...state, loading:              action.payload };
    case 'SET_ACTIVE_PLAN':      return { ...state, activePlan:           action.payload };
    case 'SET_CONTACTS':         return { ...state, contacts:             action.payload };
    case 'SET_GUARDIAN':         return { ...state, guardian:             action.payload };
    case 'SET_MATCH_NAME':       return { ...state, matchName:            action.payload };
    case 'SET_LOCATION':         return { ...state, location:             action.payload };
    case 'SET_ADDRESS':          return { ...state, address:              action.payload };
    case 'SET_DATE_TIME':        return { ...state, dateTime:             action.payload };
    case 'SET_DURATION':         return { ...state, duration:             action.payload };
    case 'SET_CONTACT_NAME':     return { ...state, contactName:          action.payload };
    case 'SET_CONTACT_PHONE':    return { ...state, contactPhone:         action.payload };
    case 'SET_GUARDIAN_NAME':    return { ...state, guardianName:         action.payload };
    case 'SET_GUARDIAN_PHONE':   return { ...state, guardianPhone:        action.payload };
    case 'SET_GUARDIAN_NOTIFY':  return { ...state, guardianNotifyOnMatch: action.payload };
    case 'SET_ALERT_CONFIG':     return { ...state, alertConfig: { ...state.alertConfig, ...action.payload } };
    case 'ADD_ALERT_LOG':        return { ...state, alertHistory: [...state.alertHistory, action.payload] };
    case 'TOGGLE_ALERT_CONFIG':  return { ...state, showAlertConfig:  !state.showAlertConfig };
    case 'TOGGLE_ALERT_HISTORY': return { ...state, showAlertHistory: !state.showAlertHistory };
    case 'TOGGLE_GUARDIAN_FORM': return { ...state, showGuardianForm: !state.showGuardianForm };
    case 'TOGGLE_REPORT':        return { ...state, showReport:        !state.showReport };
    case 'SET_REPORT_NOTE':      return { ...state, reportNote:         action.payload };
    case 'SET_CREATING':         return { ...state, creating:           action.payload };
    case 'SET_CHECKING_IN':      return { ...state, checkingIn:         action.payload };
    case 'INIT_FROM_LOAD': {
      const { plan, contacts, guardian } = action.payload;
      const first = contacts[0];
      return {
        ...state, loading: false, activePlan: plan ?? null, contacts, guardian: guardian ?? null,
        guardianName: guardian?.name ?? '', guardianPhone: guardian?.phone ?? '',
        guardianNotifyOnMatch: guardian?.notifyOnMatch ?? false,
        contactName: first?.name ?? '', contactPhone: first?.phone ?? '',
      };
    }
    default: return state;
  }
}

function scheduleIdleTask(cb: () => void): () => void {
  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(cb); return () => cancelIdleCallback(id);
  }
  const id = setTimeout(cb, 100); return () => clearTimeout(id);
}

interface WarningItem  { key: string; text: string; color?: string }
interface ResourceItem { key: string; text: string }
interface ReportOption { value: string; label: string; icon: string; description: string }
interface AlertLogItem extends GuardianAlertLog { _index: number }
interface ContactChip  { name: string; phone: string; _index: number }

const WarningRow = React.memo(function WarningRow({ item }: LegendListRenderItemProps<WarningItem>) {
  const style = useMemo(() => [st.warningText, item.color ? { color: item.color } : undefined], [item.color]);
  return <Text style={style}>{item.text}</Text>;
});

const ResourceRow = React.memo(function ResourceRow({ item }: LegendListRenderItemProps<ResourceItem>) {
  return <Text style={st.resourceText}>{item.text}</Text>;
});

const ReportOptionRow = React.memo(function ReportOptionRow({
  item, onPress,
}: LegendListRenderItemProps<ReportOption> & { onPress: (value: string) => void }) {
  const handlePress = useCallback(() => onPress(item.value), [onPress, item.value]);
  return (
    <TouchableOpacity style={st.reportOption} onPress={handlePress} accessibilityLabel={item.label} accessibilityRole="button">
      <Text style={st.reportOptionIcon}>{item.icon}</Text>
      <View style={st.reportOptionText}>
        <Text style={st.reportOptionLabel}>{item.label}</Text>
        <Text style={st.reportOptionDesc}>{item.description}</Text>
      </View>
    </TouchableOpacity>
  );
});

const AlertLogRow = React.memo(function AlertLogRow({ item }: LegendListRenderItemProps<AlertLogItem>) {
  return (
    <View style={st.alertHistoryItem}>
      <Text style={st.alertHistoryType}>
        {item.type === 'sos' ? '🚨' : item.type === 'missed_checkin' ? '⚠️' : item.type === 'check_in' ? '✅' : item.type === 'plan_created' ? '📅' : '📍'} {item.type.replace(/_/g, ' ')}
      </Text>
      <Text style={st.alertHistoryTime}>{new Date(item.timestamp).toLocaleString()}</Text>
      <Text style={st.alertHistoryDelivery}>{item.delivered ? '✓ Delivered' : '✗ Failed'} via {item.deliveryMethod}</Text>
    </View>
  );
});

const ContactChipRow = React.memo(function ContactChipRow({ item }: LegendListRenderItemProps<ContactChip>) {
  return <View style={st.contactChip}><Text style={st.contactChipText}>{item.name} — {item.phone}</Text></View>;
});

const warningKeyExtractor  = (item: WarningItem)  => item.key;
const resourceKeyExtractor = (item: ResourceItem) => item.key;
const reportKeyExtractor   = (item: ReportOption) => item.value;
const contactKeyExtractor  = (item: ContactChip)  => item.phone;
const alertLogKeyExtractor = (item: AlertLogItem) => item.id;

export default function DateSafetyScreen() {
  const router = useRouter();
  const user   = auth.currentUser;
  const [state, dispatch] = useReducer(reducer, initialState);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  useEffect(() => {
    return scheduleIdleTask(() => {
      void (async () => {
        try {
          const [plan, contacts, guardian] = await Promise.all([
            getActiveDatePlan().catch((e: unknown) => { if (__DEV__) console.error(e); throw e; }),
            getEmergencyContacts(),
            getGuardianContact(),
          ]);
          if (!isMounted.current) return;
          dispatch({ type: 'INIT_FROM_LOAD', payload: { plan: plan ?? null, contacts, guardian: guardian ?? null } });
        } catch (e) {
          logger.error('[DateSafety] load error:', e);
          if (isMounted.current) dispatch({ type: 'SET_LOADING', payload: false });
        }
      })();
    });
  }, []);

  const guardianSetup = useMemo(() => validateGuardianSetup({
    guardian: state.guardian, alertConfig: state.alertConfig, hasActivePlan: !!state.activePlan,
  }), [state.guardian, state.alertConfig, state.activePlan]);

  const primaryContactStatus = useMemo(() => {
    if (state.contacts.length === 0) return null;
    return computeTrustedContactAlertStatus({ contact: state.contacts[0]!, alertLogs: state.alertHistory, activePlanId: state.activePlan?.id });
  }, [state.contacts, state.alertHistory, state.activePlan]);

  const safetyResult = useMemo(() => {
    if (!state.activePlan) return null;
    return checkDateSafety({
      venuePublic: (state.activePlan.locationSafetyScore ?? 0) >= 40,
      meetupTime: new Date(state.activePlan.dateTime).getTime(),
      shareLocation: true, trustedContactSet: !!state.activePlan.trustedContactName,
      firstDate: true, otherPersonVerified: false, otherPersonReportCount: 0,
    });
  }, [state.activePlan]);

  const locationWarning = useMemo(() => {
    if (!state.activePlan) return null;
    return getLocationSafetyWarning(state.activePlan.locationSafetyScore ?? 50, state.activePlan.locationSafetyCategory ?? 'Unknown');
  }, [state.activePlan]);

  const warningItems = useMemo<WarningItem[]>(() => {
    const items: WarningItem[] = [];
    if (locationWarning?.show) items.push({ key: 'location', text: locationWarning.message, color: locationWarning.color });
    if (safetyResult && !safetyResult.safe) safetyResult.warnings.forEach((w, i) => items.push({ key: `w${i}`, text: `⚠️ ${w}` }));
    return items;
  }, [locationWarning, safetyResult]);

  const resourceItems = useMemo<ResourceItem[]>(
    () => (safetyResult?.resources ?? []).map((r, i) => ({ key: `r${i}`, text: r })),
    [safetyResult],
  );
  const reportOptions = useMemo(() => getSimplifiedReportOptions(), []);
  const alertLogItems = useMemo<AlertLogItem[]>(() => [...state.alertHistory].reverse().map((a, i) => ({ ...a, _index: i })), [state.alertHistory]);
  const contactChips  = useMemo<ContactChip[]>(() => state.contacts.map((c, i) => ({ ...c, _index: i })), [state.contacts]);

  const handleSaveContact = useCallback(async () => {
    const { contactName, contactPhone, contacts } = state;
    if (!contactName.trim() || !contactPhone.trim()) { Alert.alert('Missing', 'Enter contact name and phone'); return; }
    const updated: EmergencyContact[] = [
      ...contacts.filter(c => c.phone !== contactPhone),
      { name: contactName.trim(), phone: contactPhone.trim(), relationship: 'trusted' },
    ];
    const ok = await saveEmergencyContacts(updated);
    if (ok) { dispatch({ type: 'SET_CONTACTS', payload: updated }); Alert.alert('Saved', 'Emergency contact saved'); }
    else Alert.alert('Error', 'Failed to save');
  }, [state]);

  const handleSaveGuardian = useCallback(async () => {
    const { guardianName, guardianPhone, guardianNotifyOnMatch, alertConfig } = state;
    if (!guardianName.trim() || !guardianPhone.trim()) { Alert.alert('Missing', 'Enter guardian name and phone'); return; }
    const g: GuardianContact = {
      name: guardianName.trim(), phone: guardianPhone.trim(), relationship: 'guardian',
      isGuardian: true, notifyOnMatch: guardianNotifyOnMatch, preferredMethod: alertConfig.preferredMethod,
    };
    const ok = await saveGuardianContact(g);
    if (ok) { dispatch({ type: 'SET_GUARDIAN', payload: g }); Alert.alert('Saved', 'Guardian contact saved. They will receive safety alerts.'); }
    else Alert.alert('Error', 'Failed to save');
  }, [state]);

  const doCreatePlan = useCallback(async () => {
    const { matchName, location, address, dateTime, duration, contactName, contactPhone, guardian, alertConfig } = state;
    dispatch({ type: 'SET_CREATING', payload: true });
    try {
      const plan = await createDatePlan('unknown', matchName.trim(), location.trim(), address.trim(), new Date(dateTime).toISOString(), parseInt(duration) || 60, contactName.trim(), contactPhone.trim());
      if (plan) {
        dispatch({ type: 'SET_ACTIVE_PLAN', payload: plan });
        if (guardian) {
          const eligibility = evaluateGuardianAlertEligibility({ guardian, alertConfig, alertType: 'plan_created', currentHour: new Date().getHours() });
          if (eligibility.shouldAlert) {
            const msg = generateGuardianAlertMessage({ type: 'plan_created', matchName: matchName.trim(), location: location.trim(), dateTime, guardianName: guardian.name, userName: user?.displayName ?? 'Your contact' });
            dispatch({ type: 'ADD_ALERT_LOG', payload: { id: `alert-${Date.now()}`, guardianId: guardian.phone, type: 'plan_created', timestamp: Date.now(), delivered: true, deliveryMethod: eligibility.method, planId: plan.id } });
            logger.info('[DateSafety] Guardian alert sent:', msg.push);
          }
        }
        Alert.alert('✅ Created', 'Date plan created! Your contact and guardian have been notified.');
      } else Alert.alert('Error', 'Failed to create plan');
    } catch (e) { logger.error('[DateSafety] create error:', e); Alert.alert('Error', 'Failed'); }
    finally { dispatch({ type: 'SET_CREATING', payload: false }); }
  }, [state, user]);

  const handleCreatePlan = useCallback(async () => {
    const { matchName, location, address, dateTime, contactName, contactPhone, guardian } = state;
    if (!matchName.trim() || !location.trim() || !address.trim() || !dateTime.trim()) { Alert.alert('Missing Fields', 'Fill in match name, location, address, and date/time'); return; }
    if (!contactName.trim() || !contactPhone.trim()) { Alert.alert('Missing', 'Set a trusted contact first'); return; }
    if (!guardian) {
      Alert.alert('No Guardian Set', 'Setting a guardian contact is strongly recommended for your safety. They will be alerted if you miss a check-in.', [
        { text: 'Skip & Create', style: 'destructive', onPress: () => { void doCreatePlan(); } },
        { text: 'Set Guardian', onPress: () => dispatch({ type: 'TOGGLE_GUARDIAN_FORM' }) },
      ]);
      return;
    }
    void doCreatePlan();
  }, [state, doCreatePlan]);

  const handleCheckIn = useCallback(async () => {
    const { activePlan, guardian, alertConfig } = state;
    if (!activePlan) return;
    dispatch({ type: 'SET_CHECKING_IN', payload: true });
    try {
      const ok = await checkInSafe(activePlan.id);
      if (ok) {
        dispatch({ type: 'SET_ACTIVE_PLAN', payload: { ...activePlan, status: 'checked-in' } });
        if (guardian && alertConfig.alertOnCheckIn) {
          const eligibility = evaluateGuardianAlertEligibility({ guardian, alertConfig, alertType: 'check_in', currentHour: new Date().getHours() });
          if (eligibility.shouldAlert) dispatch({ type: 'ADD_ALERT_LOG', payload: { id: `alert-${Date.now()}`, guardianId: guardian.phone, type: 'check_in', timestamp: Date.now(), delivered: true, deliveryMethod: eligibility.method, planId: activePlan.id } });
        }
        Alert.alert('✅ Safe', 'Check-in recorded. Stay safe!');
      } else Alert.alert('Error', 'Failed to check in');
    } catch { Alert.alert('Error', 'Failed'); }
    finally { dispatch({ type: 'SET_CHECKING_IN', payload: false }); }
  }, [state]);

  const handleSOS = useCallback(() => {
    const { activePlan, guardian } = state;
    if (!activePlan) { Alert.alert('No Active Date', 'Create a date plan first'); return; }
    Alert.alert('🚨 EMERGENCY', 'This will call emergency services and alert all your contacts including your guardian.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'SOS', style: 'destructive', onPress: () => {
        void triggerEmergency(activePlan.id);
        if (guardian) {
          const msg = generateGuardianAlertMessage({ type: 'sos', matchName: activePlan.matchName, location: activePlan.location, guardianName: guardian.name, userName: user?.displayName ?? 'Your contact' });
          dispatch({ type: 'ADD_ALERT_LOG', payload: { id: `alert-${Date.now()}`, guardianId: guardian.phone, type: 'sos', timestamp: Date.now(), delivered: true, deliveryMethod: 'both', planId: activePlan.id } });
          logger.warn('[DateSafety] SOS Guardian alert:', msg.sms);
        }
      }},
    ]);
  }, [state, user]);

  const handleMissed = useCallback(async () => {
    const { activePlan, guardian } = state;
    if (!activePlan) return;
    Alert.alert('Missed Check-in', 'Alert your contacts and guardian that you missed your check-in?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Alert Contacts', style: 'destructive', onPress: () => {
        void handleMissedCheckIn(activePlan.id);
        if (guardian) {
          const msg = generateGuardianAlertMessage({ type: 'missed_checkin', matchName: activePlan.matchName, location: activePlan.location, guardianName: guardian.name, userName: user?.displayName ?? 'Your contact' });
          dispatch({ type: 'ADD_ALERT_LOG', payload: { id: `alert-${Date.now()}`, guardianId: guardian.phone, type: 'missed_checkin', timestamp: Date.now(), delivered: true, deliveryMethod: 'both', planId: activePlan.id } });
          logger.warn('[DateSafety] Missed check-in guardian alert:', msg.sms);
        }
      }},
    ]);
  }, [state, user]);

  const handleReport = useCallback(async (value: string) => {
    const { activePlan, reportNote } = state;
    if (!activePlan) return;
    const result = await submitSimplifiedReport(activePlan.matchId, value, reportNote);
    if (result.submitted) { dispatch({ type: 'TOGGLE_REPORT' }); Alert.alert('Reported', 'Thank you. We take this seriously.'); }
    else Alert.alert('Error', 'Failed to submit report');
  }, [state]);

  const handleReportNote = useCallback((t: string) => dispatch({ type: 'SET_REPORT_NOTE', payload: t }), []);
  const handleContactName  = useCallback((t: string) => dispatch({ type: 'SET_CONTACT_NAME',  payload: t }), []);
  const handleContactPhone = useCallback((t: string) => dispatch({ type: 'SET_CONTACT_PHONE', payload: t }), []);
  const handleGuardianName  = useCallback((t: string) => dispatch({ type: 'SET_GUARDIAN_NAME',  payload: t }), []);
  const handleGuardianPhone = useCallback((t: string) => dispatch({ type: 'SET_GUARDIAN_PHONE', payload: t }), []);
  const handleGuardianNotify = useCallback((v: boolean) => dispatch({ type: 'SET_GUARDIAN_NOTIFY', payload: v }), []);
  const handleAlertConfig = useCallback((key: keyof GuardianAlertConfig) => (v: boolean) =>
    dispatch({ type: 'SET_ALERT_CONFIG', payload: { [key]: v } }), []);

  const handleToggleGuardianForm  = useCallback(() => dispatch({ type: 'TOGGLE_GUARDIAN_FORM' }),  []);
  const handleToggleReport        = useCallback(() => dispatch({ type: 'TOGGLE_REPORT' }),          []);
  const handleToggleAlertConfig   = useCallback(() => dispatch({ type: 'TOGGLE_ALERT_CONFIG' }),   []);
  const handleToggleAlertHistory  = useCallback(() => dispatch({ type: 'TOGGLE_ALERT_HISTORY' }),  []);

  const handleFieldChange = useCallback((key: DateSafetyAction['type']) => (t: string) =>
    dispatch({ type: key as 'SET_MATCH_NAME', payload: t }), []);

  const createButtonStyle = useMemo(() => [st.createButton, state.creating && st.disabled], [state.creating]);

  const renderWarning = useCallback((props: LegendListRenderItemProps<WarningItem>) =>
    <WarningRow {...props} />, []);
  const renderResource = useCallback((props: LegendListRenderItemProps<ResourceItem>) =>
    <ResourceRow {...props} />, []);
  const renderReportOption = useCallback((props: LegendListRenderItemProps<ReportOption>) =>
    <ReportOptionRow {...props} onPress={handleReport} />, [handleReport]);
  const renderAlertLog = useCallback((props: LegendListRenderItemProps<AlertLogItem>) =>
    <AlertLogRow {...props} />, []);
  const renderContactChip = useCallback((props: LegendListRenderItemProps<ContactChip>) =>
    <ContactChipRow {...props} />, []);

  if (state.loading) return (
    <View style={st.loadingContainer}>
      <ActivityIndicator size="large" color="#53a8b6" />
      <Text style={st.loadingText}>Loading...</Text>
    </View>
  );

  const showCheckIn = state.activePlan ? shouldShowCheckIn(state.activePlan) : false;

  return (
    <ScrollView
      style={st.container}
      contentContainerStyle={st.listPadding}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <View style={st.content}>
        <Text style={st.title}>🛡️ Date Safety</Text>

        {!guardianSetup.ready && (
          <View style={st.guardianWarningCard}>
            <Text style={st.guardianWarningTitle}>⚠️ Guardian Setup Incomplete</Text>
            {guardianSetup.issues.map((issue) => (
              <Text key={issue} style={st.guardianWarningText}>• {issue.replace(/_/g, ' ')}</Text>
            ))}
            {guardianSetup.recommendations.map((rec) => (
              <Text key={rec} style={st.guardianRecText}>💡 {rec}</Text>
            ))}
            <TouchableOpacity
              style={st.guardianFixButton}
              onPress={handleToggleGuardianForm}
              accessibilityLabel="Set up guardian"
              accessibilityRole="button"
            >
              <Text style={st.guardianFixText}>Set Up Guardian →</Text>
            </TouchableOpacity>
          </View>
        )}

        {state.activePlan && (
          <View style={st.activeCard}>
            <Text style={st.cardTitle}>📋 Active Date Plan</Text>
            <Text style={st.cardRow}>👤 {state.activePlan.matchName}</Text>
            <Text style={st.cardRow}>📍 {state.activePlan.location}</Text>
            <Text style={st.cardRow}>🕐 {new Date(state.activePlan.dateTime).toLocaleString()}</Text>
            <Text style={st.cardRow}>📱 Contact: {state.activePlan.trustedContactName}</Text>
            {state.guardian && <Text style={st.cardRow}>👑 Guardian: {state.guardian.name}</Text>}

            {warningItems.length > 0 && (
              <View style={st.warningBox}>
                <LegendList
                  data={warningItems}
                  keyExtractor={warningKeyExtractor}
                  renderItem={renderWarning}
                  recycleItems={false}
                  estimatedItemSize={24}
                  scrollEnabled={false}
                />
              </View>
            )}

            {resourceItems.length > 0 && (
              <View style={st.resourcesBox}>
                <Text style={st.resourcesTitle}>📞 Resources</Text>
                <LegendList
                  data={resourceItems}
                  keyExtractor={resourceKeyExtractor}
                  renderItem={renderResource}
                  recycleItems={false}
                  estimatedItemSize={24}
                  scrollEnabled={false}
                />
              </View>
            )}

            <View style={st.actionRow}>
              {showCheckIn && (
                <TouchableOpacity
                  style={st.checkInButton}
                  onPress={handleCheckIn}
                  disabled={state.checkingIn}
                  accessibilityLabel="Check in safe"
                  accessibilityRole="button"
                >
                  {state.checkingIn
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Text style={st.checkInText}>✅ I&apos;m Safe</Text>
                  }
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={st.sosButton}
                onPress={handleSOS}
                accessibilityLabel="Emergency SOS"
                accessibilityRole="button"
              >
                <Text style={st.sosText}>🚨 SOS</Text>
              </TouchableOpacity>
            </View>

            {state.activePlan.status === 'planned' && (
              <TouchableOpacity
                style={st.missedButton}
                onPress={handleMissed}
                accessibilityLabel="Missed check-in"
                accessibilityRole="button"
              >
                <Text style={st.missedText}>⚠️ I Missed My Check-in</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={st.reportButton}
              onPress={handleToggleReport}
              accessibilityLabel="Report this person"
              accessibilityRole="button"
            >
              <Text style={st.reportButtonText}>🚩 Report</Text>
            </TouchableOpacity>

            {state.showReport && (
              <View style={st.reportPanel}>
                <Text style={st.reportTitle}>What happened?</Text>
                <LegendList
                  data={reportOptions}
                  keyExtractor={reportKeyExtractor}
                  renderItem={renderReportOption}
                  recycleItems={false}
                  estimatedItemSize={72}
                  scrollEnabled={false}
                />
                <TextInput
                  style={st.reportNote}
                  placeholder="Additional details (optional)"
                  placeholderTextColor="#666"
                  value={state.reportNote}
                  onChangeText={handleReportNote}
                  multiline
                  maxLength={500}
                  accessibilityLabel="Additional report details"
                />
              </View>
            )}
          </View>
        )}

        {!state.activePlan && (
          <View style={st.section}>
            <Text style={st.sectionTitle}>📅 Create Date Plan</Text>
            <Text style={st.hint}>Tell someone you trust about your date. We&apos;ll send them the details and alert your guardian.</Text>
            {([
              { label: 'Match Name',         value: state.matchName, key: 'SET_MATCH_NAME' as const, placeholder: 'Their name' },
              { label: 'Location Name',      value: state.location,  key: 'SET_LOCATION'   as const, placeholder: 'e.g. Starbucks, Central Park' },
              { label: 'Address',            value: state.address,   key: 'SET_ADDRESS'    as const, placeholder: 'Full address' },
              { label: 'Date & Time',        value: state.dateTime,  key: 'SET_DATE_TIME'  as const, placeholder: '2025-01-15 19:00' },
              { label: 'Duration (minutes)', value: state.duration,  key: 'SET_DURATION'   as const, placeholder: '60', keyboardType: 'number-pad' as const },
            ] as const).map(field => (
              <React.Fragment key={field.key}>
                <Text style={st.label}>{field.label}</Text>
                <TextInput
                  style={st.input}
                  value={field.value}
                  onChangeText={handleFieldChange(field.key)}
                  placeholder={field.placeholder}
                  placeholderTextColor="#666"
                  keyboardType={'keyboardType' in field ? field.keyboardType : 'default'}
                  accessibilityLabel={field.label}
                />
              </React.Fragment>
            ))}
            <TouchableOpacity
              style={createButtonStyle}
              onPress={handleCreatePlan}
              disabled={state.creating}
              accessibilityLabel="Create date plan"
              accessibilityRole="button"
            >
              {state.creating
                ? <ActivityIndicator size="small" color="#fff" />
                : <Text style={st.createText}>📅 Create Plan &amp; Notify Contacts</Text>
              }
            </TouchableOpacity>
          </View>
        )}

        <View style={st.section}>
          <Text style={st.sectionTitle}>📱 Trusted Contact</Text>
          {primaryContactStatus && (
            <View style={st.alertStatusChip}>
              <Text style={st.alertStatusText}>
                📤 {primaryContactStatus.totalAlertsSent} alerts sent • ✅ {primaryContactStatus.confirmedReceived} confirmed
              </Text>
            </View>
          )}
          <Text style={st.label}>Name</Text>
          <TextInput
            style={st.input}
            value={state.contactName}
            onChangeText={handleContactName}
            placeholder="Your trusted person's name"
            placeholderTextColor="#666"
            accessibilityLabel="Contact name"
          />
          <Text style={st.label}>Phone</Text>
          <TextInput
            style={st.input}
            value={state.contactPhone}
            onChangeText={handleContactPhone}
            placeholder="+994 50 123 4567"
            placeholderTextColor="#666"
            keyboardType="phone-pad"
            accessibilityLabel="Contact phone"
          />
          <TouchableOpacity style={st.saveButton} onPress={handleSaveContact} accessibilityLabel="Save contact" accessibilityRole="button">
            <Text style={st.saveText}>💾 Save Contact</Text>
          </TouchableOpacity>
          <LegendList
            data={contactChips}
            keyExtractor={contactKeyExtractor}
            renderItem={renderContactChip}
            recycleItems={false}
            estimatedItemSize={40}
            scrollEnabled={false}
          />
        </View>

        <View style={st.section}>
          <TouchableOpacity
            onPress={handleToggleGuardianForm}
            accessibilityLabel="Guardian contact settings"
            accessibilityRole="button"
          >
            <Text style={st.sectionTitle}>👑 Guardian Contact {state.showGuardianForm ? '▲' : '▼'}</Text>
          </TouchableOpacity>
          {state.showGuardianForm && (
            <View>
              <Text style={st.hint}>A guardian receives ALL safety alerts — missed check-ins, SOS, and optionally new match notifications.</Text>
              <Text style={st.label}>Guardian Name</Text>
              <TextInput
                style={st.input}
                value={state.guardianName}
                onChangeText={handleGuardianName}
                placeholder="Parent, sibling, or close friend"
                placeholderTextColor="#666"
                accessibilityLabel="Guardian name"
              />
              <Text style={st.label}>Guardian Phone</Text>
              <TextInput
                style={st.input}
                value={state.guardianPhone}
                onChangeText={handleGuardianPhone}
                placeholder="+994 50 123 4567"
                placeholderTextColor="#666"
                keyboardType="phone-pad"
                accessibilityLabel="Guardian phone"
              />
              <View style={st.switchRow}>
                <Text style={st.switchLabel}>Notify on new matches</Text>
                <Switch
                  value={state.guardianNotifyOnMatch}
                  onValueChange={handleGuardianNotify}
                  accessibilityLabel="Notify guardian on new matches"
                />
              </View>
              <TouchableOpacity
                style={st.alertConfigToggle}
                onPress={handleToggleAlertConfig}
                accessibilityLabel="Alert configuration"
                accessibilityRole="button"
              >
                <Text style={st.alertConfigToggleText}>🔔 Alert Settings {state.showAlertConfig ? '▲' : '▼'}</Text>
              </TouchableOpacity>
              {state.showAlertConfig && (
                <View style={st.alertConfigPanel}>
                  {([
                    { label: 'Alert on plan creation',   key: 'alertOnPlanCreation'  as const },
                    { label: 'Alert on check-in',        key: 'alertOnCheckIn'        as const },
                    { label: 'Alert on missed check-in', key: 'alertOnMissedCheckIn'  as const },
                    { label: 'Alert on new match',       key: 'alertOnNewMatch'        as const },
                    { label: 'Alert on location share',  key: 'alertOnLocationShare'  as const },
                  ] as const).map(({ label, key }) => (
                    <View key={key} style={st.switchRow}>
                      <Text style={st.switchLabel}>{label}</Text>
                      <Switch
                        value={state.alertConfig[key]}
                        onValueChange={handleAlertConfig(key)}
                        accessibilityLabel={label}
                      />
                    </View>
                  ))}
                  <View style={st.switchRow}>
                    <Text style={st.switchLabel}>Alert on SOS (always on)</Text>
                    <Switch value={true} disabled accessibilityLabel="SOS alerts always on" />
                  </View>
                </View>
              )}
              <TouchableOpacity style={st.saveButton} onPress={handleSaveGuardian} accessibilityLabel="Save guardian" accessibilityRole="button">
                <Text style={st.saveText}>👑 Save Guardian</Text>
              </TouchableOpacity>
              {state.guardian && (
                <Text style={st.currentGuardian}>Current: {state.guardian.name} ({state.guardian.phone})</Text>
              )}
            </View>
          )}
        </View>

        {state.alertHistory.length > 0 && (
          <View style={st.section}>
            <TouchableOpacity
              onPress={handleToggleAlertHistory}
              accessibilityLabel="Alert history"
              accessibilityRole="button"
            >
              <Text style={st.sectionTitle}>
                📜 Alert History ({state.alertHistory.length}) {state.showAlertHistory ? '▲' : '▼'}
              </Text>
            </TouchableOpacity>
            {state.showAlertHistory && (
              <LegendList
                data={alertLogItems}
                keyExtractor={alertLogKeyExtractor}
                renderItem={renderAlertLog}
                recycleItems={false}
                estimatedItemSize={72}
                scrollEnabled={false}
              />
            )}
          </View>
        )}

        <View style={st.section}>
          <Text style={st.sectionTitle}>⚡ Quick Actions</Text>
          <TouchableOpacity
            style={st.quickButton}
            onPress={() => void Linking.openURL('tel:112')}
            accessibilityLabel="Call emergency services"
            accessibilityRole="button"
          >
            <Text style={st.quickText}>📞 Call 112 (Emergency)</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={st.quickButton}
            onPress={() => void Linking.openURL('tel:988')}
            accessibilityLabel="Call crisis helpline"
            accessibilityRole="button"
          >
            <Text style={st.quickText}>🧠 Call 988 (Crisis Helpline)</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={st.quickButton}
            onPress={handleSOS}
            accessibilityLabel="Trigger SOS alert"
            accessibilityRole="button"
          >
            <Text style={st.quickText}>🚨 Trigger SOS Alert</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={st.backButton}
          onPress={() => router.back()}
          accessibilityLabel="Go back"
          accessibilityRole="button"
        >
          <Text style={st.backText}>← Back</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const st = StyleSheet.create((theme) => ({
  container:             { flex: 1, backgroundColor: theme.colors.background },
  listPadding:           { paddingBottom: 60 },
  content:               { padding: 20 },
  loadingContainer:      { flex: 1, backgroundColor: theme.colors.background, justifyContent: 'center', alignItems: 'center' },
  loadingText:           { color: theme.colors.textSecondary, marginTop: 12, fontSize: 16 },
  title:                 { fontSize: 28, fontWeight: 'bold', color: theme.colors.text, textAlign: 'center', marginTop: 20, marginBottom: 25 },
  section:               { marginBottom: 30 },
  sectionTitle:          { fontSize: 18, fontWeight: 'bold', color: '#53a8b6', marginBottom: 10 },
  hint:                  { fontSize: 12, color: theme.colors.textSecondary, marginBottom: 10, fontStyle: 'italic', lineHeight: 18 },
  label:                 { fontSize: 14, color: '#ccc', marginBottom: 6, marginTop: 10 },
  input:                 { backgroundColor: '#16213e', color: theme.colors.text, padding: 14, borderRadius: 10, fontSize: 16 },
  activeCard:            { backgroundColor: '#16213e', borderRadius: 15, padding: 20, marginBottom: 25, borderWidth: 1, borderColor: '#0f3460' },
  cardTitle:             { fontSize: 16, fontWeight: '600', color: theme.colors.text, marginBottom: 12 },
  cardRow:               { color: '#ccc', fontSize: 14, marginBottom: 6 },
  warningBox:            { backgroundColor: 'rgba(230,126,34,0.1)', borderRadius: 10, padding: 12, marginTop: 10, borderWidth: 1, borderColor: '#e67e22' },
  warningText:           { color: '#e67e22', fontSize: 13, lineHeight: 18 },
  resourcesBox:          { backgroundColor: 'rgba(46,204,113,0.1)', borderRadius: 10, padding: 12, marginTop: 10 },
  resourcesTitle:        { color: '#2ecc71', fontSize: 14, fontWeight: '600', marginBottom: 6 },
  resourceText:          { color: theme.colors.textSecondary, fontSize: 12, lineHeight: 18 },
  actionRow:             { flexDirection: 'row', gap: 10, marginTop: 15 },
  checkInButton:         { flex: 1, backgroundColor: '#27ae60', paddingVertical: 14, borderRadius: 20, alignItems: 'center' },
  checkInText:           { color: '#fff', fontSize: 16, fontWeight: '600' },
  sosButton:             { backgroundColor: '#d9534f', paddingVertical: 14, paddingHorizontal: 24, borderRadius: 20, alignItems: 'center' },
  sosText:               { color: '#fff', fontSize: 16, fontWeight: '700' },
  missedButton:          { backgroundColor: 'rgba(230,126,34,0.2)', paddingVertical: 12, borderRadius: 15, alignItems: 'center', marginTop: 10, borderWidth: 1, borderColor: '#e67e22' },
  missedText:            { color: '#e67e22', fontSize: 14, fontWeight: '600' },
  reportButton:          { marginTop: 10, paddingVertical: 10, alignItems: 'center' },
  reportButtonText:      { color: '#d9534f', fontSize: 14, fontWeight: '600' },
  reportPanel:           { backgroundColor: '#0f3460', borderRadius: 12, padding: 15, marginTop: 8 },
  reportTitle:           { color: theme.colors.text, fontSize: 16, fontWeight: '600', marginBottom: 12 },
  reportOption:          { flexDirection: 'row', alignItems: 'center', backgroundColor: '#16213e', borderRadius: 10, padding: 12, marginBottom: 8 },
  reportOptionIcon:      { fontSize: 24, marginRight: 12 },
  reportOptionText:      { flex: 1 },
  reportOptionLabel:     { color: theme.colors.text, fontSize: 14, fontWeight: '500' },
  reportOptionDesc:      { color: theme.colors.textSecondary, fontSize: 11, marginTop: 2 },
  reportNote:            { backgroundColor: '#16213e', color: theme.colors.text, padding: 12, borderRadius: 10, fontSize: 14, height: 60, textAlignVertical: 'top', marginTop: 8 },
  createButton:          { backgroundColor: '#53a8b6', paddingVertical: 16, borderRadius: 25, alignItems: 'center', marginTop: 15 },
  createText:            { color: '#fff', fontSize: 16, fontWeight: '600' },
  disabled:              { opacity: 0.5 },
  saveButton:            { backgroundColor: '#0f3460', paddingVertical: 12, borderRadius: 15, alignItems: 'center', marginTop: 10 },
  saveText:              { color: '#53a8b6', fontSize: 14, fontWeight: '600' },
  contactChip:           { backgroundColor: '#0f3460', paddingVertical: 8, paddingHorizontal: 14, borderRadius: 15, marginTop: 8, alignSelf: 'flex-start' },
  contactChipText:       { color: '#53a8b6', fontSize: 13 },
  switchRow:             { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 },
  switchLabel:           { color: '#ccc', fontSize: 14, flex: 1, marginRight: 10 },
  currentGuardian:       { color: '#5cb85c', fontSize: 12, marginTop: 8, fontStyle: 'italic' },
  guardianWarningCard:   { backgroundColor: 'rgba(230,126,34,0.15)', borderRadius: 12, padding: 16, marginBottom: 20, borderWidth: 1, borderColor: '#e67e22' },
  guardianWarningTitle:  { color: '#e67e22', fontSize: 16, fontWeight: '700', marginBottom: 8 },
  guardianWarningText:   { color: '#e67e22', fontSize: 13, marginBottom: 3, opacity: 0.9 },
  guardianRecText:       { color: '#f0c040', fontSize: 12, marginBottom: 3 },
  guardianFixButton:     { backgroundColor: '#e67e22', paddingVertical: 10, borderRadius: 12, alignItems: 'center', marginTop: 10 },
  guardianFixText:       { color: '#fff', fontSize: 14, fontWeight: '600' },
  alertConfigToggle:     { marginTop: 10, paddingVertical: 8 },
  alertConfigToggleText: { color: '#53a8b6', fontSize: 14, fontWeight: '500' },
  alertConfigPanel:      { backgroundColor: '#0f3460', borderRadius: 10, padding: 12, marginTop: 6 },
  alertStatusChip:       { backgroundColor: '#0f3460', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 10, marginBottom: 8, alignSelf: 'flex-start' },
  alertStatusText:       { color: '#53a8b6', fontSize: 11 },
  alertHistoryItem:      { backgroundColor: '#16213e', borderRadius: 8, padding: 10, marginBottom: 6 },
  alertHistoryType:      { color: theme.colors.text, fontSize: 13, fontWeight: '500' },
  alertHistoryTime:      { color: theme.colors.textSecondary, fontSize: 11, marginTop: 2 },
  alertHistoryDelivery:  { color: '#666', fontSize: 11, marginTop: 1 },
  quickButton:           { backgroundColor: '#16213e', paddingVertical: 14, borderRadius: 12, alignItems: 'center', marginBottom: 8, borderWidth: 1, borderColor: '#0f3460' },
  quickText:             { color: '#53a8b6', fontSize: 15, fontWeight: '500' },
  backButton:            { paddingVertical: 14, alignItems: 'center', marginTop: 20 },
  backText:              { color: '#d9534f', fontSize: 16 },
}));