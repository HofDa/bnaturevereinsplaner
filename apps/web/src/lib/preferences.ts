// Preferences must never prevent the interface from loading in restricted browsers.
// Keep changes for this tab when persistent storage is unavailable.
const temporary = new Map<string, string>();
export function readPreference(key: string): string | null {
  if (temporary.has(key)) return temporary.get(key)!;
  try {
    return localStorage.getItem(key);
  } catch {
    return temporary.get(key) ?? null;
  }
}
export function writePreference(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
    temporary.delete(key);
  } catch {
    temporary.set(key, value);
    // The preference still applies for the current tab.
  }
}
