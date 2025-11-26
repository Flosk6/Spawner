<template>
  <div class="bg-white shadow rounded-lg p-6">
    <div class="flex justify-between items-center mb-4">
      <h2 class="text-xl font-semibold">Environments</h2>
      <router-link
        to="/environments/new"
        class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
      >
        Create Environment
      </router-link>
    </div>

    <div v-if="loading" class="text-gray-600">Loading environments...</div>

    <div v-else-if="environments.length === 0" class="text-gray-600">
      No environments created yet.
    </div>

    <div v-else class="overflow-x-auto">
      <table class="min-w-full divide-y divide-gray-200">
        <thead>
          <tr>
            <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
              Name
            </th>
            <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
              Status
            </th>
            <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
              Created
            </th>
            <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
              Branches
            </th>
            <th class="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
              Actions
            </th>
          </tr>
        </thead>
        <tbody class="bg-white divide-y divide-gray-200">
          <tr v-for="env in environments" :key="env.id">
            <td class="px-4 py-3 whitespace-nowrap font-medium text-gray-900">
              {{ env.name }}
            </td>
            <td class="px-4 py-3 whitespace-nowrap">
              <span
                :class="getStatusClass(env.status)"
                class="px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full"
              >
                {{ env.status }}
              </span>
            </td>
            <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
              {{ formatDate(env.createdAt) }}
            </td>
            <td class="px-4 py-3 text-sm text-gray-500">
              <div class="max-w-xs truncate">
                {{ formatBranches(env.branches) }}
              </div>
            </td>
            <td class="px-4 py-3 whitespace-nowrap text-right text-sm font-medium">
              <router-link
                :to="`/environments/${env.id}`"
                class="text-blue-600 hover:text-blue-900 mr-4"
              >
                View
              </router-link>
              <button
                @click="handleDelete(env)"
                class="text-red-600 hover:text-red-900"
              >
                Delete
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="error" class="mt-4 p-3 bg-red-50 border border-red-200 rounded">
      <p class="text-red-800 text-sm">{{ error }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { environmentApi } from '../services/api';
import type { Environment } from '../types';

const environments = ref<Environment[]>([]);
const loading = ref(true);
const error = ref('');

onMounted(async () => {
  await loadEnvironments();
});

async function loadEnvironments() {
  try {
    loading.value = true;
    error.value = '';
    environments.value = await environmentApi.getAll();
  } catch (err: any) {
    error.value = err.response?.data?.message || 'Failed to load environments';
  } finally {
    loading.value = false;
  }
}

async function handleDelete(env: Environment) {
  if (!confirm(`Are you sure you want to delete environment "${env.name}"?`)) {
    return;
  }

  try {
    await environmentApi.delete(env.id);
    await loadEnvironments();
  } catch (err: any) {
    error.value = err.response?.data?.message || 'Failed to delete environment';
  }
}

function getStatusClass(status: string): string {
  switch (status) {
    case 'running':
      return 'bg-green-100 text-green-800';
    case 'creating':
      return 'bg-blue-100 text-blue-800';
    case 'failed':
      return 'bg-red-100 text-red-800';
    case 'deleting':
      return 'bg-yellow-100 text-yellow-800';
    default:
      return 'bg-gray-100 text-gray-800';
  }
}

function formatDate(dateStr: string | Date): string {
  const date = typeof dateStr === 'string' ? new Date(dateStr) : dateStr;
  return date.toLocaleString();
}

function formatBranches(branches?: Record<string, string>): string {
  if (!branches) return '';
  return Object.entries(branches)
    .map(([name, branch]) => `${name}: ${branch}`)
    .join(', ');
}
</script>
