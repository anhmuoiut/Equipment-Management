import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import vi from './locales/vi.json';

export const STORAGE_KEY = 'equipment-language';
export const SUPPORTED_LANGUAGES = ['en', 'vi'] as const;
export type SupportedLanguage = typeof SUPPORTED_LANGUAGES[number];

/**
 * A blocking inline script in app/layout.tsx already sets
 * `document.documentElement.lang` from localStorage before any client JS
 * (including this module) runs — reading it here means the very first
 * client render already uses the persisted language, with no flash of the
 * wrong one. On the server there is no `document`, so this falls back to
 * 'en', matching the static `<html lang="en">` markup exactly.
 */
function initialLanguage(): SupportedLanguage {
  if (typeof document !== 'undefined' && document.documentElement.lang === 'vi') return 'vi';
  return 'en';
}

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    resources: { en: { translation: en }, vi: { translation: vi } },
    lng: initialLanguage(),
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    returnEmptyString: false,
  });
}

/** Switches the active language and persists it — mirrors the theme toggle's own localStorage pattern. */
export function setLanguage(lang: SupportedLanguage): void {
  void i18n.changeLanguage(lang);
  document.documentElement.lang = lang;
  try { window.localStorage.setItem(STORAGE_KEY, lang); } catch {}
}
