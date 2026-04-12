import { logger } from './logger';
// Using MyMemory Free Translation API (no API key needed, 10,000 chars/day)
// https://mymemory.translated.net/doc/spec.php

const TRANSLATE_API = 'https://api.mymemory.translated.net/get';

export interface TranslationResult {
  success: boolean;
  translatedText?: string;
  detectedLanguage?: string;
  error?: string;
}

export async function translateMessage(
  text: string,
  targetLang: string = 'en'
): Promise<TranslationResult> {
  try {
    // Auto-detect source language by using 'auto'
    const response = await fetch(
      `${TRANSLATE_API}?q=${encodeURIComponent(text)}&langpair=autodetect|${targetLang}`
    );

    const data = await response.json();

    if (data.responseStatus === 200 && data.responseData) {
      return {
        success: true,
        translatedText: data.responseData.translatedText,
        detectedLanguage: data.responseData.detectedLanguage,
      };
    }

    return {
      success: false,
      error: data.responseDetails || 'Translation failed',
    };
  } catch (error: any) {
    logger.error('Translation error:', error);
    return {
      success: false,
      error: error.message || 'Translation failed',
    };
  }
}

export function detectLanguage(text: string): string {
  // Simple language detection based on character sets
  const cyrillicRegex = /[\u0400-\u04FF]/;
  const arabicRegex = /[\u0600-\u06FF]/;
  const chineseRegex = /[\u4E00-\u9FFF]/;
  const turkishChars = /[ğĞıİöÖüÜşŞçÇ]/;
  const azerbaijaniChars = /[əƏ]/;

  if (azerbaijaniChars.test(text)) return 'az';
  if (cyrillicRegex.test(text)) return 'ru';
  if (arabicRegex.test(text)) return 'ar';
  if (chineseRegex.test(text)) return 'zh';
  if (turkishChars.test(text)) return 'tr';
  
  return 'en'; // Default to English
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