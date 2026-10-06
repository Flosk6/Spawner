<template>
  <div class="min-h-screen flex items-center justify-center px-4">
    <div class="max-w-md w-full space-y-8">
      <div class="text-center">
        <div class="flex justify-center mb-4">
          <Logo size="xl" :show-text="false" />
        </div>
        <h1 class="text-3xl font-bold mb-2 text-slate-900 dark:text-white">
          {{ invite?.user ? `Welcome back, ${invite.user.name}` : 'Join your team on Spawner' }}
        </h1>
        <p v-if="invite" class="text-slate-500 dark:text-slate-400">
          {{ invite.user ? 'Create a new passkey to get back into your account.' : `You are invited as ${invite.role === 'admin' ? 'an admin' : 'a member'}.` }}
        </p>
      </div>

      <div class="panel">
        <div v-if="loading" class="flex justify-center py-8">
          <ProgressSpinner />
        </div>

        <Message v-else-if="!invite" severity="error" :closable="false">{{ error }}</Message>

        <form v-else class="space-y-5" @submit.prevent="accept">
          <div v-if="!invite.user">
            <label class="field-label" for="invite-name">Your name</label>
            <InputText id="invite-name" v-model="name" class="w-full" autocomplete="name" placeholder="Ada Lovelace" />
          </div>
          <div v-if="passkeysSupported">
            <label class="field-label" for="invite-device">Name of this passkey</label>
            <InputText id="invite-device" v-model="passkeyName" class="w-full" placeholder="MacBook" />
            <p class="field-hint">
              A passkey is how you log in: your device keeps it (Touch ID, Windows Hello, a phone, a security key). No password.
            </p>
          </div>
          <Message v-else-if="invite.passkeyRequired" severity="warn" :closable="false">
            This browser cannot create a passkey here. Open the link in a recent browser.
          </Message>
          <Message v-else severity="info" :closable="false">
            Passkeys need HTTPS (or localhost). On this local install, the invitation logs you in without one.
          </Message>

          <Message v-if="error" severity="error" :closable="false">{{ error }}</Message>

          <Button
            type="submit"
            class="w-full"
            size="large"
            :icon="passkeysSupported ? 'pi pi-key' : 'pi pi-sign-in'"
            :label="passkeysSupported ? 'Create my passkey' : 'Continue without a passkey'"
            :loading="saving"
            :disabled="(!invite.user && !name.trim()) || (!passkeysSupported && invite.passkeyRequired)"
          />
          <p class="field-hint text-center">This link works once, until {{ new Date(invite.expiresAt).toLocaleString() }}.</p>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { browserSupportsWebAuthn, startRegistration } from '@simplewebauthn/browser';
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import Message from 'primevue/message';
import ProgressSpinner from 'primevue/progressspinner';
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
