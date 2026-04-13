/**
 * LegalDocument
 *
 * Reusable shell for legal / policy screens (Terms of Service, Privacy
 * Policy, etc.). Accepts a data-driven content array so individual screens
 * contain zero layout or styling code.
 *
 * Features:
 *  - Auto-detects URLs in text and makes them tappable
 *  - Renders empty strings as clean spacers
 *  - Bullet groups with optional heading / footer
 */

import { useRouter } from 'expo-router';
import React, { useCallback, useRef } from 'react';
import {
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface LegalSection {
  readonly title: string;
  readonly paragraphs: readonly (string | BulletGroup)[];
}

export interface BulletGroup {
  readonly heading?: string;
  readonly items: readonly string[];
  readonly footer?: string;
}

export interface LegalDocumentProps {
  readonly title: string;
  readonly lastUpdated: string;
  readonly sections: readonly LegalSection[];
  readonly footerText: string;
}

// ─── Design tokens ───────────────────────────────────────────────────────────

const Colors = {
  background: '#1a1a2e',
  surface: '#16213e',
  accent: '#53a8b6',
  textPrimary: '#eeeeee',
  textBody: '#cccccc',
  textMuted: '#888888',
  link: '#6bc5d4',
} as const;

const HIT_SLOP = { top: 12, bottom: 12, left: 12, right: 12 } as const;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isBulletGroup(value: string | BulletGroup): value is BulletGroup {
  return typeof value !== 'string' && 'items' in value;
}

/** Matches http:// or https:// URLs inside a string. */
const URL_REGEX = /(https?:\/\/[^\s,\.)]+)/g;

/**
 * Splits a string into text segments and URL segments so URLs can be
 * rendered as tappable links while preserving surrounding text.
 */
function parseSegments(text: string): readonly { readonly url?: string; readonly value: string }[] {
  const segments: { url?: string; value: string }[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(URL_REGEX)) {
    const index = match.index!;
    if (index > lastIndex) {
      segments.push({ value: text.slice(lastIndex, index) });
    }
    segments.push({ url: match[0], value: match[0] });
    lastIndex = index + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push({ value: text.slice(lastIndex) });
  }

  return segments;
}

// ─── Sub-components ──────────────────────────────────────────────────────────

/**
 * Renders a string that may contain URLs as tappable links.
 * Falls back to a plain <Text> when no URLs are present (fast path).
 */
const RichText = React.memo(function RichText({
  text,
  style,
}: {
  readonly text: string;
  readonly style: unknown;
}) {
  const segments = parseSegments(text);

  // Fast path — no URLs, just render plain text.
  if (segments.length <= 1 && !segments[0]?.url) {
    return <Text style={style as any}>{text}</Text>;
  }

  return (
    <Text style={style as any}>
      {segments.map((seg, i) =>
        seg.url ? (
          <Text
            key={i}
            style={styles.link}
            onPress={() => Linking.openURL(seg.url!)}
            accessibilityRole="link"
            accessibilityHint={`Open ${seg.url}`}
          >
            {seg.value}
          </Text>
        ) : (
          <Text key={i}>{seg.value}</Text>
        ),
      )}
    </Text>
  );
});

const BulletList = React.memo(function BulletList({
  group,
}: {
  readonly group: BulletGroup;
}) {
  return (
    <View style={styles.bulletGroup}>
      {group.heading ? (
        <Text style={styles.subTitle}>{group.heading}</Text>
      ) : null}

      {group.items.map((item, i) => (
        <View key={i} style={styles.bulletRow}>
          <Text style={styles.bullet}>•</Text>
          <RichText text={item} style={styles.bulletText} />
        </View>
      ))}

      {group.footer ? (
        <RichText text={group.footer} style={[styles.paragraph, styles.bulletFooter]} />
      ) : null}
    </View>
  );
});

const Section = React.memo(function Section({
  section,
}: {
  readonly section: LegalSection;
}) {
  return (
    <View style={styles.section} accessibilityRole="summary">
      <Text style={styles.sectionTitle}>{section.title}</Text>

      {section.paragraphs.map((block, i) =>
        block === '' ? (
          // Empty string → clean vertical spacer
          <View key={i} style={styles.spacer} />
        ) : isBulletGroup(block) ? (
          <BulletList key={i} group={block} />
        ) : (
          <RichText key={i} text={block} style={styles.paragraph} />
        ),
      )}
    </View>
  );
});

// ─── Component ───────────────────────────────────────────────────────────────

export default function LegalDocument({
  title,
  lastUpdated,
  sections,
  footerText,
}: LegalDocumentProps) {
  const router = useRouter();
  const scrollRef = useRef<ScrollView>(null);

  const handleBack = useCallback(() => {
    router.back();
  }, [router]);

  const scrollToTop = useCallback(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  }, []);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={handleBack}
          hitSlop={HIT_SLOP}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
      </View>

      {/* Body */}
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator
      >
        <Text style={styles.title} accessibilityRole="header">
          {title}
        </Text>
        <Text style={styles.lastUpdated}>Last Updated: {lastUpdated}</Text>

        {sections.map((section, i) => (
          <Section key={i} section={section} />
        ))}

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>{footerText}</Text>
        </View>

        {/* Scroll-to-top */}
        <TouchableOpacity
          style={styles.topButton}
          onPress={scrollToTop}
          hitSlop={HIT_SLOP}
          accessibilityRole="button"
          accessibilityLabel="Scroll to top"
        >
          <Text style={styles.topButtonText}>↑ Back to top</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  backText: {
    color: Colors.accent,
    fontSize: 16,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: Colors.textPrimary,
    marginBottom: 10,
  },
  lastUpdated: {
    color: Colors.textMuted,
    fontSize: 14,
    marginBottom: 30,
  },
  section: {
    marginBottom: 25,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: Colors.accent,
    marginBottom: 10,
  },
  subTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.textPrimary,
    marginTop: 10,
    marginBottom: 5,
  },
  paragraph: {
    color: Colors.textBody,
    fontSize: 14,
    lineHeight: 22,
    marginBottom: 6,
  },
  spacer: {
    height: 10,
  },
  bulletGroup: {
    marginTop: 4,
  },
  bulletRow: {
    flexDirection: 'row',
    paddingLeft: 4,
    marginBottom: 4,
  },
  bullet: {
    color: Colors.accent,
    fontSize: 14,
    lineHeight: 22,
    marginRight: 8,
  },
  bulletText: {
    color: Colors.textBody,
    fontSize: 14,
    lineHeight: 22,
    flex: 1,
  },
  bulletFooter: {
    marginTop: 8,
  },
  link: {
    color: Colors.link,
    textDecorationLine: 'underline',
  },
  footer: {
    marginTop: 30,
    padding: 20,
    backgroundColor: Colors.surface,
    borderRadius: 15,
    alignItems: 'center',
  },
  footerText: {
    color: Colors.textMuted,
    fontSize: 13,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  topButton: {
    alignSelf: 'center',
    marginTop: 20,
    paddingVertical: 12,
  },
  topButtonText: {
    color: Colors.accent,
    fontSize: 14,
  },
});