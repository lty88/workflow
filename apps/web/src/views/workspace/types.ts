import type { ListParams } from '@/typings/api';

export interface WorkspaceViewProps {
  title?: string;
  scope?: ListParams['scope'];
  common?: boolean;
}

export interface WorkspacePageProps {
  pageKey: string;
}
