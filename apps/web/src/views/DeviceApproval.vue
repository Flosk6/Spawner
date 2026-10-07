<template>
  <div class="max-w-lg mx-auto">
    <h1 class="text-3xl font-bold mb-2">Log in the CLI</h1>
    <p class="opacity-70 mb-8">Enter the code your terminal shows. Approving it gives the CLI a token with your rights.</p>

    <div class="panel space-y-5">
      <form v-if="!request && !done" class="space-y-4" @submit.prevent="lookUp">
        <div>
          <label class="field-label" for="device-code">Code</label>
          <InputText id="device-code" v-model="code" class="w-full font-mono text-2xl tracking-widest uppercase" placeholder="BCDF-GHJK" autocomplete="off" />
        </div>
        <Message v-if="error" severity="error" :closable="false">{{ error }}</Message>
        <Button type="submit" label="Continue" :loading="loading" :disabled="code.replace(/[^a-zA-Z]/g, '').length !== 8" />
      </form>

      <template v-else-if="request && !done">
        <div class="space-y-2">
          <p>
            <span class="font-semibold">{{ request.clientName }}</span> asks to act as you on Spawner, with these scopes:
          </p>
          <div class="flex flex-wrap gap-2">
            <span v-for="scope in request.scopes" :key="scope" class="px-2 py-1 rounded bg-slate-100 dark:bg-dark-700 font-mono text-xs">{{ scope }}</span>
          </div>
          <p class="field-hint">Code {{ request.userCode }}. Only approve a login you started yourself, just now.</p>
        </div>
        <Message v-if="error" severity="error" :closable="false">{{ error }}</Message>
        <div class="flex gap-2">
          <Button label="Approve" icon="pi pi-check" :loading="loading" @click="decide(true)" />
          <Button label="Deny" icon="pi pi-times" severity="secondary" outlined :disabled="loading" @click="decide(false)" />
        </div>
      </template>

      <Message v-else :severity="done === 'approved' ? 'success' : 'info'" :closable="false">
        {{ done === 'approved' ? 'Approved. The CLI receives its token within seconds; you can close this page.' : 'Denied. The CLI login was refused.' }}
      </Message>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import Message from 'primevue/message';
import { deviceApi, errorMessage } from '../services/api';
import type { DeviceRequest } from '../types';

const route = useRoute();
const code = ref(typeof route.query.code === 'string' ? route.query.code : '');
const request = ref<DeviceRequest | null>(null);
const done = ref<'approved' | 'denied' | null>(null);
const loading = ref(false);
const error = ref('');

async function lookUp() {
  loading.value = true;
  error.value = '';
  try {
    request.value = await deviceApi.describe(code.value.trim());
  } catch (err) {
    error.value = errorMessage(err, 'This code is unknown or expired');
  } finally {
    loading.value = false;
  }
}

async function decide(approve: boolean) {
  if (!request.value) {
    return;
  }
  loading.value = true;
  error.value = '';
  try {
    done.value = (await deviceApi.decide(request.value.userCode, approve)).status === 'approved' ? 'approved' : 'denied';
  } catch (err) {
    error.value = errorMessage(err, 'The decision could not be saved');
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  if (code.value) {
    lookUp();
  }
});
</script>
