<template>
  <div class="page-head">
    <div>
      <h1 class="page-title">Settings</h1>
      <p class="page-lead">Limits of the environments, and optional ways to log in.</p>
    </div>
  </div>

  <LimitsSettings />

  <section class="card">
    <div class="card-head">
      <div class="card-title"><Github />GitHub login</div>
    </div>

    <div v-if="!settings" class="card-body">
      <div v-if="error" class="alert tone-danger">
        <CircleX />
        <div class="alert-body"><span class="alert-title">{{ error }}</span></div>
      </div>
      <div v-else class="flex justify-center py-8"><LoaderCircle class="spinner size-6 text-fg-3" /></div>
    </div>

    <form v-else @submit.prevent="save">
      <div class="card-body flex flex-col gap-5">
        <div v-if="settings.source === 'environment'" class="alert tone-info">
          <Info />
          <div class="alert-body"><span class="alert-text">Configured from the GITHUB_* variables of the server. Saving here takes over.</span></div>
        </div>

        <div class="flex items-start gap-3">
          <ToggleSwitch v-model="form.enabled" input-id="github-enabled" class="flex-none" />
          <div class="flex min-w-0 flex-col gap-1 pt-0.5">
            <label for="github-enabled" class="field-label cursor-pointer">Allow logging in with GitHub</label>
            <p class="field-hint max-w-3xl">
              Passkeys work without it. With an organization set, its members (of the team, when one is set) can log in and get a member account; without one,
              only accounts linked from their account page can use it.
            </p>
          </div>
        </div>

        <div class="field">
          <span class="field-label">Callback URL of the OAuth app</span>
          <div class="cmd">
            <span class="cmd-text">{{ settings.callbackUrl }}</span>
            <button type="button" class="btn btn-ghost btn-sm btn-icon" aria-label="Copy the callback URL" v-tooltip.top="'Copy'" @click="copy(settings.callbackUrl)">
              <Copy />
            </button>
          </div>
          <p class="field-hint">Create the OAuth app in your organization settings (Developer settings, OAuth Apps) with this callback URL.</p>
        </div>

        <div class="grid gap-x-6 gap-y-5 sm:grid-cols-2">
          <div class="field">
            <label class="field-label" for="github-client-id">Client ID</label>
            <input id="github-client-id" v-model="form.clientId" class="input font-mono" autocomplete="off" spellcheck="false" />
          </div>
          <div class="field">
            <label class="field-label" for="github-client-secret">Client secret</label>
            <div class="relative">
              <input
                id="github-client-secret"
                v-model="form.clientSecret"
                :type="secretShown ? 'text' : 'password'"
                class="input pr-10 font-mono"
                :placeholder="settings.hasSecret ? 'Saved; leave empty to keep it' : ''"
                autocomplete="off"
                spellcheck="false"
              />
              <button
                type="button"
                class="btn btn-ghost btn-sm btn-icon absolute right-0.5 top-1/2 -translate-y-1/2"
                :aria-label="secretShown ? 'Hide the secret' : 'Show the secret'"
                @click="secretShown = !secretShown"
              >
                <EyeOff v-if="secretShown" /><Eye v-else />
              </button>
            </div>
          </div>
          <div class="field">
            <label class="field-label" for="github-org">Organization</label>
            <input id="github-org" v-model="form.org" class="input" placeholder="acme" autocomplete="off" spellcheck="false" />
          </div>
          <div class="field">
            <label class="field-label" for="github-team">Team</label>
            <input id="github-team" v-model="form.team" class="input" placeholder="developers" autocomplete="off" spellcheck="false" />
          </div>
        </div>

        <div v-if="error" class="alert tone-danger">
          <CircleX />
          <div class="alert-body"><span class="alert-text">{{ error }}</span></div>
        </div>
      </div>

      <div class="card-foot justify-end">
        <button type="submit" class="btn btn-primary" :disabled="saving"><LoaderCircle v-if="saving" class="spinner" /><Save v-else />Save</button>
      </div>
    </form>
  </section>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import ToggleSwitch from 'primevue/toggleswitch';
import { CircleX, Copy, Eye, EyeOff, Github, Info, LoaderCircle, Save } from 'lucide-vue-next';
import LimitsSettings from '../components/LimitsSettings.vue';
import { useNotification } from '../composables/useNotification';
import { errorMessage, settingsApi } from '../services/api';
import { useAuthStore } from '../stores/auth';
import type { GithubSettings } from '../types';

const { showSuccess } = useNotification();
const authStore = useAuthStore();

const settings = ref<GithubSettings | null>(null);
const form = reactive({ enabled: false, clientId: '', clientSecret: '', org: '', team: '' });
const secretShown = ref(false);
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
