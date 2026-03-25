/**
 * LegalDocument
 *
 * Reusable shell for legal / policy screens (Terms of Service, Privacy
 * Policy, etc.). Accepts a data-driven content array so individual screens
 * contain zero layout or styling code.
 */

import { useRouter } from 'expo-router';
import React, { useCallback, useRef } from 'react';
import {
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
} as const;

const HIT_SLOP = { top: 12, bottom: 12, left: 12, right: 12 } as const;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isBulletGroup(value: string | BulletGroup): value is BulletGroup {
  return typeof value !== 'string' && 'items' in value;
}

// ─── Sub-components ──────────────────────────────────────────────────────────

const BulletList = React.memo(function BulletList({
  group,
}: {
  group: BulletGroup;
}) {
  return (
    <View style={styles.bulletGroup}>
      {group.heading ? (
        <Text style={styles.subTitle}>{group.heading}</Text>
      ) : null}

      {group.items.map((item, i) => (
        <View key={i} style={styles.bulletRow}>
          <Text style={styles.bullet}>•</Text>
          <Text style={styles.bulletText}>{item}</Text>
        </View>
      ))}

      {group.footer ? (
        <Text style={[styles.paragraph, styles.bulletFooter]}>
          {group.footer}
        </Text>
      ) : null}
    </View>
  );
});

const Section = React.memo(function Section({
  section,
}: {
  section: LegalSection;
}) {
  return (
    <View style={styles.section} accessibilityRole="summary">
      <Text style={styles.sectionTitle}>{section.title}</Text>

      {section.paragraphs.map((block, i) =>
        isBulletGroup(block) ? (
          <BulletList key={i} group={block} />
        ) : (
          <Text key={i} style={styles.paragraph}>
            {block}
          </Text>
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