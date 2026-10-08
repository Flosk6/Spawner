<template>
  <div>
    <button type="button" class="side-user" aria-haspopup="menu" @click="menu?.toggle($event)">
      <UserAvatar :user="user" />
      <span class="flex min-w-0 flex-1 flex-col leading-4">
        <span class="truncate text-sm font-medium text-fg">{{ user.name }}</span>
        <span class="text-xs text-fg-3">{{ user.role === 'admin' ? 'Admin' : 'Member' }}</span>
      </span>
      <ChevronsUpDown class="size-3.5 text-fg-3" />
    </button>
    <ActionMenu ref="menu" :items="items" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ChevronsUpDown, LogOut, UserRound } from 'lucide-vue-next';
import ActionMenu, { type MenuAction } from './ActionMenu.vue';
import UserAvatar from './UserAvatar.vue';
import { useAuthStore } from '../stores/auth';
import type { User } from '../types';

defineProps<{ user: User }>();

const router = useRouter();
const authStore = useAuthStore();
const menu = ref<InstanceType<typeof ActionMenu> | null>(null);

const items = computed<MenuAction[]>(() => [
  { label: 'Account and tokens', icon: UserRound, command: () => router.push('/account') },
  { separator: true },
  { label: 'Log out', icon: LogOut, command: () => authStore.logout() },
]);
</script>
