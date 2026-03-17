export interface BatchTestProgress {
  current: number;
  total: number;
  currentService: string;
}

export interface BatchTestReport {
  total: number;
  tested: number;
  passed: number;
  failed: Array<{ serviceId: string; name: string; error: string }>;
  incomplete: Array<{ serviceId: string; name: string; reason: string }>;
  completedAt: number;
}
