<template>
  <Menu ref="menu" :model="model" popup>
    <template #item="{ item, props: itemProps }">
      <a v-bind="itemProps.action" class="flex items-center gap-2.5">
        <component :is="item.iconComponent" v-if="item.iconComponent" />
        <span class="flex-1">{{ item.label }}</span>
        <span v-if="item.hint" class="pl-3 text-xs text-fg-3">{{ item.hint }}</span>
      </a>
    </template>
  </Menu>
</template>

<script setup lang="ts">
import { computed, markRaw, ref, type Component } from 'vue';
import Menu from 'primevue/menu';

export interface MenuAction {
  label?: string;
  icon?: Component;
  command?: () => void;
  /** A destructive action, shown in red. */
  danger?: boolean;
  disabled?: boolean;
  hint?: string;
  separator?: boolean;
}

const props = defineProps<{ items: MenuAction[] }>();

const menu = ref<InstanceType<typeof Menu> | null>(null);

const model = computed(() =>
  props.items.map((item) =>
    item.separator
      ? { separator: true }
      : {
          label: item.label,
          iconComponent: item.icon ? markRaw(item.icon) : undefined,
          command: item.command,
          disabled: item.disabled,
          hint: item.hint,
          class: item.danger ? 'is-danger' : undefined,
        },
  ),
);

/** Opens the menu next to the element of the event, or closes it. */
function toggle(event: Event) {
  menu.value?.toggle(event);
}

defineExpose({ toggle });
</script>
