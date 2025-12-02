<template>
  <Card>
    <template #title>
      <div class="flex justify-between items-center">
        <span>Environments</span>
        <Button
          label="Create Environment"
          icon="pi pi-plus"
          @click="$router.push('/environments/new')"
        />
      </div>
    </template>
    <template #content>
      <div v-if="loading" class="flex justify-center py-8">
        <ProgressSpinner />
      </div>

      <div v-else-if="environments.length === 0" class="text-center py-8 opacity-70">
        No environments created yet.
      </div>

      <DataTable v-else :value="environments" stripedRows responsiveLayout="scroll">
        <Column field="name" header="Name" sortable style="min-width: 200px">
          <template #body="{ data }: { data: Environment }">
            <span class="font-semibold">{{ data.name }}</span>
          </template>
        </Column>

        <Column field="status" header="Status" sortable style="min-width: 120px">
          <template #body="{ data }: { data: Environment }">
            <Tag
              :value="data.status"
              :severity="getStatusSeverity(data.status)"
              :icon="getStatusIcon(data.status)"
            />
          </template>
        </Column>

        <Column field="createdAt" header="Created" sortable style="min-width: 180px">
          <template #body="{ data }: { data: Environment }">
            <span class="opacity-70">{{ formatDate(data.createdAt) }}</span>
          </template>
        </Column>

        <Column header="Actions" style="min-width: 150px">
          <template #body="{ data }: { data: Environment }">
            <div class="flex gap-2">
              <Button
                icon="pi pi-eye"
                severity="info"
                outlined
                rounded
                @click="$router.push(`/environments/${data.id}`)"
                v-tooltip.top="'View Details'"
              />
              <Button
                icon="pi pi-trash"
                severity="danger"
                outlined
                rounded
                @click="confirmDelete(data)"
                v-tooltip.top="'Delete'"
              />
            </div>
          </template>
        </Column>
      </DataTable>

      <Message v-if="error" severity="error" :closable="false" class="mt-4">
        {{ error }}
      </Message>
    </template>
  </Card>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import Card from 'primevue/card';
import Button from 'primevue/button';
import DataTable from 'primevue/datatable';
import Column from 'primevue/column';
import Tag from 'primevue/tag';
import Message from 'primevue/message';
import ProgressSpinner from 'primevue/progressspinner';
import { environmentApi } from '../services/api';
import type { Environment } from '../types';
import { useNotification } from '../composables/useNotification';

const { showSuccess, showError, confirmDelete: confirmDeleteDialog } = useNotification();

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

function confirmDelete(env: Environment) {
  confirmDeleteDialog(env.name, () => handleDelete(env));
}

async function handleDelete(env: Environment) {
  try {
    await environmentApi.delete(env.id);
    showSuccess(`Environment "${env.name}" deleted successfully`);
    await loadEnvironments();
  } catch (err: any) {
    showError(err.response?.data?.message || 'Failed to delete environment');
  }
}

function getStatusSeverity(status: string): string {
  switch (status) {
    case 'running':
      return 'success';
    case 'creating':
      return 'info';
    case 'updating':
      return 'info';
    case 'failed':
      return 'danger';
    case 'deleting':
      return 'warning';
    case 'paused':
      return 'warning';
    default:
      return 'secondary';
  }
}

function getStatusIcon(status: string): string {
  switch (status) {
    case 'running':
      return 'pi pi-check-circle';
    case 'creating':
      return 'pi pi-spin pi-spinner';
    case 'updating':
      return 'pi pi-spin pi-spinner';
    case 'failed':
      return 'pi pi-times-circle';
    case 'deleting':
      return 'pi pi-spin pi-spinner';
    case 'paused':
      return 'pi pi-pause-circle';
    default:
      return 'pi pi-circle';
  }
}

function formatDate(dateStr: string | Date): string {
  const date = typeof dateStr === 'string' ? new Date(dateStr) : dateStr;
  return date.toLocaleString();
}
</script>
