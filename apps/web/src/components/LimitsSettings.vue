<template>
  <section class="card">
    <div class="card-head">
      <div class="card-title"><SlidersHorizontal />Environment limits</div>
    </div>

    <div v-if="!view" class="card-body">
      <div v-if="error" class="alert tone-danger">
        <CircleX />
        <div class="alert-body"><span class="alert-title">{{ error }}</span></div>
      </div>
      <div v-else class="flex justify-center py-8"><LoaderCircle class="spinner size-6 text-fg-3" /></div>
    </div>

    <form v-else @submit.prevent="save">
      <div class="card-body flex flex-col gap-6">
        <p class="field-hint max-w-3xl">
          Lifetimes, sleep and quotas apply to every project. Durations read like 72h, 30m or 14d, sizes like 2g or 512m. An empty field goes back to what the
          server sets.
        </p>

        <div v-for="group in GROUPS" :key="group.title" class="flex flex-col gap-3">
          <h3 class="text-sm font-semibold text-fg">{{ group.title }}</h3>
          <div class="grid gap-x-6 gap-y-5 sm:grid-cols-2 2xl:grid-cols-4">
            <div v-for="field in group.fields" :key="field.key" class="field">
              <label class="field-label" :for="`limit-${field.key}`">{{ field.label }}</label>
              <div class="relative">
                <input
                  :id="`limit-${field.key}`"
                  v-model="form[field.key]"
                  class="input pr-10 font-mono"
                  :placeholder="display(field.key, view.defaults[field.key])"
                  :inputmode="field.key === 'envsPerUser' ? 'numeric' : undefined"
                  autocomplete="off"
                  spellcheck="false"
                />
                <button
                  v-if="form[field.key].trim()"
                  type="button"
                  class="btn btn-ghost btn-sm btn-icon absolute right-0.5 top-1/2 -translate-y-1/2"
                  :aria-label="`${field.label}: use the server default`"
                  v-tooltip.top="`Server default: ${display(field.key, view.defaults[field.key])}`"
                  @click="resetToDefault(field.key)"
                >
                  <RotateCcw />
                </button>
              </div>
              <p class="field-hint">
                {{ field.hint }}<template v-if="view.overridden.includes(field.key)"> Server default: {{ display(field.key, view.defaults[field.key]) }}.</template>
              </p>
            </div>
          </div>
        </div>

        <div v-if="error" class="alert tone-danger">
          <CircleX />
          <div class="alert-body"><span class="alert-text">{{ error }}</span></div>
        </div>
      </div>

      <div class="card-foot justify-end">
        <button type="submit" class="btn btn-primary" :disabled="saving"><LoaderCircle v-if="saving" class="spinner" /><Save v-else />Save</button>
      </div>
    </form>
  </section>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { CircleX, LoaderCircle, RotateCcw, Save, SlidersHorizontal } from 'lucide-vue-next';
import { useNotification } from '../composables/useNotification';
import { errorMessage, settingsApi } from '../services/api';
import type { Limits, LimitsView } from '../types';

type Key = keyof Limits;

const GROUPS: { title: string; fields: { key: Key; label: string; hint: string }[] }[] = [
  {
    title: 'Lifetime and sleep',
    fields: [
      { key: 'ttlSeconds', label: 'Lifetime', hint: 'After this, an environment is deleted, unless someone extends it or deploys again.' },
      { key: 'ttlMaxSeconds', label: 'Longest lifetime', hint: 'The most an extension or a ttl in spawner.yaml can ask for.' },
      { key: 'idleSeconds', label: 'Sleep after', hint: 'Without visits or actions this long, an environment stops; the next visit wakes it up. "never" turns sleeping off.' },
      { key: 'envsPerUser', label: 'Environments per person', hint: 'Sleeping ones included. 0 for no limit.' },
    ],
  },
  {
    title: 'Memory and build guards',
    fields: [
      { key: 'envMemoryBytes', label: 'Memory of an environment', hint: 'For all its services, unless spawner.yaml asks for another amount.' },
      { key: 'envMemoryMaxBytes', label: 'Most memory of an environment', hint: 'What limits.memory in spawner.yaml can ask for.' },
      { key: 'buildMinFreeMemoryBytes', label: 'Memory available before a build', hint: 'A build waits up to two minutes for it, then fails. 0 turns the guard off.' },
      { key: 'buildMinFreeDiskBytes', label: 'Disk free before a build', hint: 'A build waits up to two minutes for it, then fails. 0 turns the guard off.' },
    ],
  },
];
const KEYS = GROUPS.flatMap((group) => group.fields.map((field) => field.key));
const GiB = 1024 ** 3;
const MiB = 1024 ** 2;

const { showSuccess } = useNotification();
const view = ref<LimitsView | null>(null);
const form = reactive({} as Record<Key, string>);
const saving = ref(false);
const error = ref('');

/** A limit as an admin types it: 72h, 14d, 30m, 2g, 512m, never. */
function display(key: Key, value: number): string {
  if (key === 'envsPerUser') {
    return String(value);
  }
  if (key.endsWith('Seconds')) {
    if (key === 'idleSeconds' && value === 0) {
      return 'never';
    }
    for (const [unit, size] of [['d', 86_400], ['h', 3600], ['m', 60]] as const) {
      if (value > 0 && value % size === 0) {
        return `${value / size}${unit}`;
      }
    }
    return `${value}s`;
  }
  if (value === 0) {
    return '0';
  }
  if (value % GiB === 0) {
    return `${value / GiB}g`;
  }
  return value % MiB === 0 ? `${value / MiB}m` : String(value);
}

function fill(next: LimitsView) {
  view.value = next;
  KEYS.forEach((key) => (form[key] = next.overridden.includes(key) ? display(key, next.values[key]) : ''));
}

/** Empties a field, which goes back to the server's default once saved, and keeps the focus in it. */
function resetToDefault(key: Key) {
  form[key] = '';
  document.getElementById(`limit-${key}`)?.focus();
}

async function save() {
  if (!view.value) {
    return;
  }
  saving.value = true;
  error.value = '';
  const body: Partial<Record<Key, string | number | null>> = {};
  for (const key of KEYS) {
    const typed = form[key].trim();
    const current = view.value.overridden.includes(key) ? display(key, view.value.values[key]) : '';
    if (typed === current) {
      continue;
    }
    body[key] = typed === '' ? null : key === 'envsPerUser' ? Number(typed) : typed;
  }
  try {
    fill(await settingsApi.updateLimits(body));
    showSuccess('Limits saved: they apply from now on');
  } catch (err) {
    error.value = errorMessage(err, 'The limits could not be saved');
  } finally {
    saving.value = false;
  }
}

onMounted(async () => {
  try {
    fill(await settingsApi.limits());
  } catch (err) {
    error.value = errorMessage(err, 'The limits could not be loaded');
  }
});
</script>
