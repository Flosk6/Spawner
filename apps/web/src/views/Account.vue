<template>
  <div class="page-head">
    <div>
      <h1 class="page-title">Account</h1>
      <p class="page-lead">How you log in, and the tokens of your agents and scripts.</p>
    </div>
  </div>

  <div v-if="!account" class="flex justify-center py-16"><LoaderCircle class="spinner size-6 text-fg-3" /></div>

  <template v-else>
    <div class="grid items-start gap-4 lg:grid-cols-2">
      <section class="card">
        <div class="card-head">
          <div class="card-title"><UserRound />Profile</div>
          <span class="field-hint">Role: {{ account.user.role }}</span>
        </div>
        <form class="card-body" @submit.prevent="rename">
          <div class="field">
            <label class="field-label" for="account-name">Name</label>
            <div class="flex gap-2">
              <input id="account-name" v-model="name" class="input" autocomplete="name" />
              <button type="submit" class="btn btn-secondary" :disabled="!name.trim() || name.trim() === account.user.name">Save</button>
            </div>
            <p class="field-hint">Shown on your environments and in the audit trail.</p>
          </div>
        </form>
      </section>

      <div class="flex min-w-0 flex-col gap-4">
        <section class="card">
          <div class="card-head is-flush">
            <div class="card-title"><KeyRound />Passkeys<span class="count">{{ account.passkeys.length }}</span></div>
            <button type="button" class="btn btn-secondary btn-sm" :disabled="!passkeysSupported || adding" @click="addPasskey">
              <LoaderCircle v-if="adding" class="spinner" /><Plus v-else />Add a passkey
            </button>
          </div>
          <div class="list">
            <div v-if="account.passkeys.length === 0" class="list-row text-fg-3">No passkey yet.</div>
            <div v-for="passkey in account.passkeys" :key="passkey.id" class="list-row">
              <div class="svc-icon"><Fingerprint /></div>
              <div class="list-main">
                <div class="list-title">
                  <span class="truncate">{{ passkey.name }}</span><span v-if="passkey.backedUp" class="badge badge-sm">synced</span>
                </div>
                <div class="list-sub">
                  <span class="truncate">
                    Added {{ timeAgo(passkey.createdAt) }}<template v-if="passkey.lastUsedAt">, used {{ timeAgo(passkey.lastUsedAt) }}</template>
                  </span>
                </div>
              </div>
              <button type="button" class="btn btn-ghost btn-sm" @click="removePasskey(passkey.id, passkey.name)">Remove</button>
            </div>
          </div>
          <div v-if="!passkeysSupported" class="card-foot">This browser cannot add a passkey here: passkeys need HTTPS, or localhost.</div>
        </section>

        <section v-if="account.githubAvailable || github" class="card">
          <div class="card-head is-flush"><div class="card-title"><Github />GitHub</div></div>
          <div class="list">
            <div class="list-row">
              <div class="list-main">
                <span v-if="github" class="truncate">Linked to GitHub as <span class="font-semibold">{{ github.username }}</span></span>
                <span v-else class="text-fg-3">Log in with GitHub too</span>
              </div>
              <button v-if="github" type="button" class="btn btn-ghost btn-sm" @click="unlinkGithub">Unlink</button>
              <a v-else :href="authApi.githubUrl({ link: true, next: '/account' })" class="btn btn-secondary btn-sm"><Github />Link GitHub</a>
            </div>
          </div>
        </section>
      </div>
    </div>

    <section class="card">
      <div class="card-head"><div class="card-title"><SquareTerminal />Command line and agents</div></div>
      <div class="card-body flex flex-col gap-4">
        <p class="field-hint">
          The <code>spawner</code> CLI needs Node.js 20 or later. Install it from this server, then log in: it sends you here to enter the code
          it shows and approve the login.
        </p>
        <dl class="grid gap-y-1.5 md:grid-cols-[11rem_minmax(0,1fr)] md:gap-x-6 md:gap-y-3">
          <template v-for="block in cliBlocks" :key="block.label">
            <dt class="mt-2.5 text-[13px] font-medium text-fg-2 first:mt-0 md:mt-0 md:pt-2">{{ block.label }}</dt>
            <dd class="cmd">
              <span class="cmd-text">{{ block.code }}</span>
              <button
                type="button"
                class="btn btn-ghost btn-sm btn-icon"
                :aria-label="`Copy: ${block.label}`"
                v-tooltip.top="'Copy'"
                @click="copy(block.code)"
              >
                <Copy />
              </button>
            </dd>
          </template>
        </dl>
      </div>
    </section>

    <section class="card">
      <div class="card-head">
        <div class="card-title"><Lock />API tokens<span class="count">{{ tokens.length }}</span></div>
        <button type="button" class="btn btn-secondary btn-sm" @click="tokenDialog = true"><Plus />New token</button>
      </div>
      <div class="card-body flex flex-col gap-3">
        <p class="field-hint">
          For the CLI, the MCP server and scripts. <code class="whitespace-nowrap">spawner login</code> creates one for you; create one here
          for an agent of its own, such as <code class="whitespace-nowrap">claude-laptop</code>.
        </p>
        <div v-if="created" class="alert tone-ok">
          <CircleCheck />
          <div class="alert-body gap-2">
            <div class="flex flex-col gap-0.5">
              <span class="alert-title">Token "{{ created.info.name }}" created</span>
              <span class="alert-text">Copy it now: it will not be shown again.</span>
            </div>
            <div class="cmd">
              <span class="cmd-text">{{ created.token }}</span>
              <button type="button" class="btn btn-ghost btn-sm btn-icon" aria-label="Copy the token" v-tooltip.top="'Copy'" @click="copy(created.token)">
                <Copy />
              </button>
            </div>
          </div>
          <div class="alert-actions">
            <button type="button" class="btn btn-ghost btn-sm btn-icon" aria-label="Dismiss" @click="created = null"><X /></button>
          </div>
        </div>
      </div>

      <div v-if="tokens.length === 0" class="empty border-t">No token yet.</div>
      <div v-else class="table-wrap border-t">
        <table class="table">
          <thead>
            <tr>
              <th>Name</th>
              <th class="hidden sm:table-cell">Scopes</th>
              <th class="hidden md:table-cell">Project</th>
              <th class="hidden lg:table-cell">Last used</th>
              <th class="hidden sm:table-cell">Expires</th>
              <th><span class="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="token in tokens" :key="token.id">
              <td class="max-w-[16rem]">
                <div class="row-title">{{ token.name }}</div>
                <div class="row-sub">
                  <span class="commit">{{ token.hint }}</span>
                  <span class="sm:hidden" aria-hidden="true">·</span>
                  <span class="sm:hidden">{{ expiry(token) }}</span>
                </div>
                <div class="mt-1.5 flex flex-wrap gap-1 sm:hidden">
                  <span v-for="scope in token.scopes" :key="scope" class="badge badge-sm font-mono">{{ scope }}</span>
                </div>
              </td>
              <td class="hidden sm:table-cell">
                <div class="flex flex-wrap gap-1">
                  <span v-for="scope in token.scopes" :key="scope" class="badge badge-sm font-mono">{{ scope }}</span>
                </div>
              </td>
              <td class="hidden text-fg-2 md:table-cell">{{ token.project ?? 'all' }}</td>
              <td class="hidden whitespace-nowrap text-fg-2 lg:table-cell">{{ token.lastUsedAt ? timeAgo(token.lastUsedAt) : 'never' }}</td>
              <td class="hidden whitespace-nowrap text-fg-2 sm:table-cell">{{ token.expiresAt ? timeLeft(token.expiresAt) : 'never' }}</td>
              <td class="cell-actions">
                <button type="button" class="btn btn-ghost btn-sm" @click="revoke(token.id, token.name)">Revoke</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </template>

  <Dialog v-model:visible="tokenDialog" header="New API token" modal :style="{ width: 'min(32.5rem, calc(100vw - 2rem))' }">
    <form id="new-token" class="flex flex-col gap-4" @submit.prevent="createToken">
      <div class="field">
        <label class="field-label" for="token-name">Name</label>
        <input id="token-name" v-model="form.name" class="input" placeholder="claude-laptop" autocomplete="off" spellcheck="false" />
      </div>

      <div class="field" role="group" aria-labelledby="token-scopes">
        <span id="token-scopes" class="field-label">Scopes</span>
        <div class="flex flex-col rounded-lg border">
          <label
            v-for="scope in availableScopes"
            :key="scope"
            :for="`scope-${scope}`"
            class="flex cursor-pointer items-start gap-2.5 border-t px-3 py-2 first:border-t-0 hover:bg-surface-hover"
          >
            <Checkbox v-model="form.scopes" :value="scope" :input-id="`scope-${scope}`" />
            <span class="flex min-w-0 flex-col">
              <code class="font-medium text-fg">{{ scope }}</code>
              <span class="text-[12.5px] leading-[18px] text-fg-3">{{ SCOPE_LABELS[scope] }}</span>
            </span>
          </label>
        </div>
      </div>

      <div class="grid gap-4 sm:grid-cols-2">
        <div class="field">
          <label class="field-label" for="token-days">Expires after (days)</label>
          <InputNumber v-model="form.days" input-id="token-days" :min="1" :max="365" fluid />
        </div>
        <div class="field">
          <label class="field-label" for="token-project">Project</label>
          <Select
            v-model="form.project"
            input-id="token-project"
            :options="projects"
            option-label="name"
            option-value="slug"
            placeholder="All projects"
            show-clear
            class="w-full"
          />
        </div>
      </div>

      <div v-if="formError" class="alert tone-danger" role="alert">
        <CircleX />
        <div class="alert-body"><span class="alert-text">{{ formError }}</span></div>
      </div>
    </form>

    <template #footer>
      <button type="button" class="btn btn-ghost" @click="tokenDialog = false">Cancel</button>
      <button type="submit" form="new-token" class="btn btn-primary" :disabled="saving || !form.name.trim() || form.scopes.length === 0">
        <LoaderCircle v-if="saving" class="spinner" /><Plus v-else />Create
      </button>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { browserSupportsWebAuthn, startRegistration } from '@simplewebauthn/browser';
import { computed, onMounted, reactive, ref, watch } from 'vue';
import Checkbox from 'primevue/checkbox';
import Dialog from 'primevue/dialog';
import InputNumber from 'primevue/inputnumber';
import Select from 'primevue/select';
import { CircleCheck, CircleX, Copy, Fingerprint, Github, KeyRound, LoaderCircle, Lock, Plus, SquareTerminal, UserRound, X } from 'lucide-vue-next';
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
/** Admin rights reach the whole installation: a token restricted to a project cannot have them. */
const availableScopes = computed<Scope[]>(() => (authStore.isAdmin && !form.project ? [...MEMBER_SCOPES, 'admin'] : MEMBER_SCOPES));
watch(
  () => form.project,
  (project) => {
    if (project) {
      form.scopes = form.scopes.filter((scope) => scope !== 'admin');
    }
  },
);
const cliBlocks = computed(() => {
  const origin = window.location.origin;
  return [
    { label: 'Install', code: `mkdir -p ~/.local/bin && curl -fsSL ${origin}/api/v1/cli/spawner -o ~/.local/bin/spawner && chmod +x ~/.local/bin/spawner` },
    { label: 'Log in', code: `spawner login ${origin}` },
    { label: 'In a project', code: 'spawner init        # once: .spawner/ and the instructions for agents\nspawner up --wait   # the environment of the current branch' },
    { label: 'MCP server (.mcp.json)', code: '{ "mcpServers": { "spawner": { "command": "spawner", "args": ["mcp"] } } }' },
  ];
});

/** The Expires column in a few words, for the rows of small screens, where the column is hidden. */
function expiry(token: ApiTokenInfo): string {
  if (!token.expiresAt) {
    return 'never expires';
  }
  const left = timeLeft(token.expiresAt);
  return left === 'expired' ? left : `expires ${left}`;
}

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
  confirmAction(
    `You will no longer log in with the passkey "${label}".`,
    async () => {
      try {
        await meApi.removePasskey(id);
        await load();
      } catch (err) {
        showError(errorMessage(err, 'The passkey could not be removed'));
      }
    },
    { header: 'Remove this passkey?', acceptLabel: 'Remove', danger: true },
  );
}

function unlinkGithub() {
  const identity = github.value;
  if (!identity) {
    return;
  }
  confirmAction(
    'You will no longer log in with GitHub.',
    async () => {
      try {
        await meApi.removeIdentity(identity.id);
        await load();
      } catch (err) {
        showError(errorMessage(err, 'GitHub could not be unlinked'));
      }
    },
    { header: 'Unlink GitHub?', acceptLabel: 'Unlink', danger: true },
  );
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
  confirmAction(
    `Whatever uses "${label}" stops working at once.`,
    async () => {
      try {
        await tokensApi.revoke(id);
        tokens.value = await tokensApi.list();
      } catch (err) {
        showError(errorMessage(err, 'The token could not be revoked'));
      }
    },
    { header: 'Revoke this token?', acceptLabel: 'Revoke', danger: true },
  );
}

async function copy(value: string) {
  await navigator.clipboard.writeText(value);
  showSuccess('Copied');
}

onMounted(load);
</script>
