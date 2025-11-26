<template>
  <div class="space-y-6">
    <h1 class="text-3xl font-bold text-gray-900">Dashboard</h1>

    <GitKeyCard />
    <EnvironmentList />
  </div>
</template>

<script setup lang="ts">
import GitKeyCard from '../components/GitKeyCard.vue';
import EnvironmentList from '../components/EnvironmentList.vue';
</script>
