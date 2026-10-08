<template>
  <div class="page-head">
    <div>
      <h1 class="page-title">Team</h1>
      <p class="page-lead">Who can use Spawner, and the invitations waiting to be used.</p>
    </div>
    <div class="page-actions">
      <button type="button" class="btn btn-primary" @click="inviteDialog = true"><UserPlus />Invite</button>
    </div>
  </div>

  <div v-if="link" class="alert tone-ok">
    <CircleCheck />
    <div class="alert-body gap-2">
      <div class="flex items-start justify-between gap-2">
        <div class="flex min-w-0 flex-col gap-0.5">
          <span class="alert-title">{{ link.title }}</span>
          <span class="alert-text">Send this link: it works once, until {{ new Date(link.expiresAt).toLocaleString() }}. It is not shown again.</span>
        </div>
        <button type="button" class="btn btn-ghost btn-sm btn-icon -mr-1 -mt-1" aria-label="Dismiss" @click="link = null"><X /></button>
      </div>
      <div class="cmd">
        <span class="cmd-text">{{ link.url }}</span>
        <button type="button" class="btn btn-ghost btn-sm btn-icon" aria-label="Copy the link" v-tooltip.top="'Copy'" @click="copy(link.url)"><Copy /></button>
      </div>
    </div>
  </div>

  <div v-if="loading" class="flex justify-center py-16"><LoaderCircle class="spinner size-6 text-fg-3" /></div>

  <template v-else>
    <section class="card">
      <div class="card-head is-flush">
        <div class="card-title"><Users />Members<span class="count">{{ members.length }}</span></div>
      </div>
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>Member</th>
              <th>Role</th>
              <th class="hidden sm:table-cell">Status</th>
              <th class="hidden lg:table-cell">Logins</th>
              <th class="hidden md:table-cell">Environments</th>
              <th class="hidden md:table-cell">Last login</th>
              <th><span class="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="member in members" :key="member.id">
              <td class="max-w-[18rem]">
                <div class="flex min-w-0 items-center gap-2.5">
                  <UserAvatar :user="member" :class="{ 'opacity-50': !member.isActive }" />
                  <div class="min-w-0">
                    <div class="flex min-w-0 items-center gap-1.5">
                      <span class="row-title" :class="{ 'text-fg-3': !member.isActive }">{{ member.name }}</span>
                      <span v-if="member.id === authStore.user?.id" class="badge badge-sm">You</span>
                    </div>
                    <div v-if="!member.isActive" class="row-sub text-danger-text sm:hidden">Deactivated</div>
                    <p class="mt-0.5 text-xs text-fg-3 lg:hidden">
                      {{ member.passkeys }} passkey{{ member.passkeys === 1 ? '' : 's' }}{{ member.github ? `, GitHub ${member.github}` : '' }}<span class="md:hidden">,
                        {{ member.environments }} environment{{ member.environments === 1 ? '' : 's' }}, last login
                        {{ member.lastLoginAt ? timeAgo(member.lastLoginAt) : 'never' }}</span>
                    </p>
                  </div>
                </div>
              </td>
              <td>
                <span class="badge badge-sm" :class="{ 'tone-accent': member.role === 'admin' }">{{ ROLE_LABELS[member.role] }}</span>
              </td>
              <td class="hidden sm:table-cell">
                <span class="inline-flex items-center gap-1.5 whitespace-nowrap" :class="member.isActive ? 'text-fg-2' : 'text-danger-text'">
                  <span class="dot" :class="member.isActive ? 'tone-ok' : 'tone-danger'"></span>{{ member.isActive ? 'Active' : 'Deactivated' }}
                </span>
              </td>
              <td class="hidden whitespace-nowrap text-fg-2 lg:table-cell">
                {{ member.passkeys }} passkey{{ member.passkeys === 1 ? '' : 's' }}<span v-if="member.github" class="text-fg-3"> · GitHub {{ member.github }}</span>
              </td>
              <td class="hidden tabular-nums text-fg-2 md:table-cell">{{ member.environments }}</td>
              <td
                class="hidden whitespace-nowrap text-fg-2 md:table-cell"
                :title="member.lastLoginAt ? new Date(member.lastLoginAt).toLocaleString() : undefined"
              >
                {{ member.lastLoginAt ? timeAgo(member.lastLoginAt) : 'Never' }}
              </td>
              <td class="cell-actions">
                <button type="button" class="btn btn-ghost btn-sm btn-icon" :aria-label="`Actions for ${member.name}`" @click="openMenu($event, member)">
                  <Ellipsis />
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="card">
      <div class="card-head is-flush">
        <div class="card-title"><Mail />Pending invitations<span class="count">{{ invites.length }}</span></div>
      </div>
      <div class="list">
        <div v-if="invites.length === 0" class="list-row text-fg-3">No pending invitation.</div>
        <div v-for="invite in invites" :key="invite.id" class="list-row">
          <div class="svc-icon"><KeyRound v-if="invite.user" /><Mail v-else /></div>
          <div class="list-main">
            <div class="list-title"><span class="truncate">{{ inviteTitle(invite) }}</span></div>
            <div class="list-sub flex-wrap whitespace-normal">
              <span>{{ ROLE_LABELS[invite.role] }}</span>
              <span aria-hidden="true">·</span>
              <span>by {{ invite.createdBy ?? 'Spawner' }}</span>
              <span aria-hidden="true">·</span>
              <span class="whitespace-nowrap">expires {{ timeLeft(invite.expiresAt) }}</span>
            </div>
          </div>
          <button type="button" class="btn btn-ghost btn-sm" @click="revoke(invite.id)">Revoke</button>
        </div>
      </div>
    </section>
  </template>

  <ActionMenu ref="rowMenu" :items="menuItems" />

  <Dialog v-model:visible="inviteDialog" header="Invite someone" modal :style="{ width: 'min(30rem, calc(100vw - 2rem))' }">
    <form id="invite-form" class="flex flex-col gap-4" @submit.prevent="invite">
      <div class="field">
        <label class="field-label" for="invite-note">Who is it for?</label>
        <input id="invite-note" v-model="form.note" class="input" placeholder="Grace, QA" autocomplete="off" />
        <p class="field-hint">A note for the team page; the person picks their own name.</p>
      </div>
      <div class="grid gap-4 sm:grid-cols-2">
        <div class="field">
          <label class="field-label" for="invite-role">Role</label>
          <Select v-model="form.role" input-id="invite-role" :options="ROLE_OPTIONS" option-label="label" option-value="value" class="w-full" />
        </div>
        <div class="field">
          <label class="field-label" for="invite-hours">Valid for (hours)</label>
          <InputNumber v-model="form.hours" input-id="invite-hours" :min="1" :max="168" fluid />
        </div>
      </div>
      <p class="field-hint">Members manage their own environments; admins manage everything, including projects and the team.</p>
    </form>

    <template #footer>
      <button type="button" class="btn btn-ghost" @click="inviteDialog = false">Cancel</button>
      <button type="submit" form="invite-form" class="btn btn-primary" :disabled="saving"><LoaderCircle v-if="saving" class="spinner" /><Link v-else />Create the link</button>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import Dialog from 'primevue/dialog';
import InputNumber from 'primevue/inputnumber';
import Select from 'primevue/select';
import { CircleCheck, Copy, Ellipsis, KeyRound, Link, LoaderCircle, Mail, ShieldCheck, UserCheck, UserPlus, UserRound, UserX, Users, X } from 'lucide-vue-next';
import ActionMenu, { type MenuAction } from '../components/ActionMenu.vue';
import UserAvatar from '../components/UserAvatar.vue';
import { useNotification } from '../composables/useNotification';
import { errorMessage, invitesApi, usersApi } from '../services/api';
import { useAuthStore } from '../stores/auth';
import type { CreatedInvite, Invite, Role, TeamMember } from '../types';
import { timeAgo, timeLeft } from '../utils/format';

const ROLE_LABELS: Record<Role, string> = { member: 'Member', admin: 'Admin' };
const ROLE_OPTIONS = (['member', 'admin'] as Role[]).map((role) => ({ label: ROLE_LABELS[role], value: role }));

const authStore = useAuthStore();
const { showError, showSuccess, confirmAction } = useNotification();

const members = ref<TeamMember[]>([]);
const invites = ref<Invite[]>([]);
const loading = ref(true);
const inviteDialog = ref(false);
const saving = ref(false);
const link = ref<(CreatedInvite & { title: string }) | null>(null);
const form = reactive({ note: '', role: 'member' as Role, hours: 24 });
const rowMenu = ref<InstanceType<typeof ActionMenu> | null>(null);
const menuFor = ref<TeamMember | null>(null);

/** Role change, passkey link and deactivation of the member whose menu is open; only reactivation for a deactivated one. */
const menuItems = computed<MenuAction[]>(() => {
  const member = menuFor.value;
  if (!member) {
    return [];
  }
  const roleChange: MenuAction =
    member.role === 'admin'
      ? { label: 'Make member', icon: UserRound, hint: 'own environments only', disabled: !member.isActive, command: () => changeRole(member, 'member') }
      : { label: 'Make admin', icon: ShieldCheck, hint: 'manages everything', disabled: !member.isActive, command: () => changeRole(member, 'admin') };
  return [
    roleChange,
    { label: 'Link for a new passkey', icon: KeyRound, disabled: !member.isActive, command: () => recovery(member) },
    { separator: true },
    member.isActive
      ? { label: 'Deactivate', icon: UserX, danger: true, command: () => toggle(member) }
      : { label: 'Reactivate', icon: UserCheck, command: () => toggle(member) },
  ];
});

function openMenu(event: Event, member: TeamMember) {
  menuFor.value = member;
  rowMenu.value?.toggle(event);
}

function inviteTitle(invite: Invite): string {
  return invite.note || (invite.user ? `New passkey for ${invite.user.name}` : `New ${invite.role}`);
}

async function load() {
  try {
    [members.value, invites.value] = await Promise.all([usersApi.list(), invitesApi.list()]);
  } catch (err) {
    showError(errorMessage(err, 'The team could not be loaded'));
  } finally {
    loading.value = false;
  }
}

async function invite() {
  saving.value = true;
  try {
    const created = await invitesApi.create({ role: form.role, note: form.note.trim() || undefined, ttlHours: form.hours });
    link.value = { ...created, title: `Invitation for ${created.note ?? `a new ${created.role}`} created` };
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
  confirmAction(
    'This creates a link that adds a passkey to their account. Use it when they lost access.',
    async () => {
      try {
        const created = await invitesApi.create({ userId: member.id });
        link.value = { ...created, title: `Link for a new passkey created for ${member.name}` };
        await load();
      } catch (err) {
        showError(errorMessage(err, 'The link could not be created'));
      }
    },
    { header: `Give ${member.name} a new passkey?`, acceptLabel: 'Create the link' },
  );
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

/** Asks before changing a role, saying what it grants or takes away. */
function changeRole(member: TeamMember, role: Role) {
  if (role === member.role) {
    return;
  }
  const message =
    role === 'admin'
      ? 'They will manage everything: projects, the team, settings, deploy keys, the audit trail and every environment.'
      : 'They lose projects, the team, settings, deploy keys and the audit trail, and manage only their own environments; their tokens lose the admin scope at once.';
  confirmAction(message, () => update(member, { role }), {
    header: role === 'admin' ? `Make ${member.name} an admin?` : `Make ${member.name} a member?`,
    acceptLabel: role === 'admin' ? 'Make admin' : 'Make member',
  });
}

function toggle(member: TeamMember) {
  if (!member.isActive) {
    confirmAction(
      'They can log in again, and their sessions, tokens and preview access that have not expired work again at once.',
      () => update(member, { isActive: true }),
      { header: `Reactivate ${member.name}?`, acceptLabel: 'Reactivate' },
    );
    return;
  }
  confirmAction('Their sessions, tokens and preview access stop at once.', () => update(member, { isActive: false }), {
    header: `Deactivate ${member.name}?`,
    acceptLabel: 'Deactivate',
    danger: true,
  });
}

function revoke(id: string) {
  confirmAction(
    'Its link stops working.',
    async () => {
      try {
        await invitesApi.revoke(id);
        await load();
      } catch (err) {
        showError(errorMessage(err, 'The invitation could not be revoked'));
      }
    },
    { header: 'Revoke this invitation?', acceptLabel: 'Revoke', danger: true },
  );
}

async function copy(value: string) {
  await navigator.clipboard.writeText(value);
  showSuccess('Copied');
}

onMounted(load);
</script>
