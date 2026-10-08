<template>
  <div class="page-head">
    <div>
      <h1 class="page-title">Git keys</h1>
      <p class="page-lead">
        Each repository needs its own SSH deploy key, since GitHub accepts a key on one repository only: generate it here, then add its public key to the repository.
      </p>
    </div>
  </div>

  <div v-if="loading" class="flex justify-center py-16"><LoaderCircle class="spinner size-6 text-fg-3" /></div>

  <div v-else-if="loadError" class="alert tone-danger">
    <CircleX />
    <div class="alert-body"><span class="alert-title">{{ loadError }}</span></div>
  </div>

  <div v-else-if="repos.length === 0" class="card empty">
    <KeyRound class="size-6" />
    <span class="empty-title">No Git repository yet</span>
    <span>The repositories of the projects, and the other sources of their <code>spawner.yaml</code>, get their keys here.</span>
    <RouterLink to="/projects" class="link mt-1">Add a project first</RouterLink>
  </div>

  <section v-else class="card">
    <div class="card-head is-flush">
      <div class="card-title"><KeyRound />Repositories<span class="count">{{ repos.length }}</span></div>
    </div>
    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>Repository</th>
            <th class="hidden md:table-cell">Used by</th>
            <th class="hidden sm:table-cell">Deploy key</th>
            <th><span class="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="repo in repos" :key="repo.gitRepo">
            <td class="max-w-[28rem]">
              <span class="block break-all font-mono text-sm font-medium text-fg">{{ repo.gitRepo }}</span>
              <span class="mt-0.5 block break-all font-mono text-xs text-fg-3 md:hidden">{{ repo.usedBy.join(', ') }}</span>
              <span class="badge badge-sm mt-1.5 sm:hidden" :class="{ 'tone-ok': repo.keyExists }"><span class="dot"></span>{{ repo.keyExists ? 'Key exists' : 'No key' }}</span>
            </td>
            <td class="hidden md:table-cell">
              <div class="flex flex-wrap gap-1">
                <span v-for="usage in repo.usedBy" :key="usage" class="badge badge-sm font-mono">{{ usage }}</span>
              </div>
            </td>
            <td class="hidden sm:table-cell">
              <span class="badge badge-sm" :class="{ 'tone-ok': repo.keyExists }"><span class="dot"></span>{{ repo.keyExists ? 'Key exists' : 'No key' }}</span>
            </td>
            <td class="cell-actions">
              <button
                v-if="!repo.keyExists"
                type="button"
                class="btn btn-secondary btn-sm"
                :disabled="generatingRepoUrl === repo.gitRepo"
                @click="generateKeyForRepo(repo)"
              >
                <LoaderCircle v-if="generatingRepoUrl === repo.gitRepo" class="spinner" /><Plus v-else />Generate key
              </button>
              <button v-else type="button" class="btn btn-ghost btn-sm" @click="showKey(repo)"><Eye />View key</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>

  <Dialog v-model:visible="keyVisible" header="Deploy key" modal dismissable-mask :style="{ width: 'min(36rem, calc(100vw - 2rem))' }">
    <div v-if="selectedRepo" class="flex flex-col gap-5">
      <div class="flex min-w-0 flex-col gap-1">
        <span class="break-all font-mono text-sm font-medium text-fg">{{ selectedRepo.gitRepo }}</span>
        <span class="text-sm text-fg-3">Used by <span class="font-mono text-fg-2">{{ selectedRepo.usedBy.join(', ') }}</span></span>
      </div>

      <div class="field">
        <span class="field-label">Public key</span>
        <div class="cmd">
          <span class="cmd-text select-all whitespace-pre-wrap break-all">{{ selectedRepo.publicKey }}</span>
          <button
            type="button"
            class="btn btn-ghost btn-sm btn-icon"
            :aria-label="copied ? 'Copied' : 'Copy the public key'"
            v-tooltip.top="copied ? 'Copied' : 'Copy'"
            @click="copyKey(selectedRepo.publicKey ?? '')"
          >
            <Check v-if="copied" /><Copy v-else />
          </button>
        </div>
      </div>

      <div class="flex flex-col gap-2">
        <span class="field-label">Add it to the repository</span>
        <ol class="flex list-decimal flex-col gap-1 pl-5 text-sm text-fg-2">
          <li>Copy the public key above.</li>
          <li>Open the repository on GitHub (Settings → Deploy keys → Add deploy key) or on GitLab (Settings → Repository → Deploy keys).</li>
          <li>Paste the key, give it a title such as Spawner, and save: read-only access is enough.</li>
        </ol>
      </div>
    </div>

    <template #footer>
      <button
        v-if="selectedRepo"
        type="button"
        class="btn btn-ghost mr-auto"
        :disabled="generatingRepoUrl === selectedRepo.gitRepo"
        @click="confirmRegenerate(selectedRepo)"
      >
        <LoaderCircle v-if="generatingRepoUrl === selectedRepo.gitRepo" class="spinner" /><RefreshCw v-else />Regenerate key
      </button>
      <button type="button" class="btn btn-primary" @click="keyVisible = false">Close</button>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import Dialog from 'primevue/dialog';
import { Check, CircleX, Copy, Eye, KeyRound, LoaderCircle, Plus, RefreshCw } from 'lucide-vue-next';
import { useNotification } from '../composables/useNotification';
import { errorMessage, gitApi } from '../services/api';
import type { RepoKeyInfo } from '../types';

const COPIED_MS = 2000;

const { showError, confirmAction } = useNotification();

const loading = ref(true);
const loadError = ref('');
const repos = ref<RepoKeyInfo[]>([]);
const selectedRepo = ref<RepoKeyInfo | null>(null);
const keyVisible = ref(false);
const generatingRepoUrl = ref<string | null>(null);
const copied = ref(false);

async function loadRepos() {
  loading.value = true;
  try {
    repos.value = await gitApi.repos();
  } catch (err) {
    loadError.value = errorMessage(err, 'The repositories could not be loaded');
  } finally {
    loading.value = false;
  }
}

/** Generates the key of a repository, or replaces it, then shows its public key. */
async function generateKeyForRepo(repo: RepoKeyInfo) {
  generatingRepoUrl.value = repo.gitRepo;
  try {
    const { publicKey } = await gitApi.generateRepoKey(repo.gitRepo);
    const updated: RepoKeyInfo = { ...repo, keyExists: true, publicKey };
    repos.value = repos.value.map((item) => (item.gitRepo === repo.gitRepo ? updated : item));
    showKey(updated);
  } catch (err) {
    showError(errorMessage(err, 'The key could not be generated'));
  } finally {
    generatingRepoUrl.value = null;
  }
}

function showKey(repo: RepoKeyInfo) {
  selectedRepo.value = repo;
  keyVisible.value = true;
}

async function copyKey(publicKey: string) {
  await navigator.clipboard.writeText(publicKey);
  copied.value = true;
  setTimeout(() => (copied.value = false), COPIED_MS);
}

function confirmRegenerate(repo: RepoKeyInfo) {
  confirmAction(
    `The current key of ${repo.gitRepo} stops working at once: replace the deploy key of the repository with the new public key.`,
    () => generateKeyForRepo(repo),
    { header: 'Regenerate the key?', acceptLabel: 'Regenerate', danger: true },
  );
}

onMounted(loadRepos);
</script>
