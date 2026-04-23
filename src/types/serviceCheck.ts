import type { ServiceHealthStatus } from './serviceHealth';

export type ServiceCheckMode = 'single' | 'batch' | 'background';

export interface ServiceCheckSummarySnapshot {
  verified: string;
  error: string;
  pending: string;
  unconfigured: string;
  counts: Record<ServiceHealthStatus, number>;
}

export interface ServiceCheckSession {
  mode: ServiceCheckMode;
  startedAt: number;
  targetIds: string[];
  refreshingIds: string[];
  runningIds: string[];
  completedIds: string[];
  baselineStatuses: Record<string, ServiceHealthStatus>;
  resultStatuses: Partial<Record<string, ServiceHealthStatus>>;
  summarySkeletonStatuses: ServiceHealthStatus[];
  summarySnapshot: ServiceCheckSummarySnapshot;
}
