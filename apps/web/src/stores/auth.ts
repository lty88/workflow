import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { Permission, SessionProfile } from '@workflow/domain';
import { loginApi, logoutApi, meApi } from '@/api/auth';
import { ApiError, setCsrfToken } from '@/api/http';

/**
 * 管理真实服务端会话、动态菜单与当前动作权限。
 * @returns 登录、恢复、退出和权限判断能力
 */
export const useAuthStore = defineStore(
  'auth',
  /**
   * 管理会话恢复、登录与当前成员授权。
   * @returns 身份状态和账号操作能力
   */ function authStore() {
    const profile = ref<SessionProfile | null>(null);
    const initialized = ref(false);
    const startupError = ref('');
    let pending: Promise<void> | null = null;
    const loggedIn = computed(() => !!profile.value);
    /**
     * 应用最新会话资料。
     * @param value 服务端会话
     */
    function apply(value: SessionProfile | null): void {
      profile.value = value;
      setCsrfToken(value?.csrfToken || '');
      initialized.value = true;
    }
    /**
     * 恢复已有会话，合并并发恢复请求。
     * @returns 恢复结束
     */
    async function restore(): Promise<void> {
      if (pending) return pending;
      /**
       * 查询真实登录状态，业务服务错误保留供登录页显示。
       */
      async function load(): Promise<void> {
        try {
          apply(await meApi());
          startupError.value = '';
        } catch (error) {
          apply(null);
          startupError.value =
            error instanceof ApiError && error.status === 401
              ? ''
              : error instanceof Error
                ? error.message
                : '服务连接失败';
        }
      }
      pending = load();
      try {
        await pending;
      } finally {
        pending = null;
      }
    }
    /**
     * 使用账号密码登录并应用菜单。
     * @param username 账号
     * @param password 密码
     */
    async function signIn(username: string, password: string): Promise<void> {
      apply(await loginApi(username, password));
      startupError.value = '';
    }
    /**
     * 撤销会话并清除前端身份。
     */
    async function signOut(): Promise<void> {
      await logoutApi();
      apply(null);
    }
    /**
     * 检查当前用户动作授权。
     * @param permission 权限码
     * @returns 是否具有权限
     */
    function can(permission: Permission): boolean {
      return profile.value?.permissions.includes(permission) || false;
    }
    return { profile, initialized, startupError, loggedIn, restore, signIn, signOut, apply, can };
  },
);
