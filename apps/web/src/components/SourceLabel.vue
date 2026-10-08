<template>
  <span class="flex min-w-0 items-center gap-1.5 text-fg-2" :title="title">
    <Upload v-if="source.origin === 'upload'" class="size-3.5 text-fg-3" />
    <GitBranch v-else class="size-3.5 text-fg-3" />
    <span class="truncate font-mono text-sm">{{ source.origin === 'upload' ? 'worktree' : source.ref }}</span>
    <span v-if="hash" class="commit">{{ hash }}</span>
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { GitBranch, Upload } from 'lucide-vue-next';
import type { EnvironmentSource } from '../types';

/** Where the code of a source comes from: a branch at a commit, or an uploaded worktree. */
const props = defineProps<{ source: EnvironmentSource }>();

const hash = computed(() => (props.source.origin === 'upload' ? props.source.digest : props.source.commit)?.slice(0, 7) ?? '');

const title = computed(() =>
  props.source.origin === 'upload'
    ? 'Uploaded worktree, uncommitted changes included'
    : `${props.source.ref ?? ''}${props.source.commit ? ` @ ${props.source.commit}` : ''}`,
);
</script>
