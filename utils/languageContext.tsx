import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { getTranslation, Language, TranslationKeys } from './i18n';
import { langStorage } from './storage';

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => Promise<void>;
  t: TranslationKeys;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>('en');
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    const savedLang = langStorage.getString('app_language');
    if (savedLang && ['en', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'zh', 'ja', 'ko', 'ar', 'hi', 'az'].includes(savedLang)) {
      setLanguageState(savedLang as Language);
    }
    setIsLoaded(true);
  }, []);

  const setLanguage = useCallback(async (lang: Language) => {
    langStorage.set('app_language', lang);
    setLanguageState(lang);
  }, []);

  const t = getTranslation(language);

  if (!isLoaded) {
    return null;
  }

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
}
