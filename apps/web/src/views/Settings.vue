<template>
  <div class="max-w-3xl mx-auto space-y-6">
    <div>
      <h1 class="text-4xl font-bold mb-2">Settings</h1>
      <p class="text-lg opacity-70">Optional ways to log in</p>
    </div>

    <section class="panel">
      <h2 class="panel-title"><i class="pi pi-github text-sm"></i>GitHub login</h2>
      <div v-if="!settings" class="flex justify-center py-8">
        <ProgressSpinner />
      </div>
      <form v-else class="space-y-5" @submit.prevent="save">
        <p class="text-sm text-slate-600 dark:text-slate-400">
          Passkeys work without it. With an organization set, its members (of the team, when one is set) can log in and get a member account; without one, only
          accounts linked from their account page can use it.
        </p>
        <Message v-if="settings.source === 'environment'" severity="info" :closable="false">
          Configured from the GITHUB_* variables of the server. Saving here takes over.
        </Message>

        <label class="flex items-center gap-2">
          <ToggleSwitch v-model="form.enabled" input-id="github-enabled" />
          <span class="font-medium">Allow logging in with GitHub</span>
        </label>

        <div>
          <label class="field-label" for="github-callback">Callback URL of the OAuth app</label>
          <div class="flex items-center gap-2">
            <code id="github-callback" class="flex-1 break-all text-xs bg-slate-100 dark:bg-dark-700 rounded px-2 py-2">{{ settings.callbackUrl }}</code>
            <Button type="button" icon="pi pi-copy" text size="small" v-tooltip.top="'Copy'" @click="copy(settings.callbackUrl)" />
          </div>
          <p class="field-hint">Create the OAuth app in your organization settings (Developer settings, OAuth Apps) with this callback URL.</p>
        </div>

        <div class="grid sm:grid-cols-2 gap-4">
          <div>
            <label class="field-label" for="github-client-id">Client ID</label>
            <InputText id="github-client-id" v-model="form.clientId" class="w-full font-mono" />
          </div>
          <div>
            <label class="field-label" for="github-client-secret">Client secret</label>
            <Password v-model="form.clientSecret" input-id="github-client-secret" :feedback="false" toggle-mask class="w-full" input-class="w-full font-mono" :placeholder="settings.hasSecret ? 'Saved; leave empty to keep it' : ''" />
          </div>
          <div>
            <label class="field-label" for="github-org">Organization</label>
            <InputText id="github-org" v-model="form.org" class="w-full" placeholder="acme" />
          </div>
          <div>
            <label class="field-label" for="github-team">Team</label>
            <InputText id="github-team" v-model="form.team" class="w-full" placeholder="developers" />
          </div>
        </div>

        <Message v-if="error" severity="error" :closable="false">{{ error }}</Message>
        <div class="flex justify-end">
          <Button type="submit" label="Save" :loading="saving" />
        </div>
      </form>
    </section>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import Message from 'primevue/message';
import Password from 'primevue/password';
import ProgressSpinner from 'primevue/progressspinner';
import ToggleSwitch from 'primevue/toggleswitch';
import { useNotification } from '../composables/useNotification';
import { errorMessage, settingsApi } from '../services/api';
import { useAuthStore } from '../stores/auth';
import type { GithubSettings } from '../types';

const { showSuccess } = useNotification();
const authStore = useAuthStore();

const settings = ref<GithubSettings | null>(null);
const form = reactive({ enabled: false, clientId: '', clientSecret: '', org: '', team: '' });
const saving = ref(false);
const error = ref('');

function fill(value: GithubSettings) {
  settings.value = value;
  Object.assign(form, { enabled: value.enabled, clientId: value.clientId, clientSecret: '', org: value.org, team: value.team });
}

async function save() {
  saving.value = true;
  error.value = '';
  try {
    fill(await settingsApi.updateGithub({ ...form, clientSecret: form.clientSecret || undefined }));
    await authStore.checkAuth();
    showSuccess('GitHub login saved');
  } catch (err) {
    error.value = errorMessage(err, 'The settings could not be saved');
  } finally {
    saving.value = false;
  }
}

async function copy(value: string) {
  await navigator.clipboard.writeText(value);
  showSuccess('Copied');
}

onMounted(async () => {
  try {
    fill(await settingsApi.github());
  } catch (err) {
    error.value = errorMessage(err, 'The settings could not be loaded');
  }
});
</script>
