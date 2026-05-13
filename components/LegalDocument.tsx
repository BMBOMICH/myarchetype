import { useRouter } from 'expo-router';
import { memo, useCallback, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import { Linking, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import type { StyleProp, TextStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native-unistyles';

const styles = StyleSheet.create((_theme) => ({
  safe:          {},
  header:        {},
  backText:      {},
  scroll:        {},
  content:       {},
  title:         {},
  lastUpdated:   {},
  section:       {},
  sectionTitle:  {},
  subTitle:      {},
  paragraph:     {},
  spacer:        {},
  bulletGroup:   {},
  bulletRow:     {},
  bullet:        {},
  bulletText:    {},
  bulletFooter:  {},
  link:          {},
  footer:        {},
  footerText:    {},
  topButton:     {},
  topButtonText: {},
}));

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
  readonly footer?: ReactNode;
  readonly onBack?: () => void;
  readonly lastUpdatedLabel?: string;
}

const HIT_SLOP = { top: 12, bottom: 12, left: 12, right: 12 } as const;

function isBulletGroup(value: string | BulletGroup): value is BulletGroup {
  return typeof value !== 'string' && 'items' in value;
}

const URL_REGEX = /(https?:\/\/[^\s,)]+)/g;
const TRAILING_PUNCTUATION = /[.,;:!?)\]]+$/;

function extractUrlSegments(text: string) {
  const segments: { url?: string; value: string }[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(URL_REGEX)) {
    if (match.index === undefined) continue;
    const index = match.index;
    const rawUrl = match[0];
    const url = rawUrl.replace(TRAILING_PUNCTUATION, '');
    const trailing = rawUrl.slice(url.length);
    if (index > lastIndex) segments.push({ value: text.slice(lastIndex, index) });
    segments.push({ url, value: url });
    if (trailing) segments.push({ value: trailing });
    lastIndex = index + rawUrl.length;
  }
  if (lastIndex < text.length) segments.push({ value: text.slice(lastIndex) });
  return segments;
}

function isAllowedUrl(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://');
}

const AutoLinkText = memo(function AutoLinkText({ text, style }: { readonly text: string; readonly style: StyleProp<TextStyle> }) {
  const segments = useMemo(() => extractUrlSegments(text), [text]);
  if (segments.length <= 1 && !segments[0]?.url) {
    return <Text style={style}>{text}</Text>;
  }
  return (
    <Text style={style}>
      {segments.map((seg, i) => {
        const url = seg.url;
        return url && isAllowedUrl(url) ? (
          <Text key={i} style={styles.link} onPress={() => { Linking.openURL(url).catch(() => {}); }} accessibilityRole="link" accessibilityHint="Open external link">
            {seg.value}
          </Text>
        ) : (
          <Text key={i}>{seg.value}</Text>
        );
      })}
    </Text>
  );
});

const postListParagraphStyle = [styles.paragraph, styles.bulletFooter];

const BulletList = memo(function BulletList({ group }: { readonly group: BulletGroup }) {
  return (
    <View style={styles.bulletGroup}>
      {group.heading ? <Text style={styles.subTitle}>{group.heading}</Text> : null}
      {group.items.map((item, i) => (
        <View key={i} style={styles.bulletRow}>
          <Text style={styles.bullet}>•</Text>
          <AutoLinkText text={item} style={styles.bulletText} />
        </View>
      ))}
      {group.footer ? <AutoLinkText text={group.footer} style={postListParagraphStyle} /> : null}
    </View>
  );
});

const Section = memo(function Section({ section }: { readonly section: LegalSection }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{section.title}</Text>
      {section.paragraphs.map((block, i) =>
        block === '' ? (
          <View key={i} style={styles.spacer} />
        ) : isBulletGroup(block) ? (
          <BulletList key={i} group={block} />
        ) : (
          <AutoLinkText key={i} text={block} style={styles.paragraph} />
        ),
      )}
    </View>
  );
});

export default function LegalDocument({ title, lastUpdated, sections, footerText, footer, onBack, lastUpdatedLabel = 'Last Updated: ' }: LegalDocumentProps) {
  const router = useRouter();
  const scrollRef = useRef<ScrollView>(null);
  const handleBack = useCallback(() => {
    if (onBack) {
      onBack();
    } else {
      router.back();
    }
  }, [onBack, router]);
  const scrollToTop = useCallback(() => { scrollRef.current?.scrollTo({ y: 0, animated: true }); }, []);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={handleBack} hitSlop={HIT_SLOP} accessibilityRole="button" accessibilityLabel="Go back">
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
      </View>
      <ScrollView ref={scrollRef} style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={true}>
        <Text style={styles.title} accessibilityRole="header">{title}</Text>
        <Text style={styles.lastUpdated}>{lastUpdatedLabel}{lastUpdated}</Text>
        {sections.map((section, i) => <Section key={i} section={section} />)}
        <View style={styles.footer}>
          {footer !== undefined ? footer : <Text style={styles.footerText}>{footerText}</Text>}
        </View>
        <TouchableOpacity style={styles.topButton} onPress={scrollToTop} hitSlop={HIT_SLOP} accessibilityRole="button" accessibilityLabel="Scroll to top">
          <Text style={styles.topButtonText}>↑ Back to top</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}