<template>
  <div class="max-w-4xl mx-auto space-y-6">
    <div>
      <h1 class="text-4xl font-bold mb-2">Your account</h1>
      <p class="text-lg opacity-70">How you log in, and the tokens of your agents and scripts</p>
    </div>

    <div v-if="!account" class="flex justify-center py-20">
      <ProgressSpinner />
    </div>

    <template v-else>
      <!-- Profile -->
      <section class="panel">
        <h2 class="panel-title"><i class="pi pi-user text-sm"></i>Profile</h2>
        <form class="flex flex-wrap items-end gap-3" @submit.prevent="rename">
          <div class="flex-1 min-w-[220px]">
            <label class="field-label" for="account-name">Name</label>
            <InputText id="account-name" v-model="name" class="w-full" />
          </div>
          <Button type="submit" label="Save" severity="secondary" outlined :disabled="!name.trim() || name.trim() === account.user.name" />
        </form>
        <p class="field-hint">Role: {{ account.user.role }}. Shown on your environments and in the audit trail.</p>
      </section>

      <!-- Logins -->
      <section class="panel">
        <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h2 class="panel-title !mb-0"><i class="pi pi-key text-sm"></i>Passkeys</h2>
          <Button label="Add a passkey" icon="pi pi-plus" size="small" :disabled="!passkeysSupported" :loading="adding" @click="addPasskey" />
        </div>
        <p v-if="account.passkeys.length === 0" class="text-sm text-slate-500">No passkey yet.</p>
        <ul v-else class="divide-y divide-slate-200 dark:divide-purple-800/30">
          <li v-for="passkey in account.passkeys" :key="passkey.id" class="flex items-center justify-between gap-3 py-3">
            <div>
              <p class="font-medium">{{ passkey.name }}</p>
              <p class="text-xs text-slate-500">
                Added {{ timeAgo(passkey.createdAt) }}
                <template v-if="passkey.lastUsedAt"> · used {{ timeAgo(passkey.lastUsedAt) }}</template>
                <template v-if="passkey.backedUp"> · synced</template>
              </p>
            </div>
            <Button icon="pi pi-trash" severity="danger" text rounded v-tooltip.top="'Remove'" @click="removePasskey(passkey.id, passkey.name)" />
          </li>
        </ul>

        <div v-if="account.githubAvailable || github" class="mt-6 pt-4 border-t border-slate-200 dark:border-purple-800/30 flex flex-wrap items-center justify-between gap-3">
          <div class="flex items-center gap-2">
            <i class="pi pi-github"></i>
            <span v-if="github">Linked to GitHub as <span class="font-medium">{{ github.username }}</span></span>
            <span v-else class="text-slate-500">Log in with GitHub too</span>
          </div>
          <Button v-if="github" label="Unlink" severity="secondary" text size="small" @click="unlinkGithub" />
          <a v-else :href="authApi.githubUrl({ link: true, next: '/account' })">
            <Button label="Link GitHub" severity="secondary" outlined size="small" />
          </a>
        </div>
      </section>

      <!-- Command line -->
      <section class="panel">
        <h2 class="panel-title"><i class="pi pi-code text-sm"></i>Command line and agents</h2>
        <p class="field-hint mb-4">
          The <code>spawner</code> CLI needs Node.js 20 or later. Install it from this server, then log in: it sends you here to enter the code
          it shows and approve the login.
        </p>
        <div v-for="block in cliBlocks" :key="block.label" class="mb-3 last:mb-0">
          <p class="text-xs uppercase text-slate-500 mb-1">{{ block.label }}</p>
          <div class="flex items-start gap-2">
            <pre class="flex-1 min-w-0 text-xs bg-slate-100 dark:bg-black/30 rounded px-3 py-2 overflow-x-auto"><code>{{ block.code }}</code></pre>
            <Button icon="pi pi-copy" size="small" text v-tooltip.top="'Copy'" @click="copy(block.code)" />
          </div>
        </div>
      </section>

      <!-- Tokens -->
      <section class="panel">
        <div class="flex flex-wrap items-center justify-between gap-3 mb-2">
          <h2 class="panel-title !mb-0"><i class="pi pi-lock text-sm"></i>API tokens</h2>
          <Button label="New token" icon="pi pi-plus" size="small" @click="tokenDialog = true" />
        </div>
        <p class="field-hint mb-4">
          For the CLI, the MCP server and scripts. <code>spawner login</code> creates one for you; create one here for an agent of its own, such as
          <code>claude-laptop</code>.
        </p>

        <Message v-if="created" severity="success" :closable="true" class="mb-4" @close="created = null">
          <p class="font-semibold mb-2">Token "{{ created.info.name }}" created. Copy it now: it will not be shown again.</p>
          <div class="flex items-center gap-2">
            <code class="flex-1 break-all text-xs bg-white/60 dark:bg-black/20 rounded px-2 py-1">{{ created.token }}</code>
            <Button icon="pi pi-copy" size="small" text v-tooltip.top="'Copy'" @click="copy(created.token)" />
          </div>
        </Message>

        <p v-if="tokens.length === 0" class="text-sm text-slate-500">No token.</p>
        <div v-else class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="text-left text-xs uppercase text-slate-500">
              <tr>
                <th class="py-2 pr-4">Name</th>
                <th class="py-2 pr-4">Scopes</th>
                <th class="py-2 pr-4">Project</th>
                <th class="py-2 pr-4">Last used</th>
                <th class="py-2 pr-4">Expires</th>
                <th></th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-200 dark:divide-purple-800/30">
              <tr v-for="token in tokens" :key="token.id">
                <td class="py-2 pr-4">
                  <span class="font-medium">{{ token.name }}</span>
                  <span class="block font-mono text-xs text-slate-500">{{ token.hint }}</span>
                </td>
                <td class="py-2 pr-4 font-mono text-xs">{{ token.scopes.join(' ') }}</td>
                <td class="py-2 pr-4">{{ token.project ?? 'all' }}</td>
                <td class="py-2 pr-4">{{ token.lastUsedAt ? timeAgo(token.lastUsedAt) : 'never' }}</td>
                <td class="py-2 pr-4">{{ token.expiresAt ? timeLeft(token.expiresAt) : 'never' }}</td>
                <td class="py-2 text-right">
                  <Button icon="pi pi-ban" severity="danger" text rounded v-tooltip.top="'Revoke'" @click="revoke(token.id, token.name)" />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>

    <Dialog v-model:visible="tokenDialog" header="New API token" modal :style="{ width: '520px' }">
      <form class="space-y-5" @submit.prevent="createToken">
        <div>
          <label class="field-label" for="token-name">Name</label>
          <InputText id="token-name" v-model="form.name" class="w-full" placeholder="claude-laptop" />
        </div>
        <div>
          <span class="field-label">Scopes</span>
          <div class="space-y-2">
            <label v-for="scope in availableScopes" :key="scope" class="flex items-start gap-2 text-sm">
              <Checkbox v-model="form.scopes" :value="scope" :input-id="`scope-${scope}`" />
              <span><code>{{ scope }}</code> <span class="text-slate-500">{{ SCOPE_LABELS[scope] }}</span></span>
            </label>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="field-label" for="token-days">Expires after (days)</label>
            <InputNumber v-model="form.days" input-id="token-days" :min="1" :max="365" class="w-full" />
          </div>
          <div>
            <label class="field-label" for="token-project">Project</label>
            <Select v-model="form.project" input-id="token-project" :options="projects" option-label="name" option-value="slug" placeholder="All projects" show-clear class="w-full" />
          </div>
        </div>
        <Message v-if="formError" severity="error" :closable="false">{{ formError }}</Message>
        <div class="flex justify-end gap-2">
          <Button type="button" label="Cancel" severity="secondary" text @click="tokenDialog = false" />
          <Button type="submit" label="Create" :loading="saving" :disabled="!form.name.trim() || form.scopes.length === 0" />
        </div>
      </form>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import { browserSupportsWebAuthn, startRegistration } from '@simplewebauthn/browser';
import { computed, onMounted, reactive, ref } from 'vue';
import Button from 'primevue/button';
import Checkbox from 'primevue/checkbox';
import Dialog from 'primevue/dialog';
import InputNumber from 'primevue/inputnumber';
import InputText from 'primevue/inputtext';
import Message from 'primevue/message';
import ProgressSpinner from 'primevue/progressspinner';
import Select from 'primevue/select';
import { useNotification } from '../composables/useNotification';
import { authApi, errorMessage, meApi, projectsApi, tokensApi } from '../services/api';
import { useAuthStore } from '../stores/auth';
import type { Account, ApiTokenInfo, CreatedToken, ProjectSummary, Scope } from '../types';
import { timeAgo, timeLeft } from '../utils/format';
import { MEMBER_SCOPES, SCOPE_LABELS } from '../utils/scopes';

const authStore = useAuthStore();
const { showError, showSuccess, confirmAction } = useNotification();

const account = ref<Account | null>(null);
const tokens = ref<ApiTokenInfo[]>([]);
const projects = ref<ProjectSummary[]>([]);
const name = ref('');
const adding = ref(false);
const tokenDialog = ref(false);
const saving = ref(false);
const formError = ref('');
const created = ref<CreatedToken | null>(null);
const form = reactive({ name: '', scopes: [...MEMBER_SCOPES] as Scope[], days: 90, project: null as string | null });
const passkeysSupported = browserSupportsWebAuthn() && window.isSecureContext;

const github = computed(() => account.value?.identities.find((identity) => identity.provider === 'github') ?? null);
const availableScopes = computed<Scope[]>(() => (authStore.isAdmin ? [...MEMBER_SCOPES, 'admin'] : MEMBER_SCOPES));
const cliBlocks = computed(() => {
  const origin = window.location.origin;
  return [
    { label: 'Install', code: `mkdir -p ~/.local/bin && curl -fsSL ${origin}/api/v1/cli/spawner -o ~/.local/bin/spawner && chmod +x ~/.local/bin/spawner` },
    { label: 'Log in', code: `spawner login ${origin}` },
    { label: 'In a project', code: 'spawner init        # once: .spawner/ and the instructions for agents\nspawner up --wait   # the environment of the current branch' },
    { label: 'MCP server (.mcp.json)', code: '{ "mcpServers": { "spawner": { "command": "spawner", "args": ["mcp"] } } }' },
  ];
});

async function load() {
  try {
    [account.value, tokens.value, projects.value] = await Promise.all([meApi.get(), tokensApi.list(), projectsApi.list()]);
    name.value = account.value.user.name;
  } catch (err) {
    showError(errorMessage(err, 'Your account could not be loaded'));
  }
}

async function rename() {
  try {
    authStore.setUser(await meApi.rename(name.value.trim()));
    showSuccess('Name saved');
    await load();
  } catch (err) {
    showError(errorMessage(err, 'The name could not be saved'));
  }
}

async function addPasskey() {
  adding.value = true;
  try {
    const optionsJSON = await meApi.passkeyOptions();
    const credential = await startRegistration({ optionsJSON });
    await meApi.addPasskey(credential, navigator.platform || 'Passkey');
    showSuccess('Passkey added');
    await load();
  } catch (err) {
    if (!(err instanceof Error && err.name === 'NotAllowedError')) {
      showError(errorMessage(err, 'The passkey could not be added'));
    }
  } finally {
    adding.value = false;
  }
}

function removePasskey(id: string, label: string) {
  confirmAction(`Remove the passkey "${label}"? You will no longer log in with it.`, async () => {
    try {
      await meApi.removePasskey(id);
      await load();
    } catch (err) {
      showError(errorMessage(err, 'The passkey could not be removed'));
    }
  });
}

function unlinkGithub() {
  const identity = github.value;
  if (!identity) {
    return;
  }
  confirmAction('Stop logging in with GitHub?', async () => {
    try {
      await meApi.removeIdentity(identity.id);
      await load();
    } catch (err) {
      showError(errorMessage(err, 'GitHub could not be unlinked'));
    }
  });
}

async function createToken() {
  saving.value = true;
  formError.value = '';
  try {
    created.value = await tokensApi.create({ name: form.name.trim(), scopes: form.scopes, expiresInDays: form.days, project: form.project ?? undefined });
    tokenDialog.value = false;
    Object.assign(form, { name: '', scopes: [...MEMBER_SCOPES], days: 90, project: null });
    tokens.value = await tokensApi.list();
  } catch (err) {
    formError.value = errorMessage(err, 'The token could not be created');
  } finally {
    saving.value = false;
  }
}

function revoke(id: string, label: string) {
  confirmAction(`Revoke the token "${label}"? Whatever uses it stops working at once.`, async () => {
    try {
      await tokensApi.revoke(id);
      tokens.value = await tokensApi.list();
    } catch (err) {
      showError(errorMessage(err, 'The token could not be revoked'));
    }
  });
}

async function copy(value: string) {
  await navigator.clipboard.writeText(value);
  showSuccess('Copied');
}

onMounted(load);
</script>
