<template>
  <div
    class="group relative rounded-2xl p-[1.5px] transition-all duration-300 cursor-pointer hover:shadow-2xl"
    :class="borderClass"
    @click="$emit('view', environment)"
  >
    <div class="relative rounded-2xl bg-white dark:bg-dark-800 p-6 h-full overflow-hidden flex flex-col">
      <div class="absolute top-0 left-0 h-px w-full bg-gradient-to-r from-transparent via-slate-400/40 dark:via-white/30 to-transparent"></div>

      <div class="flex items-center justify-between mb-4">
        <EnvironmentStatus :status="environment.status" />
        <span class="text-xs text-slate-500">{{ timeAgo(environment.createdAt) }}</span>
      </div>

      <div class="flex flex-wrap items-center gap-2 mb-4">
        <h3 class="text-xl font-bold text-slate-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors break-all">
          {{ environment.slug }}
        </h3>
        <span class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-200/80 dark:bg-dark-700/50 border border-slate-300/50 dark:border-purple-800/30">
          <i class="pi pi-folder text-blue-600 dark:text-blue-400 text-xs"></i>
          <span class="text-xs font-medium text-slate-700 dark:text-slate-300">{{ environment.project }}</span>
        </span>
      </div>

      <div class="space-y-1.5 mb-4 text-sm text-slate-600 dark:text-slate-400">
        <div class="flex items-center gap-2 min-w-0">
          <i class="pi pi-user text-xs"></i>
          <span class="truncate">{{ ownerLabel(environment) }}</span>
        </div>
        <div v-if="primary" class="flex items-center gap-2 min-w-0">
          <i :class="primary.origin === 'upload' ? 'pi pi-upload' : 'pi pi-code-branch'" class="text-xs"></i>
          <span class="truncate">{{ sourceLabel(primary) }}</span>
        </div>
        <div v-if="environment.status === 'failed' && environment.error" class="flex items-start gap-2 text-red-600 dark:text-red-400">
          <i class="pi pi-times-circle text-xs mt-1"></i>
          <span class="line-clamp-2">{{ environment.phase ? `${environment.phase}: ` : '' }}{{ environment.error }}</span>
        </div>
        <div v-else-if="environment.expiresAt" class="flex items-center gap-2">
          <i class="pi pi-clock text-xs"></i>
          <span>Expires {{ timeLeft(environment.expiresAt) }}</span>
        </div>
      </div>

      <div class="mt-auto space-y-3">
        <a
          v-if="environment.url && environment.status === 'ready'"
          :href="environment.url"
          target="_blank"
          rel="noopener"
          class="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors"
          @click.stop
        >
          <i class="pi pi-external-link text-xs"></i>
          <span class="text-sm font-medium">Open</span>
        </a>

        <div class="flex gap-2" @click.stop>
          <button :class="actionClass" :disabled="busy" @click="$emit('view', environment)" v-tooltip.top="'Details'">
            <i class="pi pi-eye"></i>
          </button>
          <button v-if="manageable && environment.status === 'ready'" :class="actionClass" :disabled="busy" @click="$emit('stop', environment)" v-tooltip.top="'Stop'">
            <i class="pi pi-pause"></i>
          </button>
          <button v-if="manageable && environment.status === 'stopped'" :class="actionClass" :disabled="busy" @click="$emit('start', environment)" v-tooltip.top="'Start'">
            <i class="pi pi-play"></i>
          </button>
          <button
            v-if="manageable && redeployable"
            :class="actionClass"
            :disabled="busy"
            @click="$emit('redeploy', environment)"
            v-tooltip.top="'Redeploy the latest commit'"
          >
            <i class="pi pi-refresh"></i>
          </button>
          <button
            v-if="manageable"
            :class="[actionClass, 'hover:!border-red-400 hover:text-red-600']"
            :disabled="busy"
            @click="$emit('delete', environment)"
            v-tooltip.top="'Delete'"
          >
            <i class="pi pi-trash"></i>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import EnvironmentStatus from './EnvironmentStatus.vue';
import type { Environment, EnvironmentSource } from '../types';
import { useAuthStore } from '../stores/auth';
import { TONE_CLASSES, canManage, isBusy, ownerLabel, redeployRequest, statusTone } from '../utils/environment';
import { timeAgo, timeLeft } from '../utils/format';

const props = defineProps<{ environment: Environment }>();

defineEmits<{
  view: [environment: Environment];
  stop: [environment: Environment];
  start: [environment: Environment];
  redeploy: [environment: Environment];
  delete: [environment: Environment];
}>();

const authStore = useAuthStore();
const busy = computed(() => isBusy(props.environment.status));
const manageable = computed(() => canManage(authStore.user, props.environment));
const redeployable = computed(() => redeployRequest(props.environment) !== null);
const borderClass = computed(() => TONE_CLASSES[statusTone(props.environment.status)].border);

const primary = computed(() => props.environment.sources.find((source) => source.primary));

const actionClass =
  'flex-1 px-3 py-2.5 bg-slate-200/70 dark:bg-dark-700/70 hover:bg-slate-300 dark:hover:bg-slate-700 border border-slate-300/50 dark:border-purple-800/30 rounded-lg transition-all duration-200 flex items-center justify-center text-slate-600 dark:text-slate-400 disabled:opacity-50 disabled:cursor-not-allowed';

function sourceLabel(source: EnvironmentSource): string {
  if (source.origin === 'upload') {
    return 'Uploaded worktree';
  }
  const commit = source.commit ? ` @ ${source.commit.slice(0, 7)}` : '';
  return `${source.ref ?? ''}${commit}`;
}
</script>
