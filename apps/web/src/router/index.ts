import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import Home from '../views/Home.vue';
import ProjectList from '../views/ProjectList.vue';
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
      meta: { requiresAuth: true },
    },
    {
      path: '/system/settings/git',
      name: 'GitSettings',
      component: GitSettings,
      meta: { requiresAuth: true },
    },
    {
      path: '/projects',
      name: 'ProjectList',
      component: ProjectList,
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

router.beforeEach(async (to, _from, next) => {
  const authStore = useAuthStore();

  if (authStore.user === null) {
    await authStore.checkAuth();
  }

  const requiresAuth = to.meta.requiresAuth !== false;

  if (requiresAuth && !authStore.isAuthenticated) {
    // Redirect to login if route requires auth and user is not authenticated
    next({ name: 'Login' });
  } else if (to.name === 'Login' && authStore.isAuthenticated) {
    // Redirect to environments if user is authenticated and tries to access login
    next({ name: 'EnvironmentList' });
  } else {
    next();
  }
});

export default router;
