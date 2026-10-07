<template>
  <div class="min-h-screen flex items-center justify-center px-4">
    <div class="max-w-md w-full space-y-8">
      <div class="text-center">
        <div class="flex justify-center mb-4">
          <Logo size="xl" :show-text="false" />
        </div>
        <h1 class="text-4xl font-bold mb-2 text-primary-spawner dark:text-purple-300">Spawner</h1>
        <p class="text-slate-500 dark:text-slate-400">Preview environments for every branch</p>
      </div>

      <div class="panel space-y-5">
        <Message v-if="error" severity="error" :closable="false">{{ error }}</Message>

        <Button
          label="Log in with a passkey"
          icon="pi pi-key"
          class="w-full"
          size="large"
          :loading="loading"
          :disabled="!passkeysSupported"
          @click="loginWithPasskey"
        />
        <p v-if="!passkeysSupported" class="field-hint text-center">
          This browser cannot use passkeys here: they need HTTPS, or localhost.
        </p>

        <template v-if="authStore.methods.github">
          <Divider align="center"><span class="text-xs text-slate-500">or</span></Divider>
          <a :href="authApi.githubUrl({ next: next ?? undefined })" class="block">
            <Button label="Log in with GitHub" icon="pi pi-github" severity="secondary" outlined class="w-full" size="large" />
          </a>
        </template>

        <p class="text-center text-sm text-slate-500 dark:text-slate-400 pt-2">
          No account yet? Ask an admin of your team for an invitation link.
        </p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { browserSupportsWebAuthn, startAuthentication } from '@simplewebauthn/browser';
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import Button from 'primevue/button';
import Divider from 'primevue/divider';
import Message from 'primevue/message';
import Logo from '../components/Logo.vue';
import { authApi, errorMessage } from '../services/api';
import { useAuthStore } from '../stores/auth';

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();

const loading = ref(false);
const error = ref<string | null>(null);
const passkeysSupported = browserSupportsWebAuthn();

/** A dashboard path to open after the login (a preview hand-off goes through the API). */
const next = computed(() => {
  const value = route.query.next;
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : null;
});

async function goOn() {
  if (next.value?.startsWith('/api/')) {
    window.location.assign(next.value);
  } else {
    await router.replace(next.value ?? '/');
  }
}

async function loginWithPasskey() {
  loading.value = true;
  error.value = null;
  try {
    const optionsJSON = await authApi.passkeyOptions();
    const credential = await startAuthentication({ optionsJSON });
    const { user } = await authApi.passkeyLogin(credential);
    authStore.setUser(user);
    await goOn();
  } catch (err) {
    error.value = err instanceof Error && err.name === 'NotAllowedError' ? 'The passkey request was cancelled.' : errorMessage(err, 'The login failed');
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  if (typeof route.query.error === 'string') {
    error.value = route.query.error;
  }
  await authStore.checkAuth();
  if (authStore.isAuthenticated) {
    await goOn();
  }
});
</script>
