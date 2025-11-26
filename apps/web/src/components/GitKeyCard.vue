<template>
  <div class="bg-white shadow rounded-lg p-6">
    <h2 class="text-xl font-semibold mb-4">Git Deploy Key</h2>

    <div v-if="loading" class="text-gray-600">Loading...</div>

    <div v-else-if="!keyInfo.exists" class="space-y-4">
      <p class="text-gray-600">No SSH deploy key configured yet.</p>
      <button
        @click="handleGenerateKey"
        :disabled="generating"
        class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400"
      >
        {{ generating ? 'Generating...' : 'Generate SSH Key' }}
      </button>
    </div>

    <div v-else class="space-y-4">
      <div>
        <p class="text-sm font-medium text-gray-700 mb-2">Public Key:</p>
        <div class="relative">
          <textarea
            :value="keyInfo.publicKey"
            readonly
            rows="3"
            class="w-full p-2 border rounded bg-gray-50 font-mono text-sm"
          ></textarea>
          <button
            @click="copyToClipboard"
            class="absolute top-2 right-2 px-3 py-1 bg-gray-200 rounded text-sm hover:bg-gray-300"
          >
            {{ copied ? 'Copied!' : 'Copy' }}
          </button>
        </div>
        <p class="mt-2 text-sm text-gray-600">
          Add this key as a deploy key (read-only) to your Git repositories.
        </p>
      </div>

      <div v-if="resources.length > 0">
        <p class="text-sm font-medium text-gray-700 mb-2">Test Connection:</p>
        <div class="flex gap-2">
          <select
            v-model="selectedResource"
            class="flex-1 p-2 border rounded"
          >
            <option value="">Select a resource</option>
            <option
              v-for="resource in resources"
              :key="resource.name"
              :value="resource.name"
            >
              {{ resource.name }}
            </option>
          </select>
          <button
            @click="handleTestConnection"
            :disabled="!selectedResource || testing"
            class="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:bg-gray-400"
          >
            {{ testing ? 'Testing...' : 'Test' }}
          </button>
        </div>
        <div v-if="testResult" class="mt-2">
          <p
            :class="testResult.ok ? 'text-green-600' : 'text-red-600'"
            class="text-sm"
          >
            {{ testResult.message }}
          </p>
        </div>
      </div>
    </div>

    <div v-if="error" class="mt-4 p-3 bg-red-50 border border-red-200 rounded">
      <p class="text-red-800 text-sm">{{ error }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { gitApi, projectApi } from '../services/api';
import type { GitKeyInfo, ProjectResource, GitTestResult } from '../types';

const keyInfo = ref<GitKeyInfo>({ exists: false, publicKey: null });
const resources = ref<ProjectResource[]>([]);
const loading = ref(true);
const generating = ref(false);
const testing = ref(false);
const copied = ref(false);
const error = ref('');
const selectedResource = ref('');
const testResult = ref<GitTestResult | null>(null);

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
    setTimeout(() => {
      copied.value = false;
    }, 2000);
  }
}
</script>
