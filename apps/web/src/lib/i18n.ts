import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import de from '../locales/de';
import it from '../locales/it';
const saved = localStorage.getItem('bnature-language');
void i18n.use(initReactI18next).init({
  resources: { de: { translation: de }, it: { translation: it } },
  lng: saved === 'de' || saved === 'it' ? saved : 'de',
  fallbackLng: 'de',
  interpolation: { escapeValue: false },
});
i18n.on('languageChanged', (language) => {
  document.documentElement.lang = language;
  localStorage.setItem('bnature-language', language);
});
document.documentElement.lang = i18n.language;
export default i18n;
