import { ref, onMounted, watch } from 'vue';

type Theme = 'light' | 'dark';

const THEME_STORAGE_KEY = 'spawner-theme';

const currentTheme = ref<Theme>('light');

export function useTheme() {
  const isDark = ref(currentTheme.value === 'dark');

  // Load theme from localStorage on mount
  onMounted(() => {
    const savedTheme = localStorage.getItem(THEME_STORAGE_KEY) as Theme | null;
    if (savedTheme && (savedTheme === 'light' || savedTheme === 'dark')) {
      currentTheme.value = savedTheme;
      isDark.value = savedTheme === 'dark';
    }
    applyTheme(currentTheme.value);
  });

  // Watch for theme changes
  watch(currentTheme, (newTheme) => {
    isDark.value = newTheme === 'dark';
    applyTheme(newTheme);
    localStorage.setItem(THEME_STORAGE_KEY, newTheme);
  });

  function applyTheme(theme: Theme) {
    const root = document.documentElement;

    // Remove both classes first
    root.classList.remove('light-theme', 'dark-theme');

    // Add the appropriate class
    root.classList.add(`${theme}-theme`);

    // Update #app background
    const app = document.getElementById('app');
    if (app) {
      if (theme === 'dark') {
        app.style.backgroundColor = '#111827';
        app.style.color = '#e5e7eb';
      } else {
        app.style.backgroundColor = '#f3f4f6';
        app.style.color = '#1f2937';
      }
    }
  }

  function toggleTheme() {
    currentTheme.value = currentTheme.value === 'dark' ? 'light' : 'dark';
  }

  function setTheme(theme: Theme) {
    currentTheme.value = theme;
  }

  return {
    currentTheme,
    isDark,
    toggleTheme,
    setTheme
  };
}
