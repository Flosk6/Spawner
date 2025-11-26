<template>
  <Card>
    <template #title>Git Deploy Key</template>
    <template #content>
      <div v-if="loading" class="flex justify-center py-8">
        <ProgressSpinner />
      </div>

      <div v-else-if="!keyInfo.exists" class="flex flex-col gap-4">
        <p class="opacity-70">No SSH deploy key configured yet.</p>
        <Button
          label="Generate SSH Key"
          icon="pi pi-key"
          @click="handleGenerateKey"
          :loading="generating"
        />
      </div>

      <div v-else class="flex flex-col gap-4">
        <div>
          <label class="font-semibold mb-2 block">Public Key:</label>
          <div class="relative">
            <Textarea
              :model-value="keyInfo.publicKey || ''"
              readonly
              rows="3"
              class="font-mono text-sm"
            />
            <Button
              :label="copied ? 'Copied!' : 'Copy'"
              icon="pi pi-copy"
              severity="secondary"
              size="small"
              @click="copyToClipboard"
              class="absolute top-2 right-2"
            />
          </div>
          <Message severity="info" :closable="false" class="mt-2">
            Add this key as a deploy key (read-only) to your Git repositories.
          </Message>
        </div>

        <div v-if="resources.length > 0">
          <label class="font-semibold mb-2 block">Test Connection:</label>
          <div class="flex gap-2">
            <Select
              v-model="selectedResource"
              :options="resourceOptions"
              optionLabel="label"
              optionValue="value"
              placeholder="Select a resource"
              class="flex-1"
            />
            <Button
              label="Test"
              icon="pi pi-check"
              severity="success"
              @click="handleTestConnection"
              :disabled="!selectedResource"
              :loading="testing"
            />
          </div>
          <Message
            v-if="testResult"
            :severity="testResult.ok ? 'success' : 'error'"
            :closable="false"
            class="mt-2"
          >
            {{ testResult.message }}
          </Message>
        </div>
      </div>

      <Message v-if="error" severity="error" :closable="false" class="mt-4">
        {{ error }}
      </Message>
    </template>
  </Card>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import Card from 'primevue/card';
import Button from 'primevue/button';
import Textarea from 'primevue/textarea';
import Select from 'primevue/select';
import Message from 'primevue/message';
import ProgressSpinner from 'primevue/progressspinner';
import { gitApi, projectApi } from '../services/api';
import type { GitKeyInfo, ProjectResource, GitTestResult } from '../types';
import { useNotification } from '../composables/useNotification';

const { showSuccess } = useNotification();

const keyInfo = ref<GitKeyInfo>({ exists: false, publicKey: null });
const resources = ref<ProjectResource[]>([]);
const loading = ref(true);
const generating = ref(false);
const testing = ref(false);
const copied = ref(false);
const error = ref('');
const selectedResource = ref('');
const testResult = ref<GitTestResult | null>(null);

const resourceOptions = computed(() =>
  resources.value.map(r => ({ label: r.name, value: r.name }))
);

onMounted(async () => {
  await loadKeyInfo();
  await loadResources();
});

async function loadKeyInfo() {
  try {
    loading.value = true;
    keyInfo.value = await gitApi.getKey();
  } catch (err: any) {
    error.value = err.response?.data?.message || 'Failed to load key info';
  } finally {
    loading.value = false;
  }
}

async function loadResources() {
  try {
    const project = await projectApi.getProject();
    resources.value = project.resources.filter(
      r => r.type === 'laravel-api' || r.type === 'nextjs-front'
    );
  } catch (err: any) {
    console.error('Failed to load resources:', err);
  }
}

async function handleGenerateKey() {
  try {
    generating.value = true;
    error.value = '';
    keyInfo.value = await gitApi.generateKey();
    showSuccess('SSH key generated successfully');
  } catch (err: any) {
    error.value = err.response?.data?.message || 'Failed to generate key';
  } finally {
    generating.value = false;
  }
}

async function handleTestConnection() {
  if (!selectedResource.value) return;

  try {
    testing.value = true;
    testResult.value = null;
    testResult.value = await gitApi.testConnection(selectedResource.value);
  } catch (err: any) {
    testResult.value = {
      ok: false,
      message: err.response?.data?.message || 'Test failed',
    };
  } finally {
    testing.value = false;
  }
}

function copyToClipboard() {
  if (keyInfo.value.publicKey) {
    navigator.clipboard.writeText(keyInfo.value.publicKey);
    copied.value = true;
    showSuccess('Public key copied to clipboard');
    setTimeout(() => {
      copied.value = false;
    }, 2000);
  }
}
</script>
