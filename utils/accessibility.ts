export interface A11yProps {
  accessibilityLabel: string;
  accessibilityRole?: 'button'|'link'|'header'|'image'|'text'|'none'|'adjustable'|'imagebutton'|'keyboardkey'|'summary'|'checkbox'|'combobox'|'menu'|'menubar'|'menuitem'|'progressbar'|'radio'|'radiogroup'|'scrollbar'|'spinbutton'|'switch'|'tab'|'tablist'|'timer'|'toolbar'|'list'|'grid'|'alert'|'article'|'search'|'togglebutton';
  accessibilityHint?: string;
  accessibilityState?: { disabled?: boolean; selected?: boolean; checked?: boolean | 'mixed'; busy?: boolean; expanded?: boolean };
  accessibilityValue?: { min?: number; max?: number; now?: number; text?: string };
  importantForAccessibility?: 'auto'|'yes'|'no'|'no-hide-descendants';
}

export const a11y = {
  button: (label: string, hint?: string): A11yProps => ({ accessibilityLabel: label, accessibilityRole: 'button', ...(hint ? { accessibilityHint: hint } : {}) }),
  image: (label: string): A11yProps => ({ accessibilityLabel: label, accessibilityRole: 'image' }),
  header: (label: string): A11yProps => ({ accessibilityLabel: label, accessibilityRole: 'header' }),
  link: (label: string, hint?: string): A11yProps => ({ accessibilityLabel: label, accessibilityRole: 'link', ...(hint ? { accessibilityHint: hint } : {}) }),
  toggle: (label: string, checked: boolean): A11yProps => ({ accessibilityLabel: label, accessibilityRole: 'switch', accessibilityState: { checked } }),
  tab: (label: string, selected: boolean): A11yProps => ({ accessibilityLabel: label, accessibilityRole: 'tab', accessibilityState: { selected } }),
  loading: (label = 'Loading'): A11yProps => ({ accessibilityLabel: label, accessibilityRole: 'none', accessibilityState: { busy: true } }),
  decorative: (): A11yProps => ({ accessibilityLabel: '', importantForAccessibility: 'no' }),
  progressBar: (label: string, value: number, min = 0, max = 100): A11yProps => ({ accessibilityLabel: label, accessibilityRole: 'progressbar', accessibilityValue: { min, max, now: value, text: `${Math.round(value)}%` } }),
  disabled: (label: string): A11yProps => ({ accessibilityLabel: label, accessibilityRole: 'button', accessibilityState: { disabled: true } }),
  alert: (label: string): A11yProps => ({ accessibilityLabel: label, accessibilityRole: 'alert' }),
  search: (label: string): A11yProps => ({ accessibilityLabel: label, accessibilityRole: 'search' }),
};

export function validateTouchTarget(width: number, height: number): { passes: boolean; recommendation?: string } {
  const MIN = 44;
  if (width < MIN || height < MIN) return { passes: false, recommendation: `Touch target should be at least ${MIN}×${MIN}pt (currently ${width}×${height}pt)` };
  return { passes: true };
}

export function getLiveRegionProps(politeness: 'polite' | 'assertive' = 'polite') {
  return { accessibilityLiveRegion: politeness, importantForAccessibility: 'yes' as const };
}

export function getFocusProps(autoFocus = false) {
  return { accessible: true, autoFocus };
}