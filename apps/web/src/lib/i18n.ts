import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import de from '../locales/de';

export type Language = 'de' | 'it';
// German is the default and the fallback and ships with the app; other languages are fetched
// when they are first used.
const loaders: Record<
  Exclude<Language, 'de'>,
  () => Promise<{ default: Record<string, string> }>
> = { it: () => import('../locales/it') };
const saved = localStorage.getItem('bnature-language');
const initial: Language = saved === 'it' ? 'it' : 'de';
void i18n.use(initReactI18next).init({
  resources: { de: { translation: de } },
  lng: initial,
  fallbackLng: 'de',
  interpolation: { escapeValue: false },
  initAsync: false,
});
async function load(language: Language) {
  if (language === 'de' || i18n.hasResourceBundle(language, 'translation')) return;
  i18n.addResourceBundle(language, 'translation', (await loaders[language]()).default);
}
/** Switches the interface language, fetching its texts first if needed. */
export async function setLanguage(language: Language) {
  await load(language);
  await i18n.changeLanguage(language);
}
/**
 * Settles once the texts of the start language are there. Rendering waits for it, so nobody
 * sees German flash before Italian; if the download fails the app starts in German.
 */
export const languageReady: Promise<void> = load(initial).catch(() => undefined);
i18n.on('languageChanged', (language) => {
  document.documentElement.lang = language;
  localStorage.setItem('bnature-language', language);
});
document.documentElement.lang = i18n.language;
export default i18n;
