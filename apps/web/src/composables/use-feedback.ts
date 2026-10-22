import { useMessage } from 'naive-ui';
import { errorMessages } from '@/api/http';

/**
 * 提供统一的成功和业务错误反馈。
 * @returns 展示错误与成功提示的方法
 */
export function useFeedback() {
  const message = useMessage();
  /**
   * 展示服务端字段错误。
   * @param error 业务异常
   */
  function failure(error: unknown): void {
    message.error(errorMessages(error).join('；'), { duration: 6000, closable: true });
  }
  /**
   * 展示操作完成结果。
   * @param text 中文结果
   */
  function success(text: string): void {
    message.success(text);
  }
  return { failure, success };
}
