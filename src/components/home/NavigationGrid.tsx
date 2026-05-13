import { prepare, layout } from '@chenglou/pretext';
import type { LegendListRenderItemProps } from '@legendapp/list';
import { LegendList } from '@legendapp/list';
import React, { useCallback, useMemo } from 'react';
import { Dimensions, Platform, Text, TouchableOpacity, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { StyleSheet } from 'react-native-unistyles';
import type { AppRoute, NavItem } from './types';
import { MAX_FONT_SCALE } from './types';

// ─── Pretext height cache ─────────────────────────────────────────────────────

const NAV_FONT          = '18px Inter';
const NAV_LINE_H        = 24;
const NAV_BTN_V_PADDING = 32;
const NAV_BTN_MIN_H     = 48;

const navPrepareCache = new Map<string, ReturnType<typeof prepare>>();

function getNavPrepared(label: string): ReturnType<typeof prepare> {
  const hit = navPrepareCache.get(label);
  if (hit) return hit;
  const result = prepare(label, NAV_FONT);
  navPrepareCache.set(label, result);
  return result;
}

export function buildNavHeightCache(
  items: NavItem[],
  screenWidth: number,
): Map<string, number> {
  const cache  = new Map<string, number>();
  const isWide = screenWidth >= 600;
  const baseW  = screenWidth - 64;
  const btnW   = isWide ? baseW * 0.48 : baseW;
  const textW  = btnW - 20;

  for (const item of items) {
    const prepared = getNavPrepared(item.label);
    const result   = layout(prepared, textW, NAV_LINE_H);
    const totalH   = Math.max(NAV_BTN_MIN_H, result.height + NAV_BTN_V_PADDING);
    cache.set(item.key, totalH);
  }
  cache.set('__logout__', NAV_BTN_MIN_H + NAV_BTN_V_PADDING);
  return cache;
}

// ─── NavItemRenderer ──────────────────────────────────────────────────────────

interface NavItemRendererProps {
  item: NavItem;
  onNav: (r: AppRoute) => void;
  reducedMotion: boolean;
  index: number;
  isWide: boolean;
}

const NavItemRenderer = React.memo(function NavItemRenderer({
  item, onNav, reducedMotion, index, isWide,
}: NavItemRendererProps) {
  const widthStyle  = isWide ? styles.btnWide : styles.btnFull;
  const cleanLabel  = item.label.replace(/^\S+\s/, '');
  const handlePress = useCallback(() => onNav(item.route), [onNav, item.route]);

  const btnStyle = useMemo(() => [
    styles.btn,
    widthStyle,
    styles[`btn_${item.colorKey}` as keyof typeof styles] as object,
    item.isBordered ? styles.btnBordered : undefined,
  ], [widthStyle, item.colorKey, item.isBordered]);

  const btn = (
    <TouchableOpacity
      style={btnStyle}
      onPress={handlePress}
      activeOpacity={0.8}
      accessibilityRole="menuitem"
      accessibilityLabel={item.badge ? `${cleanLabel}, ${item.badge} notifications` : cleanLabel}
      accessibilityHint={item.a11yHint ?? `Double tap to open ${cleanLabel}`}
    >
      <Text style={styles.btnText} maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityElementsHidden>
        {item.label}
      </Text>
      {!!item.badge && (
        <View style={styles.badge} accessibilityElementsHidden>
          <Text style={styles.badgeText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            {item.badge}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );

  if (!reducedMotion && Platform.OS !== 'web') {
    return <Animated.View entering={FadeInDown.delay(index * 60).duration(350)}>{btn}</Animated.View>;
  }
  return btn;
});

// ─── LogoutButton ─────────────────────────────────────────────────────────────

interface LogoutButtonProps {
  onLogout: () => void;
  loggingOut: boolean;
  reducedMotion: boolean;
  index: number;
  isWide: boolean;
}

const LogoutButton = React.memo(function LogoutButton({
  onLogout, loggingOut, reducedMotion, index, isWide,
}: LogoutButtonProps) {
  const widthStyle = isWide ? styles.btnWide : styles.btnFull;
  const btnStyle   = useMemo(() => [styles.logoutBtn, widthStyle], [widthStyle]);

  const btn = (
    <TouchableOpacity
      style={btnStyle}
      onPress={onLogout}
      activeOpacity={0.8}
      disabled={loggingOut}
      accessibilityRole="button"
      accessibilityLabel={loggingOut ? 'Logging out' : 'Log out'}
      accessibilityHint="Double tap to sign out"
      accessibilityState={{ disabled: loggingOut, busy: loggingOut }}
    >
      <Text style={styles.logoutText} maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityElementsHidden>
        {loggingOut ? '⏳ Logging out…' : '🚪 Log Out'}
      </Text>
    </TouchableOpacity>
  );

  if (!reducedMotion && Platform.OS !== 'web') {
    return <Animated.View entering={FadeInDown.delay(index * 60).duration(350)}>{btn}</Animated.View>;
  }
  return btn;
});

// ─── NavigationGrid ───────────────────────────────────────────────────────────

type NavListItem = NavItem | { key: '__logout__' };

interface NavigationGridProps {
  navItems: NavItem[];
  onNav: (r: AppRoute) => void;
  onLogout: () => void;
  loggingOut: boolean;
  reducedMotion: boolean;
  screenWidth: number;
  startIndex: number;
  heightCache: Map<string, number>;
}

export const NavigationGrid = React.memo(function NavigationGrid({
  navItems, onNav, onLogout, loggingOut, reducedMotion, screenWidth, startIndex, heightCache,
}: NavigationGridProps) {
  const isWide     = screenWidth >= 600;
  const numColumns = isWide ? 2 : 1;
  const listData   = useMemo<NavListItem[]>(() => [...navItems, { key: '__logout__' }], [navItems]);

  const getEstimatedItemSize = useCallback(
    (item: NavListItem) => heightCache.get(item.key) ?? 80,
    [heightCache],
  );

  const keyExtractor = useCallback((item: NavListItem) => item.key, []);

  const renderItem = useCallback(({ item, index }: LegendListRenderItemProps<NavListItem>) => {
    if (item.key === '__logout__') {
      return (
        <LogoutButton
          onLogout={onLogout} loggingOut={loggingOut}
          reducedMotion={reducedMotion} index={startIndex + index} isWide={isWide}
        />
      );
    }
    return (
      <NavItemRenderer
        item={item as NavItem} onNav={onNav}
        reducedMotion={reducedMotion} index={startIndex + index} isWide={isWide}
      />
    );
  }, [onNav, onLogout, loggingOut, reducedMotion, startIndex, isWide]);

  return (
    <LegendList
      data={listData}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      numColumns={numColumns}
      key={numColumns}
      recycleItems={true}
      estimatedItemSize={80}
      getEstimatedItemSize={getEstimatedItemSize}
      scrollEnabled={false}
      contentContainerStyle={gridStyles.content}
      columnWrapperStyle={isWide ? gridStyles.columnWrapper : undefined}
      accessibilityRole="menu"
      accessibilityLabel="Navigation menu"
      removeClippedSubviews={false}
    />
  );
});

const styles = StyleSheet.create((theme) => ({
  btn: {
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center',
    paddingVertical: theme.spacing.lg, borderRadius: theme.radius.xl,
    gap: 10, minHeight: 48,
  },
  btnWide:     { width: '48%' as const },
  btnFull:     { width: '100%' as const },
  btn_success: { backgroundColor: theme.colors.success },
  btn_primary: { backgroundColor: theme.colors.primary },
  btn_purple:  { backgroundColor: theme.colors.purple },
  btn_orange:  { backgroundColor: theme.colors.orange },
  btn_blue:    { backgroundColor: theme.colors.blue },
  btn_teal:    { backgroundColor: theme.colors.teal },
  btn_red:     { backgroundColor: theme.colors.red },
  btn_gold:    { backgroundColor: theme.colors.gold },
  btn_dim:     { backgroundColor: theme.colors.textSecondary },
  btnBordered: { borderWidth: 2, borderColor: theme.colors.gold },
  btnText:     { fontSize: 18, fontWeight: '600', color: theme.colors.white },
  badge: {
    borderRadius: theme.radius.md, paddingHorizontal: theme.spacing.sm,
    paddingVertical: 2, backgroundColor: theme.colors.background,
  },
  badgeText: { fontSize: 12, fontWeight: 'bold', color: theme.colors.gold },
  logoutBtn: {
    backgroundColor: 'transparent', borderWidth: 2,
    paddingVertical: theme.spacing.lg, borderRadius: theme.radius.xl,
    alignItems: 'center', marginTop: 10, minHeight: 48, borderColor: theme.colors.danger,
  },
  logoutText: { fontSize: 18, fontWeight: '600', color: theme.colors.danger },
}));

const gridStyles = StyleSheet.create((theme) => ({
  content:       { gap: 10, paddingTop: theme.spacing.lg, width: '100%' },
  columnWrapper: { justifyContent: 'space-between' },
}));