import type { LegendListRenderItemProps } from '@legendapp/list';
import { LegendList } from '@legendapp/list';
import { useRouter } from 'expo-router';
import { collection, doc, getDoc, getDocs, query, where, writeBatch } from 'firebase/firestore';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, RefreshControl, Text, TouchableOpacity, View } from 'react-native';
import TurboImage from '../../src/components/TurboImage';
import { StyleSheet } from 'react-native-unistyles';
import { auth, db } from '../../firebaseConfig';
import { logger, writeAuditLog } from '../../utils/logger';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Report {
  id:                string;
  reporterId:        string;
  reporterName?:     string;
  reportedUserId:    string;
  reportedUserName:  string;
  reportedUserPhoto?: string;
  reason:            string;
  createdAt:         string;
  status:            string;
}

type Resolution = 'dismissed' | 'warned' | 'banned';
type FilterType  = 'pending' | 'resolved' | 'all';

const RESOLUTION_CONFIG: Record<Resolution, { title: string; msg: (n: string) => string; btn: string }> = {
  dismissed: { title: 'Dismiss Report', msg: () => 'Mark as resolved with no action?',   btn: 'Dismiss' },
  warned:    { title: 'Warn User',       msg: (n) => `Send warning to ${n}?`,             btn: 'Warn'    },
  banned:    { title: 'Ban User',        msg: (n) => `BAN ${n}? This cannot be undone.`, btn: 'Ban'     },
};

const formatDate = (d: string) => {
  const dt = new Date(d);
  return `${dt.toLocaleDateString()} ${dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
};

// ─── Report card sub-component ────────────────────────────────────────────────

interface ReportCardProps {
  item:      Report;
  onConfirm: (report: Report, resolution: Resolution) => void;
}

const ReportCard = React.memo<ReportCardProps>(({ item, onConfirm }) => {
  const cardStyle  = useMemo(
    () => [styles.reportCard, item.status === 'pending' && styles.reportCardPending],
    [item.status],
  );
  const badgeStyle = useMemo(
    () => [styles.statusBadge, item.status === 'pending' ? styles.statusPending : styles.statusResolved],
    [item.status],
  );

  const handleDismiss = useCallback(() => onConfirm(item, 'dismissed'), [onConfirm, item]);
  const handleWarn    = useCallback(() => onConfirm(item, 'warned'),    [onConfirm, item]);
  const handleBan     = useCallback(() => onConfirm(item, 'banned'),    [onConfirm, item]);

  return (
    <View
      style={cardStyle}
      accessibilityLabel={`Report: ${item.reportedUserName} by ${item.reporterName ?? 'Unknown'}, ${item.status}`}
    >
      <View style={styles.reportHeader}>
        {item.reportedUserPhoto ? (
          <TurboImage
            source={{ uri: item.reportedUserPhoto }}
            style={styles.reportPhoto}
            cachePolicy="dataCache"
            accessibilityLabel={`Photo of ${item.reportedUserName}`}
          />
        ) : (
          <View
            style={styles.reportPhotoPlaceholder}
            accessibilityLabel={`No photo for ${item.reportedUserName}`}
          >
            <Text style={styles.reportPhotoText}>?</Text>
          </View>
        )}
        <View style={styles.reportInfo}>
          <Text style={styles.reportedName}  maxFontSizeMultiplier={1.1}>{item.reportedUserName}</Text>
          <Text style={styles.reporterText}  maxFontSizeMultiplier={1.1}>Reported by: {item.reporterName}</Text>
          <Text style={styles.reportDate}    maxFontSizeMultiplier={1.1}>{formatDate(item.createdAt)}</Text>
        </View>
        <View style={badgeStyle}>
          <Text style={styles.statusText} maxFontSizeMultiplier={1.1}>{item.status}</Text>
        </View>
      </View>

      <View style={styles.reasonContainer}>
        <Text style={styles.reasonLabel} maxFontSizeMultiplier={1.1}>Reason:</Text>
        <Text style={styles.reasonText}  maxFontSizeMultiplier={1.1}>{item.reason}</Text>
      </View>

      {item.status === 'pending' && (
        <View style={styles.reportActions}>
          <TouchableOpacity
            style={styles.dismissButton}
            onPress={handleDismiss}
            hitSlop={12}
            accessibilityLabel={`Dismiss ${item.reportedUserName}`}
            accessibilityRole="button"
          >
            <Text style={styles.dismissButtonText} maxFontSizeMultiplier={1.1}>Dismiss</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.warnButton}
            onPress={handleWarn}
            hitSlop={12}
            accessibilityLabel={`Warn ${item.reportedUserName}`}
            accessibilityRole="button"
          >
            <Text style={styles.warnButtonText} maxFontSizeMultiplier={1.1}>Warn</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.banButton}
            onPress={handleBan}
            hitSlop={12}
            accessibilityLabel={`Ban ${item.reportedUserName}`}
            accessibilityRole="button"
          >
            <Text style={styles.banButtonText} maxFontSizeMultiplier={1.1}>Ban</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
});
ReportCard.displayName = 'ReportCard';

// ─── Filter tab sub-component ─────────────────────────────────────────────────

interface FilterTabProps {
  label:   string;
  value:   FilterType;
  current: FilterType;
  onPress: (f: FilterType) => void;
}

const FilterTab = React.memo<FilterTabProps>(({ label, value, current, onPress }) => {
  const isActive  = current === value;
  const tabStyle  = useMemo(() => [styles.filterTab,     isActive && styles.filterTabActive],     [isActive]);
  const textStyle = useMemo(() => [styles.filterTabText, isActive && styles.filterTabTextActive], [isActive]);
  const handlePress = useCallback(() => onPress(value), [onPress, value]);

  return (
    <TouchableOpacity
      style={tabStyle}
      onPress={handlePress}
      hitSlop={12}
      accessibilityLabel={`Filter by ${label}`}
      accessibilityRole="tab"
      accessibilityState={{ selected: isActive }}
    >
      <Text style={textStyle} maxFontSizeMultiplier={1.1}>{label}</Text>
    </TouchableOpacity>
  );
});
FilterTab.displayName = 'FilterTab';

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function AdminReportsScreen() {
  const router    = useRouter();
  const isMounted = useRef(true);

  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isAdmin,    setIsAdmin]    = useState(false);
  const [reports,    setReports]    = useState<Report[]>([]);
  const [filter,     setFilter]     = useState<FilterType>('pending');

  useEffect(() => () => { isMounted.current = false; }, []);

  // ── Admin check ─────────────────────────────────────────────────────────────

  const checkAdmin = useCallback(async () => {
    try {
      const u = auth.currentUser;
      if (!u) { router.replace('/login'); return; }
      const snap = await getDoc(doc(db, 'users', u.uid));
      if (!snap.exists() || !(snap.data().isAdmin as boolean | undefined)) {
        router.replace('/home');
        return;
      }
      setIsAdmin(true);
    } catch (e) {
      logger.error('[AdminReports] admin check failed:', e);
      router.replace('/home');
    }
  }, [router]);

  useEffect(() => { void checkAdmin(); }, [checkAdmin]);

  // ── Load reports ────────────────────────────────────────────────────────────

  const loadReports = useCallback(async () => {
    try {
      const q = filter === 'all'
        ? query(collection(db, 'reports'))
        : query(collection(db, 'reports'), where('status', '==', filter));
      const snap = await getDocs(q);

      const userIds = [...new Set(
        snap.docs.map(d => d.data().reporterId        as string)
          .concat(snap.docs.map(d => d.data().reportedUserId as string)),
      )];

      const userMap: Record<string, { name?: string; photos?: string[] }> = {};
      for (let i = 0; i < userIds.length; i += 10) {
        const chunk = userIds.slice(i, i + 10);
        const res   = await getDocs(
          query(collection(db, 'users'), where('__name__', 'in', chunk)),
        );
        res.docs.forEach(d => {
          userMap[d.id] = { name: d.data().name as string, photos: d.data().photos as string[] };
        });
      }

      const raw: Report[] = snap.docs.map(docSnap => {
        const d      = docSnap.data();
        const rep    = userMap[d.reporterId    as string];
        const target = userMap[d.reportedUserId as string];
        return {
          id:                docSnap.id,
          reporterId:        String(d.reporterId        ?? ''),
          reporterName:      String(rep?.name           ?? 'Unknown'),
          reportedUserId:    String(d.reportedUserId    ?? ''),
          reportedUserName:  String(d.reportedUserName  ?? 'Unknown'),
          reportedUserPhoto: String(target?.photos?.[0] ?? ''),
          reason:            String(d.reason            ?? ''),
          createdAt:         String(d.createdAt         ?? ''),
          status:            String(d.status            ?? 'pending'),
        };
      });

      // Sort and set state — this is async, not synchronous in an effect
      raw.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      if (isMounted.current) setReports(raw);
    } catch (e) {
      logger.error('[AdminReports] loadReports error:', e);
    } finally {
      if (isMounted.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [filter]);

  useEffect(() => {
    if (isAdmin) { void loadReports(); }
  }, [filter, isAdmin, loadReports]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    void loadReports();
  }, [loadReports]);

  // ── Resolve report ──────────────────────────────────────────────────────────

  const resolveReport = useCallback(async (report: Report, resolution: Resolution) => {
    try {
      const batch = writeBatch(db);
      if (resolution === 'banned') {
        batch.update(doc(db, 'users', report.reportedUserId), {
          isBanned:   true,
          bannedAt:   new Date().toISOString(),
          bannedBy:   auth.currentUser?.uid ?? '',
          banReason:  report.reason,
        });
      } else if (resolution === 'warned') {
        const warnSnap = await getDoc(doc(db, 'users', report.reportedUserId));
        const warnings = (warnSnap.data()?.warnings as number | undefined) ?? 0;
        batch.update(doc(db, 'users', report.reportedUserId), {
          warnings:          warnings + 1,
          lastWarningAt:     new Date().toISOString(),
          lastWarningReason: report.reason,
        });
      }
      batch.update(doc(db, 'reports', report.id), {
        status:     'resolved',
        resolvedAt: new Date().toISOString(),
        resolution,
        resolvedBy: auth.currentUser?.uid ?? '',
      });
      await batch.commit();
      await writeAuditLog('admin.report_resolved', {
        reportId:   report.id,
        resolution,
        target:     report.reportedUserId,
      });
      Alert.alert(
        'Done',
        resolution === 'banned'
          ? `${report.reportedUserName} banned`
          : `Report ${resolution}`,
      );
      void loadReports();
    } catch (e) {
      logger.error(`[AdminReports] ${resolution} error:`, e);
      Alert.alert('Error', 'Failed to process report');
    }
  }, [loadReports]);

  const confirmAction = useCallback((report: Report, resolution: Resolution) => {
    const { title, msg, btn } = RESOLUTION_CONFIG[resolution];
    Alert.alert(title, msg(report.reportedUserName), [
      { text: 'Cancel', style: 'cancel' },
      { text: btn, style: 'destructive', onPress: () => void resolveReport(report, resolution) },
    ]);
  }, [resolveReport]);

  // ── List helpers ────────────────────────────────────────────────────────────

  const keyExtractor = useCallback((item: Report) => item.id, []);

  const renderItem = useCallback(
    ({ item }: LegendListRenderItemProps<Report>) => (
      <ReportCard item={item} onConfirm={confirmAction} />
    ),
    [confirmAction],
  );

  const handleSetFilter = useCallback((f: FilterType) => setFilter(f), []);

  // ── Render ──────────────────────────────────────────────────────────────────

  if (!isAdmin || loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#53a8b6" />
        <Text style={styles.loadingText} maxFontSizeMultiplier={1.1}>
          {!isAdmin ? 'Verifying admin access...' : 'Loading reports...'}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title} accessibilityRole="header" maxFontSizeMultiplier={1.1}>
        User Reports
      </Text>

      <View style={styles.filterTabs} accessibilityRole="tablist">
        {(['pending', 'resolved', 'all'] as const).map(f => (
          <FilterTab
            key={f}
            label={f.charAt(0).toUpperCase() + f.slice(1)}
            value={f}
            current={filter}
            onPress={handleSetFilter}
          />
        ))}
      </View>

      {reports.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon} accessibilityElementsHidden>✓</Text>
          <Text style={styles.emptyText} maxFontSizeMultiplier={1.1}>
            {filter === 'pending' ? 'No pending reports!' : 'No reports found'}
          </Text>
        </View>
      ) : (
        <LegendList
          data={reports}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          estimatedItemSize={180}
          recycleItems
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor="#53a8b6"
            />
          }
        />
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create((theme) => ({
  container:              { flex: 1, backgroundColor: theme.colors.background, padding: 20, paddingTop: 60 },
  loadingContainer:       { flex: 1, backgroundColor: theme.colors.background, justifyContent: 'center', alignItems: 'center' },
  loadingText:            { color: theme.colors.textSecondary, marginTop: 15, fontSize: 16 },
  title:                  { fontSize: 24, fontWeight: 'bold', color: theme.colors.text, marginBottom: 20, textAlign: 'center' },
  filterTabs:             { flexDirection: 'row', marginBottom: 20, backgroundColor: '#16213e', borderRadius: 10, padding: 5 },
  filterTab:              { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 8 },
  filterTabActive:        { backgroundColor: '#53a8b6' },
  filterTabText:          { color: theme.colors.textSecondary, fontSize: 14, fontWeight: '600' },
  filterTabTextActive:    { color: '#fff' },
  emptyContainer:         { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyIcon:              { fontSize: 60, color: '#5cb85c', marginBottom: 15 },
  emptyText:              { fontSize: 18, color: theme.colors.textSecondary },
  reportCard:             { backgroundColor: '#16213e', borderRadius: 15, padding: 15, marginBottom: 15 },
  reportCardPending:      { borderWidth: 2, borderColor: '#e74c3c' },
  reportHeader:           { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  reportPhoto:            { width: 50, height: 50, borderRadius: 25, marginRight: 12 },
  reportPhotoPlaceholder: { width: 50, height: 50, borderRadius: 25, backgroundColor: '#0f3460', justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  reportPhotoText:        { fontSize: 20, color: '#666' },
  reportInfo:             { flex: 1 },
  reportedName:           { fontSize: 16, fontWeight: 'bold', color: theme.colors.text },
  reporterText:           { fontSize: 12, color: theme.colors.textSecondary, marginTop: 2 },
  reportDate:             { fontSize: 11, color: '#666', marginTop: 2 },
  statusBadge:            { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 10 },
  statusPending:          { backgroundColor: '#e74c3c' },
  statusResolved:         { backgroundColor: '#5cb85c' },
  statusText:             { color: '#fff', fontSize: 11, fontWeight: '600', textTransform: 'capitalize' },
  reasonContainer:        { backgroundColor: '#0f3460', borderRadius: 10, padding: 12, marginBottom: 12 },
  reasonLabel:            { fontSize: 12, color: theme.colors.textSecondary, marginBottom: 5 },
  reasonText:             { fontSize: 14, color: theme.colors.text, lineHeight: 20 },
  reportActions:          { flexDirection: 'row', gap: 10 },
  dismissButton:          { flex: 1, backgroundColor: '#0f3460', paddingVertical: 10, borderRadius: 20, alignItems: 'center' },
  dismissButtonText:      { color: theme.colors.textSecondary, fontSize: 14, fontWeight: '600' },
  warnButton:             { flex: 1, backgroundColor: '#e67e22', paddingVertical: 10, borderRadius: 20, alignItems: 'center' },
  warnButtonText:         { color: '#fff', fontSize: 14, fontWeight: '600' },
  banButton:              { flex: 1, backgroundColor: '#e74c3c', paddingVertical: 10, borderRadius: 20, alignItems: 'center' },
  banButtonText:          { color: '#fff', fontSize: 14, fontWeight: '600' },
}));