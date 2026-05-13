import { logger } from './logger';

const TRANSLATE_API = 'https://api.mymemory.translated.net/get';

export interface TranslationResult { success: boolean; translatedText?: string; detectedLanguage?: string; error?: string; }

interface MyMemoryResponse {
  responseStatus: number;
  responseData?: { translatedText: string; detectedLanguage?: string };
  responseDetails?: string;
}

export async function translateMessage(text: string, targetLang = 'en'): Promise<TranslationResult> {
  try {
    const res = await fetch(`${TRANSLATE_API}?q=${encodeURIComponent(text)}&langpair=autodetect|${targetLang}`);
    const data = await res.json() as MyMemoryResponse;
    if (data.responseStatus === 200 && data.responseData) {
      return { success: true, translatedText: data.responseData.translatedText, detectedLanguage: data.responseData.detectedLanguage };
    }
    return { success: false, error: data.responseDetails ?? 'Translation failed' };
  } catch (error: unknown) {
    logger.error('Translation error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Translation failed' };
  }
}

export function detectLanguage(text: string): string {
  if (/[əƏ]/.test(text)) return 'az';
  if (/[\u0400-\u04FF]/.test(text)) return 'ru';
  if (/[\u0600-\u06FF]/.test(text)) return 'ar';
  if (/[\u4E00-\u9FFF]/.test(text)) return 'zh';
  if (/[ğĞıİöÖüÜşŞçÇ]/.test(text)) return 'tr';
  return 'en';
}

export const SUPPORTED_LANGUAGES = [
  { code: 'en', name: 'English', flag: '🇬🇧' },
  { code: 'az', name: 'Azərbaycanca', flag: '🇦🇿' },
  { code: 'tr', name: 'Türkçe', flag: '🇹🇷' },
  { code: 'ru', name: 'Русский', flag: '🇷🇺' },
  { code: 'es', name: 'Español', flag: '🇪🇸' },
  { code: 'fr', name: 'Français', flag: '🇫🇷' },
  { code: 'de', name: 'Deutsch', flag: '🇩🇪' },
  { code: 'ar', name: 'العربية', flag: '🇸🇦' },
  { code: 'pt', name: 'Português', flag: '🇵🇹' },
  { code: 'zh', name: '中文', flag: '🇨🇳' },
];
