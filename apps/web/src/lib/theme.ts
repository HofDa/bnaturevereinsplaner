import { readPreference, writePreference } from './preferences';
export type Theme = 'light' | 'dark' | 'system';
export function readTheme(): Theme {
  const saved = readPreference('bnature-theme');
  return saved === 'light' || saved === 'dark' ? saved : 'system';
}
export function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle(
    'dark',
    theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches),
  );
  writePreference('bnature-theme', theme);
}
