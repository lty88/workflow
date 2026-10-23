import type { ActivityDetail } from '@/typings/api';

export interface ActivityDetailSectionProps {
  detail: ActivityDetail;
}

export interface ActivityExecutionProps extends ActivityDetailSectionProps {
  executionUpload: boolean;
  archiveUpload: boolean;
}
