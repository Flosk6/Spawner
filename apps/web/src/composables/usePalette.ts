import { ref } from 'vue';

const open = ref(false);

/** Whether the command palette is open: the sidebar's search, Ctrl+K or Cmd+K open it. */
export function usePalette() {
  return {
    open,
    show: () => (open.value = true),
    hide: () => (open.value = false),
    toggle: () => (open.value = !open.value),
  };
}
