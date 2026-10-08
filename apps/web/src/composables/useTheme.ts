import { computed, ref, watchEffect } from 'vue';

export type ThemePreference = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'spawner-theme';
/** Where the dashboard kept "light" or "dark" before the system choice existed. */
const LEGACY_KEY = 'theme';

const media = window.matchMedia('(prefers-color-scheme: dark)');
const systemDark = ref(media.matches);
media.addEventListener('change', (event) => (systemDark.value = event.matches));

const preference = ref<ThemePreference>(readPreference());
const resolved = computed<'light' | 'dark'>(() => (preference.value === 'system' ? (systemDark.value ? 'dark' : 'light') : preference.value));

watchEffect(() => document.documentElement.classList.toggle('dark', resolved.value === 'dark'));

function readPreference(): ThemePreference {
  try {
    const value = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_KEY);
    return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
  } catch {
    return 'system';
  }
}

function setPreference(value: ThemePreference) {
  preference.value = value;
  try {
    localStorage.setItem(STORAGE_KEY, value);
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    return;
  }
}

/**
 * The theme: the user's choice (light, dark, or the system's), kept in this
 * browser, and the one in effect. `html.dark` follows it, which switches the
 * tokens of styles/tokens.css and PrimeVue's dark scheme; index.html applies
 * the same rule before the first paint.
 */
export function useTheme() {
  return { preference, resolved, setPreference };
}
