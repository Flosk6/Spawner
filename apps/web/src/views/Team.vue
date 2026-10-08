<template>
  <div class="max-w-5xl mx-auto space-y-6">
    <div class="flex flex-wrap justify-between items-center gap-4">
      <div>
        <h1 class="text-4xl font-bold mb-2">Team</h1>
        <p class="text-lg opacity-70">Who can use Spawner, and the invitations waiting to be used</p>
      </div>
      <button class="primary-action" @click="inviteDialog = true">
        <i class="pi pi-user-plus text-lg"></i>
        <span class="text-lg">Invite</span>
      </button>
    </div>

    <Message v-if="link" severity="success" :closable="true" @close="link = null">
      <p class="font-semibold mb-2">{{ link.title }} Send this link; it works once, until {{ new Date(link.expiresAt).toLocaleString() }}.</p>
      <div class="flex items-center gap-2">
        <code class="flex-1 break-all text-xs bg-white/60 dark:bg-black/20 rounded px-2 py-1">{{ link.url }}</code>
        <Button icon="pi pi-copy" size="small" text v-tooltip.top="'Copy'" @click="copy(link.url)" />
      </div>
    </Message>

    <section class="panel">
      <h2 class="panel-title"><i class="pi pi-users text-sm"></i>Members</h2>
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="text-left text-xs uppercase text-slate-500">
            <tr>
              <th class="py-2 pr-4">Name</th>
              <th class="py-2 pr-4">Role</th>
              <th class="py-2 pr-4">Logins</th>
              <th class="py-2 pr-4">Environments</th>
              <th class="py-2 pr-4">Last login</th>
              <th></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-200 dark:divide-purple-800/30">
            <tr v-for="member in members" :key="member.id" :class="{ 'opacity-50': !member.isActive }">
              <td class="py-2 pr-4">
                <span class="font-medium">{{ member.name }}</span>
                <span v-if="member.id === authStore.user?.id" class="text-xs text-slate-500"> (you)</span>
                <span v-if="!member.isActive" class="text-xs text-red-500"> deactivated</span>
              </td>
              <td class="py-2 pr-4">
                <Select
                  :key="`${member.id}-${redraws}`"
                  :model-value="member.role"
                  :options="roles"
                  :disabled="!member.isActive"
                  size="small"
                  class="w-32"
                  @update:model-value="(role: Role) => changeRole(member, role)"
                />
              </td>
              <td class="py-2 pr-4 text-xs text-slate-500">
                {{ member.passkeys }} passkey{{ member.passkeys === 1 ? '' : 's' }}<template v-if="member.github"> · GitHub {{ member.github }}</template>
              </td>
              <td class="py-2 pr-4">{{ member.environments }}</td>
              <td class="py-2 pr-4">{{ member.lastLoginAt ? timeAgo(member.lastLoginAt) : 'never' }}</td>
              <td class="py-2 text-right whitespace-nowrap">
                <Button icon="pi pi-key" text rounded v-tooltip.top="'Link for a new passkey'" :disabled="!member.isActive" @click="recovery(member)" />
                <Button
                  :icon="member.isActive ? 'pi pi-ban' : 'pi pi-replay'"
                  :severity="member.isActive ? 'danger' : 'secondary'"
                  text
                  rounded
                  v-tooltip.top="member.isActive ? 'Deactivate' : 'Reactivate'"
                  @click="toggle(member)"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="panel">
      <h2 class="panel-title"><i class="pi pi-envelope text-sm"></i>Pending invitations</h2>
      <p v-if="invites.length === 0" class="text-sm text-slate-500">None.</p>
      <ul v-else class="divide-y divide-slate-200 dark:divide-purple-800/30">
        <li v-for="invite in invites" :key="invite.id" class="flex items-center justify-between gap-3 py-3">
          <div>
            <p class="font-medium">{{ invite.note || (invite.user ? `New passkey for ${invite.user.name}` : `New ${invite.role}`) }}</p>
            <p class="text-xs text-slate-500">
              {{ invite.role }} · by {{ invite.createdBy ?? 'Spawner' }} · expires {{ timeLeft(invite.expiresAt) }}
            </p>
          </div>
          <Button icon="pi pi-times" severity="danger" text rounded v-tooltip.top="'Revoke'" @click="revoke(invite.id)" />
        </li>
      </ul>
    </section>

    <Dialog v-model:visible="inviteDialog" header="Invite someone" modal :style="{ width: '480px' }">
      <form class="space-y-5" @submit.prevent="invite">
        <div>
          <label class="field-label" for="invite-note">Who is it for?</label>
          <InputText id="invite-note" v-model="form.note" class="w-full" placeholder="Grace, QA" />
          <p class="field-hint">A note for the team page; the person picks their own name.</p>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="field-label" for="invite-role">Role</label>
            <Select v-model="form.role" input-id="invite-role" :options="roles" class="w-full" />
          </div>
          <div>
            <label class="field-label" for="invite-hours">Valid for (hours)</label>
            <InputNumber v-model="form.hours" input-id="invite-hours" :min="1" :max="168" class="w-full" />
          </div>
        </div>
        <p class="field-hint">Members manage their own environments; admins manage everything, including projects and the team.</p>
        <div class="flex justify-end gap-2">
          <Button type="button" label="Cancel" severity="secondary" text @click="inviteDialog = false" />
          <Button type="submit" label="Create the link" :loading="saving" />
        </div>
      </form>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import InputNumber from 'primevue/inputnumber';
import InputText from 'primevue/inputtext';
import Message from 'primevue/message';
import Select from 'primevue/select';
import { useNotification } from '../composables/useNotification';
import { errorMessage, invitesApi, usersApi } from '../services/api';
import { useAuthStore } from '../stores/auth';
import type { CreatedInvite, Invite, Role, TeamMember } from '../types';
import { timeAgo, timeLeft } from '../utils/format';

const authStore = useAuthStore();
const { showError, showSuccess, confirmAction } = useNotification();

const roles: Role[] = ['member', 'admin'];
const members = ref<TeamMember[]>([]);
const invites = ref<Invite[]>([]);
const inviteDialog = ref(false);
const saving = ref(false);
const link = ref<(CreatedInvite & { title: string }) | null>(null);
const form = reactive({ note: '', role: 'member' as Role, hours: 24 });
/**
 * Bumped to redraw the role selects: a Select keeps showing the option just
 * picked even though its model did not change, until it is drawn again.
 */
const redraws = ref(0);

async function load() {
  try {
    [members.value, invites.value] = await Promise.all([usersApi.list(), invitesApi.list()]);
  } catch (err) {
    showError(errorMessage(err, 'The team could not be loaded'));
  }
}

async function invite() {
  saving.value = true;
  try {
    const created = await invitesApi.create({ role: form.role, note: form.note.trim() || undefined, ttlHours: form.hours });
    link.value = { ...created, title: `Invitation for ${created.note ?? `a new ${created.role}`} created.` };
    inviteDialog.value = false;
    Object.assign(form, { note: '', role: 'member', hours: 24 });
    await load();
  } catch (err) {
    showError(errorMessage(err, 'The invitation could not be created'));
  } finally {
    saving.value = false;
  }
}

function recovery(member: TeamMember) {
  confirmAction(`Create a link that gives ${member.name} a new passkey? Use it when they lost access.`, async () => {
    try {
      const created = await invitesApi.create({ userId: member.id });
      link.value = { ...created, title: `Link for a new passkey of ${member.name} created.` };
      await load();
    } catch (err) {
      showError(errorMessage(err, 'The link could not be created'));
    }
  });
}

async function update(member: TeamMember, change: { role?: Role; isActive?: boolean }) {
  try {
    await usersApi.update(member.id, change);
    await load();
  } catch (err) {
    showError(errorMessage(err, 'The change could not be saved'));
    await load();
  }
}

/**
 * Asks before changing a role, saying what it grants or takes away. The
 * select goes back to the current role at once: it shows the new one only
 * once the change is confirmed and saved.
 */
function changeRole(member: TeamMember, role: Role) {
  redraws.value++;
  if (role === member.role) {
    return;
  }
  const message =
    role === 'admin'
      ? `Make ${member.name} an admin? They will manage everything: projects, the team, settings, deploy keys, the audit trail and every environment.`
      : `Make ${member.name} a member? They lose projects, the team, settings, deploy keys and the audit trail, and manage only their own environments; their tokens lose the admin scope at once.`;
  confirmAction(message, () => update(member, { role }));
}

function toggle(member: TeamMember) {
  if (!member.isActive) {
    confirmAction(`Reactivate ${member.name}? They can log in again, and their sessions, tokens and preview access that have not expired work again at once.`, () =>
      update(member, { isActive: true }),
    );
    return;
  }
  confirmAction(`Deactivate ${member.name}? Their sessions, tokens and preview access stop at once.`, () => update(member, { isActive: false }));
}

function revoke(id: string) {
  confirmAction('Revoke this invitation? Its link stops working.', async () => {
    try {
      await invitesApi.revoke(id);
      await load();
    } catch (err) {
      showError(errorMessage(err, 'The invitation could not be revoked'));
    }
  });
}

async function copy(value: string) {
  await navigator.clipboard.writeText(value);
  showSuccess('Copied');
}

onMounted(load);
</script>
