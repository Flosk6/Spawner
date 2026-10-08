import { ref } from 'vue';
import { systemApi } from '../services/api';
import type { ServerInfo } from '../types';

const info = ref<ServerInfo | null>(null);
let pending: Promise<void> | null = null;

/** The version and domain of this server, asked once and shared by every component. */
export function useServerInfo() {
  pending ??= systemApi
    .info()
    .then((value) => {
      info.value = value;
    })
    .catch(() => {
      pending = null;
    });
  return info;
}
