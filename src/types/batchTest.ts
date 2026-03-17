export interface BatchTestProgress {
  current: number;
  total: number;
  currentService: string;
}

export interface BatchTestReport {
  total: number;
  passed: number;
  failed: Array<{ serviceId: string; name: string; error: string }>;
  completedAt: number;
}
