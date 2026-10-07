import { createRouter, createWebHistory } from 'vue-router';
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

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      name: 'Login',
      component: Login,
      meta: { requiresAuth: false },
    },
    {
      path: '/invite/:token',
      name: 'InviteAccept',
      component: InviteAccept,
      meta: { requiresAuth: false },
    },
    {
      path: '/device',
      name: 'DeviceApproval',
      component: DeviceApproval,
      meta: { requiresAuth: true },
    },
    {
      path: '/account',
      name: 'Account',
      component: Account,
      meta: { requiresAuth: true },
    },
    {
      path: '/team',
      name: 'Team',
      component: Team,
      meta: { requiresAuth: true, requiresAdmin: true },
    },
    {
      path: '/system/settings',
      name: 'Settings',
      component: Settings,
      meta: { requiresAuth: true, requiresAdmin: true },
    },
    {
      path: '/system/audit',
      name: 'Audit',
      component: Audit,
      meta: { requiresAuth: true, requiresAdmin: true },
    },
    {
      path: '/',
      redirect: '/home',
    },
    {
      path: '/home',
      name: 'Home',
      component: Home,
      meta: { requiresAuth: true },
    },
    {
      path: '/system/overview',
      name: 'SystemOverview',
      component: SystemOverview,
      meta: { requiresAuth: true, requiresAdmin: true },
    },
    {
      path: '/system/settings/git',
      name: 'GitSettings',
      component: GitSettings,
      meta: { requiresAuth: true, requiresAdmin: true },
    },
    {
      path: '/projects',
      name: 'ProjectList',
      component: ProjectList,
      meta: { requiresAuth: true },
    },
    {
      path: '/projects/:slug',
      name: 'ProjectDetail',
      component: ProjectDetail,
      meta: { requiresAuth: true },
    },
    {
      path: '/environments',
      name: 'EnvironmentList',
      component: EnvironmentList,
      meta: { requiresAuth: true },
    },
    {
      path: '/environments/:id',
      name: 'EnvironmentDetail',
      component: EnvironmentDetail,
      meta: { requiresAuth: true },
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

export default router;
