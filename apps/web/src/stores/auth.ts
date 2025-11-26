import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { User, AuthStatus } from '@spawner/types';

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  const isAuthenticated = computed(() => user.value !== null);

  async function checkAuth() {
    loading.value = true;
    error.value = null;
    try {
      const response = await fetch('/api/auth/status', {
        credentials: 'include',
      });
      const data: AuthStatus = await response.json();
      if (data.authenticated && data.user) {
        user.value = data.user;
      } else {
        user.value = null;
      }
    } catch (e) {
      console.error('Auth check failed:', e);
      error.value = 'Failed to check authentication status';
      user.value = null;
    } finally {
      loading.value = false;
    }
  }

  async function logout() {
    loading.value = true;
    error.value = null;
    try {
      await fetch('/api/auth/logout', {
        credentials: 'include',
      });
      user.value = null;
      window.location.href = '/login';
    } catch (e) {
      console.error('Logout failed:', e);
      error.value = 'Failed to logout';
    } finally {
      loading.value = false;
    }
  }

  function loginWithGithub() {
    window.location.href = '/api/auth/github';
  }

  return {
    user,
    loading,
    error,
    isAuthenticated,
    checkAuth,
    logout,
    loginWithGithub,
  };
});
