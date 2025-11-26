import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import Dashboard from '../views/Dashboard.vue';
import ProjectList from '../views/ProjectList.vue';
import ProjectForm from '../views/ProjectForm.vue';
import EnvironmentList from '../views/EnvironmentList.vue';
import EnvironmentNew from '../views/EnvironmentNew.vue';
import EnvironmentDetail from '../views/EnvironmentDetail.vue';
import GitSettings from '../views/GitSettings.vue';
import SystemSettings from '../views/SystemSettings.vue';
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
      redirect: '/projects',
    },
    {
      path: '/dashboard',
      name: 'Dashboard',
      component: Dashboard,
      meta: { requiresAuth: true },
    },
    {
      path: '/settings/git',
      name: 'GitSettings',
      component: GitSettings,
      meta: { requiresAuth: true },
    },
    {
      path: '/settings/system',
      name: 'SystemSettings',
      component: SystemSettings,
      meta: { requiresAuth: true },
    },
    {
      path: '/projects',
      name: 'ProjectList',
      component: ProjectList,
      meta: { requiresAuth: true },
    },
    {
      path: '/projects/new',
      name: 'ProjectNew',
      component: ProjectForm,
      meta: { requiresAuth: true },
    },
    {
      path: '/projects/:id',
      name: 'ProjectEdit',
      component: ProjectForm,
      meta: { requiresAuth: true },
    },
    {
      path: '/projects/:projectId/environments',
      name: 'EnvironmentList',
      component: EnvironmentList,
      meta: { requiresAuth: true },
    },
    {
      path: '/projects/:projectId/environments/new',
      name: 'EnvironmentNew',
      component: EnvironmentNew,
      meta: { requiresAuth: true },
    },
    {
      path: '/environments/:id',
      name: 'EnvironmentDetail',
      component: EnvironmentDetail,
      meta: { requiresAuth: true },
    },
  ],
});

router.beforeEach(async (to, _from, next) => {
  const authStore = useAuthStore();

  // Check authentication status if not already checked
  if (authStore.user === null && !authStore.loading) {
    await authStore.checkAuth();
  }

  const requiresAuth = to.meta.requiresAuth !== false;

  if (requiresAuth && !authStore.isAuthenticated) {
    // Redirect to login if route requires auth and user is not authenticated
    next({ name: 'Login' });
  } else if (to.name === 'Login' && authStore.isAuthenticated) {
    // Redirect to dashboard if user is authenticated and tries to access login
    next({ name: 'ProjectList' });
  } else {
    next();
  }
});

export default router;
