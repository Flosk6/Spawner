<template>
  <div class="min-h-screen bg-gray-900 flex items-center justify-center px-4">
    <div class="max-w-md w-full space-y-8">
      <div class="text-center">
        <div class="flex justify-center mb-4">
          <Logo size="xl" :show-text="false" />
        </div>
        <h1 class="text-4xl font-bold mb-2" style="color: #574B89">
          Spawner
        </h1>
        <p class="text-gray-400">Preview Environment Manager</p>
      </div>

      <Card class="shadow-2xl">
        <template #content>
          <div class="space-y-6">
            <Message v-if="error" severity="error" :closable="false">
              {{ error }}
            </Message>

            <Button
              label="Login with GitHub"
              icon="pi pi-github"
              class="w-full"
              size="large"
              :loading="loading"
              @click="handleLogin"
            />

            <Divider />

            <div class="text-center">
              <p class="text-gray-400 text-sm">
                Access restricted to members of your<br>
                GitHub organization team
              </p>
            </div>
          </div>
        </template>
      </Card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import Card from 'primevue/card';
import Button from 'primevue/button';
import Message from 'primevue/message';
import Divider from 'primevue/divider';
import Logo from '../components/Logo.vue';

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();

const loading = ref(false);
const error = ref<string | null>(null);

onMounted(async () => {
  // Check if user is already authenticated
  await authStore.checkAuth();
  if (authStore.isAuthenticated) {
    router.push('/');
  }

  // Check for error in URL query params
  if (route.query.error) {
    error.value = decodeURIComponent(route.query.error as string);
  }
});

function handleLogin() {
  loading.value = true;
  authStore.loginWithGithub();
}
</script>

<style scoped>
:deep(.p-card) {
  background-color: #1f2937;
  border: 1px solid #374151;
}

:deep(.p-card .p-card-content) {
  padding: 2rem;
}

:deep(.p-button.pi-github:before) {
  content: "\e95a";
}
</style>
