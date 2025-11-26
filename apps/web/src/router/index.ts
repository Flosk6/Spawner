import { createRouter, createWebHistory } from 'vue-router';
import Dashboard from '../views/Dashboard.vue';
import ProjectList from '../views/ProjectList.vue';
import ProjectForm from '../views/ProjectForm.vue';
import EnvironmentList from '../views/EnvironmentList.vue';
import EnvironmentNew from '../views/EnvironmentNew.vue';
import EnvironmentDetail from '../views/EnvironmentDetail.vue';
import GitSettings from '../views/GitSettings.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      redirect: '/projects',
    },
    {
      path: '/dashboard',
      name: 'Dashboard',
      component: Dashboard,
    },
    {
      path: '/settings/git',
      name: 'GitSettings',
      component: GitSettings,
    },
    {
      path: '/projects',
      name: 'ProjectList',
      component: ProjectList,
    },
    {
      path: '/projects/new',
      name: 'ProjectNew',
      component: ProjectForm,
    },
    {
      path: '/projects/:id',
      name: 'ProjectEdit',
      component: ProjectForm,
    },
    {
      path: '/projects/:projectId/environments',
      name: 'EnvironmentList',
      component: EnvironmentList,
    },
    {
      path: '/projects/:projectId/environments/new',
      name: 'EnvironmentNew',
      component: EnvironmentNew,
    },
    {
      path: '/environments/:id',
      name: 'EnvironmentDetail',
      component: EnvironmentDetail,
    },
  ],
});

export default router;
