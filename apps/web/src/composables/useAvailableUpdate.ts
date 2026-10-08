import { effectScope, ref, watch } from 'vue';
import { systemApi } from '../services/api';
import { useAuthStore } from '../stores/auth';

const version = ref<string | null>(null);
const scope = effectScope(true);
let started = false;

/**
 * The newer Spawner an admin can install from the System page, or null. It is
 * asked whenever an admin logs in, and shared by the sidebar and the top bar;
 * the watcher lives outside any component, which come and go with the shell.
 */
export function useAvailableUpdate() {
  if (!started) {
    started = true;
    const authStore = useAuthStore();
    scope.run(() =>
      watch(
        () => authStore.isAdmin,
        async (admin) => {
          version.value = null;
          if (!admin) {
            return;
          }
          const status = await systemApi.update().catch(() => null);
          version.value = status?.latest && status.managed ? status.latest.version : null;
        },
        { immediate: true },
      ),
    );
  }
  return version;
}
