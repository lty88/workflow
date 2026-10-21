import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { createRouter, createWebHistory } from 'vue-router';
import type { RouteLocationNormalized } from 'vue-router';
import { routes } from 'vue-router/auto-routes';
import App from './App.vue';
import { useAuthStore } from './stores/auth';
import { useConfigStore } from './stores/config';
import './styles.css';

const pinia = createPinia();
const router = createRouter({ history: createWebHistory(), routes });

/**
 * 在自动生成页面前恢复会话并检查配置页面权限。
 * @param to 目标页面
 * @returns 放行或登录与工作台跳转
 */
async function authenticateRoute(to: RouteLocationNormalized) {
  const auth = useAuthStore(pinia);
  if (!auth.initialized) await auth.restore();
  if (to.path === '/login') return auth.loggedIn ? '/' : true;
  if (!auth.loggedIn) return { path: '/login', query: { redirect: to.fullPath } };
  if (to.path.startsWith('/settings') && !auth.can('config:manage')) return '/';
  if (to.path === '/activities/new' && !auth.can('activity:create')) return '/';
  return true;
}
router.beforeEach(authenticateRoute);

/**
 * 接口会话失效时清理敏感配置并返回登录。
 */
function expireSession(): void {
  useAuthStore(pinia).apply(null);
  useConfigStore(pinia).reset();
  if (router.currentRoute.value.path !== '/login') void router.replace('/login');
}
window.addEventListener('workflow:session-expired', expireSession);
createApp(App).use(pinia).use(router).mount('#app');
