import { createRouter, createWebHistory } from 'vue-router';
import { setBreadcrumbs, type Crumb } from '../composables/useBreadcrumbs';
import { useAuthStore } from '../stores/auth';
import Account from '../views/Account.vue';
import Audit from '../views/Audit.vue';
import DeviceApproval from '../views/DeviceApproval.vue';
import Home from '../views/Home.vue';
import InviteAccept from '../views/InviteAccept.vue';
import Settings from '../views/Settings.vue';
import Team from '../views/Team.vue';
import ProjectList from '../views/ProjectList.vue';
import ProjectDetail from '../views/ProjectDetail.vue';
import EnvironmentList from '../views/EnvironmentList.vue';
import EnvironmentDetail from '../views/EnvironmentDetail.vue';
import SystemOverview from '../views/SystemOverview.vue';
import GitSettings from '../views/GitSettings.vue';
import Login from '../views/Login.vue';

declare module 'vue-router' {
  interface RouteMeta {
    requiresAuth?: boolean;
    requiresAdmin?: boolean;
    /** The trail of the top bar; a page that loads its subject sets its own with setBreadcrumbs. */
    crumbs?: Crumb[];
    /** "focus": a page on its own, without the sidebar (sign-in, the CLI approval). */
    layout?: 'focus';
  }
}

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      name: 'Login',
      component: Login,
      meta: { requiresAuth: false, layout: 'focus' },
    },
    {
      path: '/invite/:token',
      name: 'InviteAccept',
      component: InviteAccept,
      meta: { requiresAuth: false, layout: 'focus' },
    },
    {
      path: '/device',
      name: 'DeviceApproval',
      component: DeviceApproval,
      meta: { requiresAuth: true, layout: 'focus' },
    },
    {
      path: '/account',
      name: 'Account',
      component: Account,
      meta: { requiresAuth: true, crumbs: [{ label: 'Account' }] },
    },
    {
      path: '/team',
      name: 'Team',
      component: Team,
      meta: { requiresAuth: true, requiresAdmin: true, crumbs: [{ label: 'Team' }] },
    },
    {
      path: '/system/settings',
      name: 'Settings',
      component: Settings,
      meta: { requiresAuth: true, requiresAdmin: true, crumbs: [{ label: 'Settings' }] },
    },
    {
      path: '/system/audit',
      name: 'Audit',
      component: Audit,
      meta: { requiresAuth: true, requiresAdmin: true, crumbs: [{ label: 'Audit' }] },
    },
    {
      path: '/',
      redirect: '/home',
    },
    {
      path: '/home',
      name: 'Home',
      component: Home,
      meta: { requiresAuth: true, crumbs: [{ label: 'Overview' }] },
    },
    {
      path: '/system/overview',
      name: 'SystemOverview',
      component: SystemOverview,
      meta: { requiresAuth: true, requiresAdmin: true, crumbs: [{ label: 'System' }] },
    },
    {
      path: '/system/settings/git',
      name: 'GitSettings',
      component: GitSettings,
      meta: { requiresAuth: true, requiresAdmin: true, crumbs: [{ label: 'Git keys' }] },
    },
    {
      path: '/projects',
      name: 'ProjectList',
      component: ProjectList,
      meta: { requiresAuth: true, crumbs: [{ label: 'Projects' }] },
    },
    {
      path: '/projects/:slug',
      name: 'ProjectDetail',
      component: ProjectDetail,
      meta: { requiresAuth: true, crumbs: [{ label: 'Projects', to: '/projects' }] },
    },
    {
      path: '/environments',
      name: 'EnvironmentList',
      component: EnvironmentList,
      meta: { requiresAuth: true, crumbs: [{ label: 'Environments' }] },
    },
    {
      path: '/environments/:id',
      name: 'EnvironmentDetail',
      component: EnvironmentDetail,
      meta: { requiresAuth: true, crumbs: [{ label: 'Environments', to: '/environments' }] },
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: '/home',
    },
  ],
});

router.beforeEach(async (to) => {
  const authStore = useAuthStore();

  if (authStore.user === null) {
    await authStore.checkAuth();
  }

  if (to.meta.requiresAuth !== false && !authStore.isAuthenticated) {
    // Back to the page asked for once logged in.
    return { name: 'Login', query: to.fullPath === '/' || to.fullPath === '/home' ? {} : { next: to.fullPath } };
  }
  if (to.meta.requiresAdmin && !authStore.isAdmin) {
    return { name: 'Home' };
  }
  return true;
});

router.afterEach((to, from) => {
  if (to.path !== from.path) {
    setBreadcrumbs(null);
  }
});

export default router;
