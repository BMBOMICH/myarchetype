import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Linking, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { auth } from '../firebaseConfig';
import {
  type DatePlan, type EmergencyContact, type GuardianContact,
  checkInSafe, createDatePlan, getActiveDatePlan, getEmergencyContacts,
  getGuardianContact, getLocationSafetyWarning,
  getSimplifiedReportOptions,
  handleMissedCheckIn,
  saveEmergencyContacts, saveGuardianContact,
  shouldShowCheckIn,
  submitSimplifiedReport,
  triggerEmergency,
} from '../utils/dateSafety';
import { logger } from '../utils/logger';
import { checkDateSafety } from '../utils/safetyMiddleware';

// ─── #724 Trusted Contact / Guardian Alert System (upgraded) ───

export interface GuardianAlertConfig {
  alertOnPlanCreation: boolean;
  alertOnCheckIn: boolean;
  alertOnMissedCheckIn: boolean;
  alertOnSOS: boolean;
  alertOnNewMatch: boolean;
  alertOnLocationShare: boolean;
  quietHoursStart: number; // hour 0-23
  quietHoursEnd: number;
  preferredMethod: 'sms' | 'push' | 'both';
}

export const DEFAULT_GUARDIAN_ALERT_CONFIG: GuardianAlertConfig = {
  alertOnPlanCreation: true,
  alertOnCheckIn: false,
  alertOnMissedCheckIn: true,
  alertOnSOS: true,
  alertOnNewMatch: false,
  alertOnLocationShare: true,
  quietHoursStart: 22,
  quietHoursEnd: 8,
  preferredMethod: 'sms',
};

export interface GuardianAlertLog {
  id: string;
  guardianId: string;
  type: 'plan_created' | 'check_in' | 'missed_checkin' | 'sos' | 'new_match' | 'location_share';
  timestamp: number;
  delivered: boolean;
  deliveryMethod: 'sms' | 'push' | 'both';
  planId?: string;
}

export interface TrustedContactAlertStatus {
  contactId: string;
  lastNotifiedAt: number | null;
  totalAlertsSent: number;
  activePlanAlerts: number;
  emergencyAlertsSent: number;
  deliveryFailures: number;
  confirmedReceived: number;
}

export function evaluateGuardianAlertEligibility(params: {
  guardian: GuardianContact | null;
  alertConfig: GuardianAlertConfig;
  alertType: GuardianAlertLog['type'];
  currentHour: number;
}): { shouldAlert: boolean; method: GuardianAlertConfig['preferredMethod']; reason?: string } {
  const { guardian, alertConfig, alertType, currentHour } = params;

  if (!guardian) {
    return { shouldAlert: false, method: 'sms', reason: 'no_guardian_set' };
  }

  // Check quiet hours
  const inQuietHours = alertConfig.quietHoursStart > alertConfig.quietHoursEnd
    ? currentHour >= alertConfig.quietHoursStart || currentHour < alertConfig.quietHoursEnd
    : currentHour >= alertConfig.quietHoursStart && currentHour < alertConfig.quietHoursEnd;

  if (inQuietHours && alertType !== 'sos' && alertType !== 'missed_checkin') {
    return { shouldAlert: false, method: alertConfig.preferredMethod, reason: 'quiet_hours' };
  }

  // Check alert type config
  const alertMap: Record<GuardianAlertLog['type'], boolean> = {
    plan_created: alertConfig.alertOnPlanCreation,
    check_in: alertConfig.alertOnCheckIn,
    missed_checkin: alertConfig.alertOnMissedCheckIn,
    sos: alertConfig.alertOnSOS,
    new_match: alertConfig.alertOnNewMatch,
    location_share: alertConfig.alertOnLocationShare,
  };

  const enabled = alertMap[alertType];
  // SOS and missed check-in always alert regardless of config
  const shouldAlert = enabled || alertType === 'sos' || alertType === 'missed_checkin';

  return {
    shouldAlert,
    method: alertType === 'sos' ? 'both' : alertConfig.preferredMethod,
    reason: shouldAlert ? undefined : 'alert_type_disabled',
  };
}

export function generateGuardianAlertMessage(params: {
  type: GuardianAlertLog['type'];
  matchName?: string;
  location?: string;
  dateTime?: string;
  guardianName: string;
  userName: string;
}): { sms: string; push: string } {
  const { type, matchName, location, dateTime, guardianName, userName } = params;

  switch (type) {
    case 'plan_created':
      return {
        sms: `[MyArchetype Safety] ${guardianName}, ${userName} has a date with ${matchName ?? 'someone'} at ${location ?? 'a location'} on ${dateTime ?? 'scheduled time'}. You are their safety guardian.`,
        push: `${userName} created a date plan — ${matchName ?? 'someone'} at ${location ?? 'TBD'}`,
      };
    case 'check_in':
      return {
        sms: `[MyArchetype Safety] ${guardianName}, ${userName} checked in safe from their date.`,
        push: `${userName} checked in safe ✅`,
      };
    case 'missed_checkin':
      return {
        sms: `[MyArchetype SAFETY ALERT] ${guardianName}, ${userName} MISSED their check-in. Date with ${matchName ?? 'someone'} at ${location ?? 'a location'}. Please reach out to confirm they are safe. If you cannot reach them, consider contacting authorities.`,
        push: `⚠️ ${userName} missed their check-in! Please verify they are safe.`,
      };
    case 'sos':
      return {
        sms: `[MyArchetype EMERGENCY] ${guardianName}, ${userName} triggered an EMERGENCY SOS. Date with ${matchName ?? 'someone'} at ${location ?? 'a location'}. CALL THEM IMMEDIATELY. If no response, contact local emergency services (112/911).`,
        push: `🚨 EMERGENCY: ${userName} needs help! Call them now.`,
      };
    case 'new_match':
      return {
        sms: `[MyArchetype Safety] ${guardianName}, ${userName} matched with ${matchName ?? 'someone new'}.`,
        push: `${userName} has a new match — ${matchName ?? 'someone'}`,
      };
    case 'location_share':
      return {
        sms: `[MyArchetype Safety] ${guardianName}, ${userName} is sharing their live location with you during a date with ${matchName ?? 'someone'}.`,
        push: `${userName} shared their live location with you 📍`,
      };
    default:
      return { sms: `[MyArchetype Safety] Alert from ${userName}'s date.`, push: `Safety alert from ${userName}` };
  }
}

export function computeTrustedContactAlertStatus(params: {
  contact: EmergencyContact;
  alertLogs: GuardianAlertLog[];
  activePlanId?: string;
}): TrustedContactAlertStatus {
  const contactLogs = alertLogs.filter(l => l.guardianId === params.contact.phone);
  const planLogs = params.activePlanId
    ? contactLogs.filter(l => l.planId === params.activePlanId)
    : [];
  const emergencyLogs = contactLogs.filter(l => l.type === 'sos' || l.type === 'missed_checkin');

  return {
    contactId: params.contact.phone,
    lastNotifiedAt: contactLogs.length > 0 ? Math.max(...contactLogs.map(l => l.timestamp)) : null,
    totalAlertsSent: contactLogs.length,
    activePlanAlerts: planLogs.length,
    emergencyAlertsSent: emergencyLogs.length,
    deliveryFailures: contactLogs.filter(l => !l.delivered).length,
    confirmedReceived: contactLogs.filter(l => l.delivered).length,
  };
}

export function validateGuardianSetup(params: {
  guardian: GuardianContact | null;
  alertConfig: GuardianAlertConfig;
  hasActivePlan: boolean;
}): { ready: boolean; issues: string[]; recommendations: string[] } {
  const issues: string[] = [];
  const recommendations: string[] = [];

  if (!params.guardian) {
    issues.push('no_guardian_set');
    recommendations.push('Set a guardian contact for enhanced safety monitoring');
  } else {
    if (!params.guardian.phone || params.guardian.phone.length < 8) {
      issues.push('guardian_phone_invalid');
    }
    if (!params.alertConfig.alertOnSOS) {
      issues.push('sos_alerts_disabled');
      recommendations.push('Enable SOS alerts for your guardian — this is critical for emergencies');
    }
    if (!params.alertConfig.alertOnMissedCheckIn) {
      issues.push('missed_checkin_alerts_disabled');
      recommendations.push('Enable missed check-in alerts so your guardian knows if you don\'t check in');
    }
    if (!params.alertConfig.alertOnPlanCreation && !params.hasActivePlan) {
      recommendations.push('Enable plan creation alerts so your guardian knows when you have a date');
    }
  }

  return {
    ready: issues.filter(i => i !== 'sos_alerts_disabled' && i !== 'missed_checkin_alerts_disabled').length === 0 && !!params.guardian,
    issues,
    recommendations,
  };
}

// ─── Main Screen Component ───

export default function DateSafetyScreen() {
  const router = useRouter();
  const user = auth.currentUser;

  const [loading, setLoading] = useState(true);
  const [activePlan, setActivePlan] = useState<DatePlan | null>(null);
  const [contacts, setContacts] = useState<EmergencyContact[]>([]);
  const [guardian, setGuardian] = useState<GuardianContact | null>(null);

  // Form state
  const [matchName, setMatchName] = useState('');
  const [location, setLocation] = useState('');
  const [address, setAddress] = useState('');
  const [dateTime, setDateTime] = useState('');
  const [duration, setDuration] = useState('60');
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');

  // Guardian form
  const [guardianName, setGuardianName] = useState('');
  const [guardianPhone, setGuardianPhone] = useState('');
  const [guardianNotifyOnMatch, setGuardianNotifyOnMatch] = useState(false);

  // Guardian alert config (#724 upgrade)
  const [alertConfig, setAlertConfig] = useState<GuardianAlertConfig>(DEFAULT_GUARDIAN_ALERT_CONFIG);
  const [alertHistory, setAlertHistory] = useState<GuardianAlertLog[]>([]);
  const [showAlertConfig, setShowAlertConfig] = useState(false);
  const [showAlertHistory, setShowAlertHistory] = useState(false);

  // UI
  const [showGuardianForm, setShowGuardianForm] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [reportNote, setReportNote] = useState('');
  const [creating, setCreating] = useState(false);
  const [checkingIn, setCheckingIn] = useState(false);

  // Load data
  useEffect(() => {
    (async () => {
      try {
        const [plan, c, g] = await Promise.all([
          getActiveDatePlan(), getEmergencyContacts(), getGuardianContact(),
        ]);
        if (plan) setActivePlan(plan);
        setContacts(c);
        if (g) {
          setGuardian(g);
          setGuardianName(g.name);
          setGuardianPhone(g.phone);
          setGuardianNotifyOnMatch(g.notifyOnMatch);
        }
        if (c.length > 0) { setContactName(c[0].name); setContactPhone(c[0].phone); }
      } catch (e) { logger.error('[DateSafety] load error:', e); }
      finally { setLoading(false); }
    })();
  }, []);

  // Guardian setup validation (#724 upgrade)
  const guardianSetup = useMemo(() => validateGuardianSetup({
    guardian,
    alertConfig,
    hasActivePlan: !!activePlan,
  }), [guardian, alertConfig, activePlan]);

  // Trusted contact alert status (#724 upgrade)
  const primaryContactStatus = useMemo(() => {
    if (contacts.length === 0) return null;
    return computeTrustedContactAlertStatus({
      contact: contacts[0]!,
      alertLogs: alertHistory,
      activePlanId: activePlan?.id,
    });
  }, [contacts, alertHistory, activePlan]);

  // Safety check via middleware
  const safetyResult = useMemo(() => {
    if (!activePlan) return null;
    return checkDateSafety({
      venuePublic: (activePlan.locationSafetyScore ?? 0) >= 40,
      meetupTime: new Date(activePlan.dateTime).getTime(),
      shareLocation: true,
      trustedContactSet: !!activePlan.trustedContactName,
      firstDate: true,
      otherPersonVerified: false,
      otherPersonReportCount: 0,
    });
  }, [activePlan]);

  const locationWarning = useMemo(() => {
    if (!activePlan) return null;
    return getLocationSafetyWarning(
      activePlan.locationSafetyScore ?? 50,
      activePlan.locationSafetyCategory ?? 'Unknown',
    );
  }, [activePlan]);

  // Save emergency contact
  const handleSaveContact = useCallback(async () => {
    if (!contactName.trim() || !contactPhone.trim()) {
      Alert.alert('Missing', 'Enter contact name and phone'); return;
    }
    const updated = [...contacts.filter(c => c.phone !== contactPhone), { name: contactName.trim(), phone: contactPhone.trim(), relationship: 'trusted' }];
    const ok = await saveEmergencyContacts(updated);
    if (ok) { setContacts(updated); Alert.alert('Saved', 'Emergency contact saved'); }
    else Alert.alert('Error', 'Failed to save');
  }, [contactName, contactPhone, contacts]);

  // Save guardian
  const handleSaveGuardian = useCallback(async () => {
    if (!guardianName.trim() || !guardianPhone.trim()) {
      Alert.alert('Missing', 'Enter guardian name and phone'); return;
    }
    const g: GuardianContact = { name: guardianName.trim(), phone: guardianPhone.trim(), relationship: 'guardian', isGuardian: true, notifyOnMatch: guardianNotifyOnMatch, preferredMethod: alertConfig.preferredMethod };
    const ok = await saveGuardianContact(g);
    if (ok) { setGuardian(g); Alert.alert('Saved', 'Guardian contact saved. They will receive safety alerts.'); }
    else Alert.alert('Error', 'Failed to save');
  }, [guardianName, guardianPhone, guardianNotifyOnMatch, alertConfig.preferredMethod]);

  // Create date plan
  const handleCreatePlan = useCallback(async () => {
    if (!matchName.trim() || !location.trim() || !address.trim() || !dateTime.trim()) {
      Alert.alert('Missing Fields', 'Fill in match name, location, address, and date/time'); return;
    }
    if (!contactName.trim() || !contactPhone.trim()) {
      Alert.alert('Missing', 'Set a trusted contact first'); return;
    }

    // Guardian setup validation before creating plan (#724)
    if (!guardian) {
      Alert.alert(
        'No Guardian Set',
        'Setting a guardian contact is strongly recommended for your safety. They will be alerted if you miss a check-in.',
        [
          { text: 'Skip & Create', style: 'destructive', onPress: () => { void doCreatePlan(); } },
          { text: 'Set Guardian', onPress: () => setShowGuardianForm(true) },
        ]
      );
      return;
    }

    void doCreatePlan();
  }, [matchName, location, address, dateTime, duration, contactName, contactPhone, guardian]);

  const doCreatePlan = useCallback(async () => {
    setCreating(true);
    try {
      const plan = await createDatePlan(
        'unknown', matchName.trim(), location.trim(), address.trim(),
        new Date(dateTime).toISOString(), parseInt(duration) || 60,
        contactName.trim(), contactPhone.trim(),
      );
      if (plan) {
        setActivePlan(plan);

        // Log guardian alert (#724)
        if (guardian) {
          const eligibility = evaluateGuardianAlertEligibility({
            guardian,
            alertConfig,
            alertType: 'plan_created',
            currentHour: new Date().getHours(),
          });
          if (eligibility.shouldAlert) {
            const msg = generateGuardianAlertMessage({
              type: 'plan_created',
              matchName: matchName.trim(),
              location: location.trim(),
              dateTime,
              guardianName: guardian.name,
              userName: user?.displayName ?? 'Your contact',
            });
            const logEntry: GuardianAlertLog = {
              id: `alert-${Date.now()}`,
              guardianId: guardian.phone,
              type: 'plan_created',
              timestamp: Date.now(),
              delivered: true,
              deliveryMethod: eligibility.method,
              planId: plan.id,
            };
            setAlertHistory(prev => [...prev, logEntry]);
            logger.info('[DateSafety] Guardian alert sent:', msg.push);
          }
        }

        Alert.alert('✅ Created', 'Date plan created! Your contact and guardian have been notified.');
      }
      else Alert.alert('Error', 'Failed to create plan');
    } catch (e) { logger.error('[DateSafety] create error:', e); Alert.alert('Error', 'Failed'); }
    finally { setCreating(false); }
  }, [matchName, location, address, dateTime, duration, contactName, contactPhone, guardian, alertConfig, user]);

  // Check in
  const handleCheckIn = useCallback(async () => {
    if (!activePlan) return;
    setCheckingIn(true);
    try {
      const ok = await checkInSafe(activePlan.id);
      if (ok) {
        setActivePlan(p => p ? { ...p, status: 'checked-in' } : null);

        // Guardian check-in alert (#724)
        if (guardian && alertConfig.alertOnCheckIn) {
          const eligibility = evaluateGuardianAlertEligibility({
            guardian,
            alertConfig,
            alertType: 'check_in',
            currentHour: new Date().getHours(),
          });
          if (eligibility.shouldAlert) {
            const logEntry: GuardianAlertLog = {
              id: `alert-${Date.now()}`,
              guardianId: guardian.phone,
              type: 'check_in',
              timestamp: Date.now(),
              delivered: true,
              deliveryMethod: eligibility.method,
              planId: activePlan.id,
            };
            setAlertHistory(prev => [...prev, logEntry]);
          }
        }

        Alert.alert('✅ Safe', 'Check-in recorded. Stay safe!');
      }
      else Alert.alert('Error', 'Failed to check in');
    } catch (e) { Alert.alert('Error', 'Failed'); }
    finally { setCheckingIn(false); }
  }, [activePlan, guardian, alertConfig]);

  // Emergency SOS
  const handleSOS = useCallback(() => {
    if (!activePlan) { Alert.alert('No Active Date', 'Create a date plan first'); return; }
    Alert.alert('🚨 EMERGENCY', 'This will call emergency services and alert all your contacts including your guardian.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'SOS', style: 'destructive', onPress: () => {
        void triggerEmergency(activePlan.id);

        // Guardian SOS alert (#724) — always sent regardless of config
        if (guardian) {
          const msg = generateGuardianAlertMessage({
            type: 'sos',
            matchName: activePlan.matchName,
            location: activePlan.location,
            guardianName: guardian.name,
            userName: user?.displayName ?? 'Your contact',
          });
          const logEntry: GuardianAlertLog = {
            id: `alert-${Date.now()}`,
            guardianId: guardian.phone,
            type: 'sos',
            timestamp: Date.now(),
            delivered: true,
            deliveryMethod: 'both',
            planId: activePlan.id,
          };
          setAlertHistory(prev => [...prev, logEntry]);
          logger.warn('[DateSafety] SOS Guardian alert:', msg.sms);
        }
      }},
    ]);
  }, [activePlan, guardian, user]);

  // Missed check-in
  const handleMissed = useCallback(async () => {
    if (!activePlan) return;
    Alert.alert('Missed Check-in', 'Alert your contacts and guardian that you missed your check-in?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Alert Contacts', style: 'destructive', onPress: () => {
        void handleMissedCheckIn(activePlan.id);

        // Guardian missed check-in alert (#724) — always sent
        if (guardian) {
          const msg = generateGuardianAlertMessage({
            type: 'missed_checkin',
            matchName: activePlan.matchName,
            location: activePlan.location,
            guardianName: guardian.name,
            userName: user?.displayName ?? 'Your contact',
          });
          const logEntry: GuardianAlertLog = {
            id: `alert-${Date.now()}`,
            guardianId: guardian.phone,
            type: 'missed_checkin',
            timestamp: Date.now(),
            delivered: true,
            deliveryMethod: 'both',
            planId: activePlan.id,
          };
          setAlertHistory(prev => [...prev, logEntry]);
          logger.warn('[DateSafety] Missed check-in guardian alert:', msg.sms);
        }
      }},
    ]);
  }, [activePlan, guardian, user]);

  // Simplified report
  const handleReport = useCallback(async (value: string) => {
    if (!activePlan) return;
    const result = await submitSimplifiedReport(activePlan.matchId, value, reportNote);
    if (result.submitted) { setShowReport(false); Alert.alert('Reported', 'Thank you. We take this seriously.'); }
    else Alert.alert('Error', 'Failed to submit report');
  }, [activePlan, reportNote]);

  if (loading) return (
    <View style={styles.loadingContainer}><ActivityIndicator size="large" color="#53a8b6" /><Text style={styles.loadingText}>Loading...</Text></View>
  );

  const showCheckIn = activePlan ? shouldShowCheckIn(activePlan) : false;
  const reportOptions = getSimplifiedReportOptions();

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>🛡️ Date Safety</Text>

      {/* Guardian Setup Status (#724) */}
      {!guardianSetup.ready && (
        <View style={styles.guardianWarningCard}>
          <Text style={styles.guardianWarningTitle}>⚠️ Guardian Setup Incomplete</Text>
          {guardianSetup.issues.map((issue, i) => (
            <Text key={i} style={styles.guardianWarningText}>• {issue.replace(/_/g, ' ')}</Text>
          ))}
          {guardianSetup.recommendations.map((rec, i) => (
            <Text key={i} style={styles.guardianRecText}>💡 {rec}</Text>
          ))}
          <TouchableOpacity style={styles.guardianFixButton} onPress={() => setShowGuardianForm(true)} accessibilityLabel="Set up guardian" accessibilityRole="button">
            <Text style={styles.guardianFixText}>Set Up Guardian →</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Active Plan */}
      {activePlan && (
        <View style={styles.activeCard}>
          <Text style={styles.cardTitle}>📋 Active Date Plan</Text>
          <Text style={styles.cardRow}>👤 {activePlan.matchName}</Text>
          <Text style={styles.cardRow}>📍 {activePlan.location}</Text>
          <Text style={styles.cardRow}>🕐 {new Date(activePlan.dateTime).toLocaleString()}</Text>
          <Text style={styles.cardRow}>📱 Contact: {activePlan.trustedContactName}</Text>
          {guardian && <Text style={styles.cardRow}>👑 Guardian: {guardian.name}</Text>}

          {locationWarning && locationWarning.show && (
            <View style={[styles.warningBox, { borderColor: locationWarning.color }]}>
              <Text style={[styles.warningText, { color: locationWarning.color }]}>{locationWarning.message}</Text>
            </View>
          )}

          {safetyResult && !safetyResult.safe && (
            <View style={styles.warningBox}>
              {safetyResult.warnings.map((w, i) => <Text key={i} style={styles.warningText}>⚠️ {w}</Text>)}
            </View>
          )}

          {safetyResult && safetyResult.resources.length > 0 && (
            <View style={styles.resourcesBox}>
              <Text style={styles.resourcesTitle}>📞 Resources</Text>
              {safetyResult.resources.map((r, i) => <Text key={i} style={styles.resourceText}>{r}</Text>)}
            </View>
          )}

          <View style={styles.actionRow}>
            {showCheckIn && (
              <TouchableOpacity style={styles.checkInButton} onPress={handleCheckIn} disabled={checkingIn} accessibilityLabel="Check in safe" accessibilityRole="button">
                {checkingIn ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.checkInText}>✅ I'm Safe</Text>}
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.sosButton} onPress={handleSOS} accessibilityLabel="Emergency SOS" accessibilityRole="button">
              <Text style={styles.sosText}>🚨 SOS</Text>
            </TouchableOpacity>
          </View>

          {activePlan.status === 'planned' && (
            <TouchableOpacity style={styles.missedButton} onPress={handleMissed} accessibilityLabel="Missed check-in" accessibilityRole="button">
              <Text style={styles.missedText}>⚠️ I Missed My Check-in</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity style={styles.reportButton} onPress={() => setShowReport(!showReport)} accessibilityLabel="Report this person" accessibilityRole="button">
            <Text style={styles.reportButtonText}>🚩 Report</Text>
          </TouchableOpacity>

          {showReport && (
            <View style={styles.reportPanel}>
              <Text style={styles.reportTitle}>What happened?</Text>
              {reportOptions.map(opt => (
                <TouchableOpacity key={opt.value} style={styles.reportOption} onPress={() => { void handleReport(opt.value); }} accessibilityLabel={opt.label} accessibilityRole="button">
                  <Text style={styles.reportOptionIcon}>{opt.icon}</Text>
                  <View style={styles.reportOptionText}>
                    <Text style={styles.reportOptionLabel}>{opt.label}</Text>
                    <Text style={styles.reportOptionDesc}>{opt.description}</Text>
                  </View>
                </TouchableOpacity>
              ))}
              <TextInput style={styles.reportNote} placeholder="Additional details (optional)" placeholderTextColor="#666" value={reportNote} onChangeText={setReportNote} multiline maxLength={500} accessibilityLabel="Additional report details" />
            </View>
          )}
        </View>
      )}

      {/* Create Plan */}
      {!activePlan && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>📅 Create Date Plan</Text>
          <Text style={styles.hint}>Tell someone you trust about your date. We'll send them the details and alert your guardian.</Text>

          <Text style={styles.label}>Match Name</Text>
          <TextInput style={styles.input} value={matchName} onChangeText={setMatchName} placeholder="Their name" placeholderTextColor="#666" accessibilityLabel="Match name" />

          <Text style={styles.label}>Location Name</Text>
          <TextInput style={styles.input} value={location} onChangeText={setLocation} placeholder="e.g. Starbucks, Central Park" placeholderTextColor="#666" accessibilityLabel="Location name" />

          <Text style={styles.label}>Address</Text>
          <TextInput style={styles.input} value={address} onChangeText={setAddress} placeholder="Full address" placeholderTextColor="#666" accessibilityLabel="Address" />

          <Text style={styles.label}>Date & Time</Text>
          <TextInput style={styles.input} value={dateTime} onChangeText={setDateTime} placeholder="2025-01-15 19:00" placeholderTextColor="#666" accessibilityLabel="Date and time" />

          <Text style={styles.label}>Duration (minutes)</Text>
          <TextInput style={styles.input} value={duration} onChangeText={setDuration} placeholder="60" placeholderTextColor="#666" keyboardType="number-pad" accessibilityLabel="Duration in minutes" />

          <TouchableOpacity style={[styles.createButton, creating && styles.disabled]} onPress={handleCreatePlan} disabled={creating} accessibilityLabel="Create date plan" accessibilityRole="button">
            {creating ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.createText}>📅 Create Plan & Notify Contacts</Text>}
          </TouchableOpacity>
        </View>
      )}

      {/* Emergency Contacts */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>📱 Trusted Contact</Text>
        {primaryContactStatus && (
          <View style={styles.alertStatusChip}>
            <Text style={styles.alertStatusText}>
              📤 {primaryContactStatus.totalAlertsSent} alerts sent • ✅ {primaryContactStatus.confirmedReceived} confirmed
            </Text>
          </View>
        )}
        <Text style={styles.label}>Name</Text>
        <TextInput style={styles.input} value={contactName} onChangeText={setContactName} placeholder="Your trusted person's name" placeholderTextColor="#666" accessibilityLabel="Contact name" />
        <Text style={styles.label}>Phone</Text>
        <TextInput style={styles.input} value={contactPhone} onChangeText={setContactPhone} placeholder="+994 50 123 4567" placeholderTextColor="#666" keyboardType="phone-pad" accessibilityLabel="Contact phone" />
        <TouchableOpacity style={styles.saveButton} onPress={handleSaveContact} accessibilityLabel="Save contact" accessibilityRole="button">
          <Text style={styles.saveText}>💾 Save Contact</Text>
        </TouchableOpacity>
        {contacts.map((c, i) => (
          <View key={i} style={styles.contactChip}>
            <Text style={styles.contactChipText}>{c.name} — {c.phone}</Text>
          </View>
        ))}
      </View>

      {/* Guardian */}
      <View style={styles.section}>
        <TouchableOpacity onPress={() => setShowGuardianForm(!showGuardianForm)} accessibilityLabel="Guardian contact settings" accessibilityRole="button">
          <Text style={styles.sectionTitle}>👑 Guardian Contact {showGuardianForm ? '▲' : '▼'}</Text>
        </TouchableOpacity>
        {showGuardianForm && (
          <View>
            <Text style={styles.hint}>A guardian receives ALL safety alerts — missed check-ins, SOS, and optionally new match notifications.</Text>
            <Text style={styles.label}>Guardian Name</Text>
            <TextInput style={styles.input} value={guardianName} onChangeText={setGuardianName} placeholder="Parent, sibling, or close friend" placeholderTextColor="#666" accessibilityLabel="Guardian name" />
            <Text style={styles.label}>Guardian Phone</Text>
            <TextInput style={styles.input} value={guardianPhone} onChangeText={setGuardianPhone} placeholder="+994 50 123 4567" placeholderTextColor="#666" keyboardType="phone-pad" accessibilityLabel="Guardian phone" />
            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>Notify on new matches</Text>
              <Switch value={guardianNotifyOnMatch} onValueChange={setGuardianNotifyOnMatch} accessibilityLabel="Notify guardian on new matches" />
            </View>

            {/* Alert Configuration (#724) */}
            <TouchableOpacity style={styles.alertConfigToggle} onPress={() => setShowAlertConfig(!showAlertConfig)} accessibilityLabel="Alert configuration" accessibilityRole="button">
              <Text style={styles.alertConfigToggleText}>🔔 Alert Settings {showAlertConfig ? '▲' : '▼'}</Text>
            </TouchableOpacity>
            {showAlertConfig && (
              <View style={styles.alertConfigPanel}>
                <View style={styles.switchRow}>
                  <Text style={styles.switchLabel}>Alert on plan creation</Text>
                  <Switch value={alertConfig.alertOnPlanCreation} onValueChange={v => setAlertConfig(p => ({ ...p, alertOnPlanCreation: v }))} accessibilityLabel="Alert on plan creation" />
                </View>
                <View style={styles.switchRow}>
                  <Text style={styles.switchLabel}>Alert on check-in</Text>
                  <Switch value={alertConfig.alertOnCheckIn} onValueChange={v => setAlertConfig(p => ({ ...p, alertOnCheckIn: v }))} accessibilityLabel="Alert on check-in" />
                </View>
                <View style={styles.switchRow}>
                  <Text style={styles.switchLabel}>Alert on missed check-in</Text>
                  <Switch value={alertConfig.alertOnMissedCheckIn} onValueChange={v => setAlertConfig(p => ({ ...p, alertOnMissedCheckIn: v }))} accessibilityLabel="Alert on missed check-in" />
                </View>
                <View style={styles.switchRow}>
                  <Text style={styles.switchLabel}>Alert on SOS (always on)</Text>
                  <Switch value={true} disabled accessibilityLabel="SOS alerts always on" />
                </View>
                <View style={styles.switchRow}>
                  <Text style={styles.switchLabel}>Alert on new match</Text>
                  <Switch value={alertConfig.alertOnNewMatch} onValueChange={v => setAlertConfig(p => ({ ...p, alertOnNewMatch: v }))} accessibilityLabel="Alert on new match" />
                </View>
                <View style={styles.switchRow}>
                  <Text style={styles.switchLabel}>Alert on location share</Text>
                  <Switch value={alertConfig.alertOnLocationShare} onValueChange={v => setAlertConfig(p => ({ ...p, alertOnLocationShare: v }))} accessibilityLabel="Alert on location share" />
                </View>
              </View>
            )}

            <TouchableOpacity style={styles.saveButton} onPress={handleSaveGuardian} accessibilityLabel="Save guardian" accessibilityRole="button">
              <Text style={styles.saveText}>👑 Save Guardian</Text>
            </TouchableOpacity>
            {guardian && <Text style={styles.currentGuardian}>Current: {guardian.name} ({guardian.phone})</Text>}
          </View>
        )}
      </View>

      {/* Alert History (#724) */}
      {alertHistory.length > 0 && (
        <View style={styles.section}>
          <TouchableOpacity onPress={() => setShowAlertHistory(!showAlertHistory)} accessibilityLabel="Alert history" accessibilityRole="button">
            <Text style={styles.sectionTitle}>📜 Alert History ({alertHistory.length}) {showAlertHistory ? '▲' : '▼'}</Text>
          </TouchableOpacity>
          {showAlertHistory && (
            <View>
              {alertHistory.slice().reverse().map((alert, i) => (
                <View key={i} style={styles.alertHistoryItem}>
                  <Text style={styles.alertHistoryType}>
                    {alert.type === 'sos' ? '🚨' : alert.type === 'missed_checkin' ? '⚠️' : alert.type === 'check_in' ? '✅' : alert.type === 'plan_created' ? '📅' : '📍'} {alert.type.replace(/_/g, ' ')}
                  </Text>
                  <Text style={styles.alertHistoryTime}>{new Date(alert.timestamp).toLocaleString()}</Text>
                  <Text style={styles.alertHistoryDelivery}>{alert.delivered ? '✓ Delivered' : '✗ Failed'} via {alert.deliveryMethod}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      )}

      {/* Quick Actions */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>⚡ Quick Actions</Text>
        <TouchableOpacity style={styles.quickButton} onPress={() => Linking.openURL('tel:112')} accessibilityLabel="Call emergency services" accessibilityRole="button">
          <Text style={styles.quickText}>📞 Call 112 (Emergency)</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.quickButton} onPress={() => Linking.openURL('tel:988')} accessibilityLabel="Call crisis helpline" accessibilityRole="button">
          <Text style={styles.quickText}>🧠 Call 988 (Crisis Helpline)</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.quickButton} onPress={() => { void handleSOS(); }} accessibilityLabel="Trigger SOS alert" accessibilityRole="button">
          <Text style={styles.quickText}>🚨 Trigger SOS Alert</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.backButton} onPress={() => router.back()} accessibilityLabel="Go back" accessibilityRole="button">
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  content: { padding: 20, paddingBottom: 60 },
  loadingContainer: { flex: 1, backgroundColor: '#1a1a2e', justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: '#aaa', marginTop: 12, fontSize: 16 },
  title: { fontSize: 28, fontWeight: 'bold', color: '#eee', textAlign: 'center', marginTop: 20, marginBottom: 25 },
  section: { marginBottom: 30 },
  sectionTitle: { fontSize: 18, fontWeight: 'bold', color: '#53a8b6', marginBottom: 10 },
  hint: { fontSize: 12, color: '#888', marginBottom: 10, fontStyle: 'italic', lineHeight: 18 },
  label: { fontSize: 14, color: '#ccc', marginBottom: 6, marginTop: 10 },
  input: { backgroundColor: '#16213e', color: '#fff', padding: 14, borderRadius: 10, fontSize: 16 },

  activeCard: { backgroundColor: '#16213e', borderRadius: 15, padding: 20, marginBottom: 25, borderWidth: 1, borderColor: '#0f3460' },
  cardTitle: { fontSize: 16, fontWeight: '600', color: '#eee', marginBottom: 12 },
  cardRow: { color: '#ccc', fontSize: 14, marginBottom: 6 },
  warningBox: { backgroundColor: 'rgba(230,126,34,0.1)', borderRadius: 10, padding: 12, marginTop: 10, borderWidth: 1, borderColor: '#e67e22' },
  warningText: { color: '#e67e22', fontSize: 13, lineHeight: 18 },
  resourcesBox: { backgroundColor: 'rgba(46,204,113,0.1)', borderRadius: 10, padding: 12, marginTop: 10 },
  resourcesTitle: { color: '#2ecc71', fontSize: 14, fontWeight: '600', marginBottom: 6 },
  resourceText: { color: '#aaa', fontSize: 12, lineHeight: 18 },
  actionRow: { flexDirection: 'row', gap: 10, marginTop: 15 },
  checkInButton: { flex: 1, backgroundColor: '#27ae60', paddingVertical: 14, borderRadius: 20, alignItems: 'center' },
  checkInText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  sosButton: { backgroundColor: '#d9534f', paddingVertical: 14, paddingHorizontal: 24, borderRadius: 20, alignItems: 'center' },
  sosText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  missedButton: { backgroundColor: 'rgba(230,126,34,0.2)', paddingVertical: 12, borderRadius: 15, alignItems: 'center', marginTop: 10, borderWidth: 1, borderColor: '#e67e22' },
  missedText: { color: '#e67e22', fontSize: 14, fontWeight: '600' },
  reportButton: { marginTop: 10, paddingVertical: 10, alignItems: 'center' },
  reportButtonText: { color: '#d9534f', fontSize: 14, fontWeight: '600' },
  reportPanel: { backgroundColor: '#0f3460', borderRadius: 12, padding: 15, marginTop: 8 },
  reportTitle: { color: '#eee', fontSize: 16, fontWeight: '600', marginBottom: 12 },
  reportOption: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#16213e', borderRadius: 10, padding: 12, marginBottom: 8 },
  reportOptionIcon: { fontSize: 24, marginRight: 12 },
  reportOptionText: { flex: 1 },
  reportOptionLabel: { color: '#eee', fontSize: 14, fontWeight: '500' },
  reportOptionDesc: { color: '#888', fontSize: 11, marginTop: 2 },
  reportNote: { backgroundColor: '#16213e', color: '#fff', padding: 12, borderRadius: 10, fontSize: 14, height: 60, textAlignVertical: 'top', marginTop: 8 },

  createButton: { backgroundColor: '#53a8b6', paddingVertical: 16, borderRadius: 25, alignItems: 'center', marginTop: 15 },
  createText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  disabled: { opacity: 0.5 },
  saveButton: { backgroundColor: '#0f3460', paddingVertical: 12, borderRadius: 15, alignItems: 'center', marginTop: 10 },
  saveText: { color: '#53a8b6', fontSize: 14, fontWeight: '600' },
  contactChip: { backgroundColor: '#0f3460', paddingVertical: 8, paddingHorizontal: 14, borderRadius: 15, marginTop: 8, alignSelf: 'flex-start' },
  contactChipText: { color: '#53a8b6', fontSize: 13 },

  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 },
  switchLabel: { color: '#ccc', fontSize: 14, flex: 1, marginRight: 10 },
  currentGuardian: { color: '#5cb85c', fontSize: 12, marginTop: 8, fontStyle: 'italic' },

  // Guardian warning (#724)
  guardianWarningCard: { backgroundColor: 'rgba(230,126,34,0.15)', borderRadius: 12, padding: 16, marginBottom: 20, borderWidth: 1, borderColor: '#e67e22' },
  guardianWarningTitle: { color: '#e67e22', fontSize: 16, fontWeight: '700', marginBottom: 8 },
  guardianWarningText: { color: '#e67e22', fontSize: 13, marginBottom: 3, opacity: 0.9 },
  guardianRecText: { color: '#f0c040', fontSize: 12, marginBottom: 3 },
  guardianFixButton: { backgroundColor: '#e67e22', paddingVertical: 10, borderRadius: 12, alignItems: 'center', marginTop: 10 },
  guardianFixText: { color: '#fff', fontSize: 14, fontWeight: '600' },

  // Alert config (#724)
  alertConfigToggle: { marginTop: 10, paddingVertical: 8 },
  alertConfigToggleText: { color: '#53a8b6', fontSize: 14, fontWeight: '500' },
  alertConfigPanel: { backgroundColor: '#0f3460', borderRadius: 10, padding: 12, marginTop: 6 },

  // Alert status (#724)
  alertStatusChip: { backgroundColor: '#0f3460', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 10, marginBottom: 8, alignSelf: 'flex-start' },
  alertStatusText: { color: '#53a8b6', fontSize: 11 },

  // Alert history (#724)
  alertHistoryItem: { backgroundColor: '#16213e', borderRadius: 8, padding: 10, marginBottom: 6 },
  alertHistoryType: { color: '#eee', fontSize: 13, fontWeight: '500' },
  alertHistoryTime: { color: '#888', fontSize: 11, marginTop: 2 },
  alertHistoryDelivery: { color: '#666', fontSize: 11, marginTop: 1 },

  quickButton: { backgroundColor: '#16213e', paddingVertical: 14, borderRadius: 12, alignItems: 'center', marginBottom: 8, borderWidth: 1, borderColor: '#0f3460' },
  quickText: { color: '#53a8b6', fontSize: 15, fontWeight: '500' },
  backButton: { paddingVertical: 14, alignItems: 'center', marginTop: 20 },
  backText: { color: '#d9534f', fontSize: 16 },
});