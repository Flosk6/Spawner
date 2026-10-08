<template>
  <div class="auth-page">
    <div class="auth-card">
      <Logo :size="34" :text-size="24" class="self-center" />
      <div class="text-center">
        <h1 class="page-title">Log in</h1>
        <p class="page-lead">Preview environments for every branch.</p>
      </div>

      <div v-if="error" class="alert tone-danger" role="alert">
        <CircleX />
        <div class="alert-body"><span class="alert-text">{{ error }}</span></div>
      </div>

      <div class="flex flex-col gap-2">
        <button type="button" class="btn btn-primary btn-block" :disabled="loading || !passkeysSupported" @click="loginWithPasskey">
          <LoaderCircle v-if="loading" class="spinner" /><KeyRound v-else />Log in with a passkey
        </button>
        <p v-if="!passkeysSupported" class="field-hint text-balance text-center">
          This browser cannot use passkeys here: they need HTTPS, or localhost.
        </p>
      </div>

      <template v-if="authStore.methods.github">
        <div class="divider-or">or</div>
        <a :href="authApi.githubUrl({ next: next ?? undefined })" class="btn btn-secondary btn-block"><Github />Log in with GitHub</a>
      </template>

      <p class="text-balance text-center text-[13px] text-fg-3">No account yet? Ask an admin of your team for an invitation link.</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { browserSupportsWebAuthn, startAuthentication } from '@simplewebauthn/browser';
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { CircleX, Github, KeyRound, LoaderCircle } from 'lucide-vue-next';
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
