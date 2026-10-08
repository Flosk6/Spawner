<template>
  <div class="auth-page">
    <div class="auth-card">
      <Logo :size="34" :text-size="24" class="self-center" />
      <div class="text-center">
        <h1 class="page-title">{{ invite?.user ? `Welcome back, ${invite.user.name}` : 'Join your team on Spawner' }}</h1>
        <p v-if="invite?.user" class="page-lead text-balance">Create a new passkey to get back into your account.</p>
        <p v-else-if="invite" class="page-lead text-balance">You are invited as {{ invite.role === 'admin' ? 'an admin' : 'a member' }}.</p>
      </div>

      <div v-if="loading" class="flex justify-center py-8"><LoaderCircle class="spinner size-6 text-fg-3" /></div>

      <div v-else-if="!invite" class="alert tone-danger" role="alert">
        <CircleX />
        <div class="alert-body"><span class="alert-text">{{ error }}</span></div>
      </div>

      <form v-else class="flex flex-col gap-4" @submit.prevent="accept">
        <div v-if="!invite.user" class="field">
          <label class="field-label" for="invite-name">Your name</label>
          <input id="invite-name" v-model="name" class="input" autocomplete="name" placeholder="Ada Lovelace" />
        </div>
        <div v-if="passkeysSupported" class="field">
          <label class="field-label" for="invite-device">Name of this passkey</label>
          <input id="invite-device" v-model="passkeyName" class="input" autocomplete="off" placeholder="MacBook" />
          <p class="field-hint">
            A passkey is how you log in: your device keeps it (Touch ID, Windows Hello, a phone, a security key). No password.
          </p>
        </div>
        <div v-else-if="invite.passkeyRequired" class="alert tone-warn">
          <TriangleAlert />
          <div class="alert-body">
            <span class="alert-text">This browser cannot create a passkey here. Open the link in a recent browser.</span>
          </div>
        </div>
        <div v-else class="alert tone-info">
          <Info />
          <div class="alert-body">
            <span class="alert-text">Passkeys need HTTPS (or localhost). On this local install, the invitation logs you in without one.</span>
          </div>
        </div>

        <div v-if="error" class="alert tone-danger" role="alert">
          <CircleX />
          <div class="alert-body"><span class="alert-text">{{ error }}</span></div>
        </div>

        <button
          type="submit"
          class="btn btn-primary btn-block"
          :disabled="saving || (!invite.user && !name.trim()) || (!passkeysSupported && invite.passkeyRequired)"
        >
          <LoaderCircle v-if="saving" class="spinner" /><KeyRound v-else-if="passkeysSupported" /><LogIn v-else />
          {{ passkeysSupported ? 'Create my passkey' : 'Continue without a passkey' }}
        </button>
        <p class="text-balance text-center text-sm text-fg-3">This link works once, until {{ new Date(invite.expiresAt).toLocaleString() }}.</p>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { browserSupportsWebAuthn, startRegistration } from '@simplewebauthn/browser';
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { CircleX, Info, KeyRound, LoaderCircle, LogIn, TriangleAlert } from 'lucide-vue-next';
import Logo from '../components/Logo.vue';
import { errorMessage, invitesApi } from '../services/api';
import { useAuthStore } from '../stores/auth';
import type { InviteInfo } from '../types';

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();

const token = route.params.token as string;
const invite = ref<InviteInfo | null>(null);
const loading = ref(true);
const saving = ref(false);
const error = ref('');
const name = ref('');
const passkeyName = ref(guessDevice());
const passkeysSupported = browserSupportsWebAuthn() && window.isSecureContext;

/** A first name for the passkey, from the kind of device the browser runs on. */
function guessDevice(): string {
  const agent = navigator.userAgent;
  if (/iPhone|iPad/.test(agent)) return 'iPhone';
  if (/Android/.test(agent)) return 'Android';
  if (/Mac/.test(agent)) return 'Mac';
  if (/Windows/.test(agent)) return 'Windows';
  return 'Passkey';
}

async function accept() {
  saving.value = true;
  error.value = '';
  try {
    let credential: unknown;
    if (passkeysSupported) {
      const optionsJSON = await invitesApi.passkeyOptions(token, name.value.trim());
      credential = await startRegistration({ optionsJSON });
    }
    const { user } = await invitesApi.accept(token, { name: name.value.trim(), credential, passkeyName: passkeyName.value.trim() });
    authStore.setUser({ ...user, avatarUrl: null, email: null });
    await authStore.checkAuth();
    await router.replace('/');
  } catch (err) {
    error.value = err instanceof Error && err.name === 'NotAllowedError' ? 'The passkey request was cancelled.' : errorMessage(err, 'The invitation could not be used');
  } finally {
    saving.value = false;
  }
}

onMounted(async () => {
  try {
    invite.value = await invitesApi.open(token);
  } catch (err) {
    error.value = errorMessage(err, 'This invitation is invalid, expired or already used. Ask an admin for a new one.');
  } finally {
    loading.value = false;
  }
});
</script>
