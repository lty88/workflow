import type { ListParams } from '@/typings/api';

export interface WorkspaceViewProps {
  title?: string;
  scope?: ListParams['scope'];
}

export interface WorkspacePageProps {
  pageKey: string;
}
