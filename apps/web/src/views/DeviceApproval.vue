<template>
  <div class="auth-page">
    <div class="flex w-full flex-col items-center gap-4">
      <div class="auth-card">
        <Logo :size="44" :text-size="35" class="self-center" />
        <div class="text-center">
          <h1 class="page-title">Log in the CLI</h1>
          <p class="page-lead text-balance">
            Enter the code your terminal shows, for a login you started yourself. Approving it gives the CLI a token with your rights.
          </p>
        </div>

        <form v-if="!request && !done" class="flex flex-col gap-4" @submit.prevent="lookUp">
          <div class="field">
            <label class="field-label" for="device-code">Code</label>
            <input
              id="device-code"
              v-model="code"
              class="input h-12 text-center font-mono text-2xl uppercase tracking-widest"
              placeholder="BCDF-GHJK"
              autocomplete="off"
              autocapitalize="characters"
              spellcheck="false"
              autofocus
            />
          </div>
          <div v-if="error" class="alert tone-danger" role="alert">
            <CircleX />
            <div class="alert-body"><span class="alert-text">{{ error }}</span></div>
          </div>
          <button type="submit" class="btn btn-primary btn-block" :disabled="loading || code.replace(/[^a-zA-Z]/g, '').length !== 8">
            <LoaderCircle v-if="loading" class="spinner" />Continue
          </button>
        </form>

        <template v-else-if="request && !done">
          <div class="flex flex-col gap-3">
            <p class="text-fg-2">
              <span class="font-semibold text-fg">{{ request.clientName }}</span> asks to act as you on Spawner, with these scopes:
            </p>
            <div class="flex flex-wrap gap-1.5">
              <span v-for="scope in request.scopes" :key="scope" class="badge font-mono">{{ scope }}</span>
            </div>
            <p class="field-hint">
              Code <span class="font-mono text-fg-2">{{ request.userCode }}</span>. Only approve a login you started yourself, just now.
            </p>
          </div>
          <div v-if="error" class="alert tone-danger" role="alert">
            <CircleX />
            <div class="alert-body"><span class="alert-text">{{ error }}</span></div>
          </div>
          <div class="grid grid-cols-2 gap-2">
            <button type="button" class="btn btn-primary btn-block" :disabled="loading" @click="decide(true)">
              <LoaderCircle v-if="loading" class="spinner" /><Check v-else />Approve
            </button>
            <button type="button" class="btn btn-secondary btn-block" :disabled="loading" @click="decide(false)"><X />Deny</button>
          </div>
        </template>

        <div v-else class="alert" :class="done === 'approved' ? 'tone-ok' : 'tone-info'" role="status">
          <CircleCheck v-if="done === 'approved'" /><Info v-else />
          <div class="alert-body">
            <span v-if="done === 'approved'" class="alert-text">Approved. The CLI receives its token within seconds; you can close this page.</span>
            <span v-else class="alert-text">Denied. The CLI login was refused.</span>
          </div>
        </div>
      </div>

      <RouterLink to="/home" class="link text-sm">Back to the dashboard</RouterLink>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { Check, CircleCheck, CircleX, Info, LoaderCircle, X } from 'lucide-vue-next';
import Logo from '../components/Logo.vue';
import { deviceApi, errorMessage } from '../services/api';
import type { DeviceRequest } from '../types';

/**
 * Typed by the user, never taken from the URL: a link from someone else, or a
 * page framing this one, cannot bring a login to approve in one click.
 */
const code = ref('');
const request = ref<DeviceRequest | null>(null);
const done = ref<'approved' | 'denied' | null>(null);
const loading = ref(false);
const error = ref('');

async function lookUp() {
  loading.value = true;
  error.value = '';
  try {
    request.value = await deviceApi.describe(code.value.trim());
  } catch (err) {
    error.value = errorMessage(err, 'This code is unknown or expired');
  } finally {
    loading.value = false;
  }
}

async function decide(approve: boolean) {
  if (!request.value) {
    return;
  }
  loading.value = true;
  error.value = '';
  try {
    done.value = (await deviceApi.decide(request.value.userCode, approve)).status === 'approved' ? 'approved' : 'denied';
  } catch (err) {
    error.value = errorMessage(err, 'The decision could not be saved');
  } finally {
    loading.value = false;
  }
}
</script>
