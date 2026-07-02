export type IssueSeverity = 'info' | 'warning' | 'error' | 'critical';

export interface Issue {
  id: string;
  severity: IssueSeverity;
  title: string;
  description?: string;
  evidenceIds: string[];
  createdAt: string;
}
