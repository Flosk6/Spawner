import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { authApi } from '../services/api';
import type { User } from '../types';

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null);
  const methods = ref({ passkey: true, github: false });
  const loading = ref(false);

  const isAuthenticated = computed(() => user.value !== null);
  const isAdmin = computed(() => user.value?.role === 'admin');

  // The router guard and the app shell both ask on startup: they share one request.
  let pending: Promise<void> | null = null;

  function checkAuth(): Promise<void> {
    pending ??= fetchSession().finally(() => (pending = null));
    return pending;
  }

  async function fetchSession() {
    loading.value = true;
    try {
      const session = await authApi.session();
      user.value = session.user;
      methods.value = session.methods;
    } catch {
      user.value = null;
    } finally {
      loading.value = false;
    }
  }

  function setUser(value: User) {
    user.value = value;
  }

  async function logout() {
    await authApi.logout().catch(() => undefined);
    user.value = null;
    window.location.href = '/login';
  }

  return { user, methods, loading, isAuthenticated, isAdmin, checkAuth, setUser, logout };
});
