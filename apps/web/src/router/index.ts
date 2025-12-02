import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import Home from '../views/Home.vue';
import ProjectList from '../views/ProjectList.vue';
import ProjectDetail from '../views/ProjectDetail.vue';
import ProjectForm from '../views/ProjectForm.vue';
import ResourceForm from '../views/ResourceForm.vue';
import EnvironmentList from '../views/EnvironmentList.vue';
import ProjectEnvironments from '../views/ProjectEnvironments.vue';
import EnvironmentNew from '../views/EnvironmentNew.vue';
import EnvironmentDetail from '../views/EnvironmentDetail.vue';
import SystemOverview from '../views/SystemOverview.vue';
import SystemDocker from '../views/SystemDocker.vue';
import GitSettings from '../views/GitSettings.vue';
import SystemSettings from '../views/SystemSettings.vue';
import Login from '../views/Login.vue';
import TypographyTest from '../views/TypographyTest.vue';

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
      path: '/system/docker',
      name: 'SystemDocker',
      component: SystemDocker,
      meta: { requiresAuth: true },
    },
    {
      path: '/system/settings',
      name: 'SystemSettings',
      component: SystemSettings,
      meta: { requiresAuth: true },
    },
    {
      path: '/system/settings/git',
      name: 'GitSettings',
      component: GitSettings,
      meta: { requiresAuth: true },
    },
    {
      path: '/typography-test',
      name: 'TypographyTest',
      component: TypographyTest,
      meta: { requiresAuth: true },
    },
    {
      path: '/environments',
      name: 'EnvironmentList',
      component: EnvironmentList,
      meta: { requiresAuth: true },
    },
    {
      path: '/environments/new',
      name: 'EnvironmentNewGlobal',
      component: EnvironmentNew,
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
      path: '/projects/:id/edit',
      name: 'ProjectEdit',
      component: ProjectForm,
      meta: { requiresAuth: true },
    },
    {
      path: '/projects/:id',
      name: 'ProjectDetail',
      component: ProjectDetail,
      meta: { requiresAuth: true },
    },
    {
      path: '/projects/:projectId/resources/new',
      name: 'ResourceNew',
      component: ResourceForm,
      meta: { requiresAuth: true },
    },
    {
      path: '/projects/:projectId/resources/:resourceId/edit',
      name: 'ResourceEdit',
      component: ResourceForm,
      meta: { requiresAuth: true },
    },
    {
      path: '/projects/:projectId/environments',
      name: 'ProjectEnvironments',
      component: ProjectEnvironments,
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
    // Redirect to environments if user is authenticated and tries to access login
    next({ name: 'EnvironmentList' });
  } else {
    next();
  }
});

export default router;
