export type PageId =
  | 'dashboard'
  | 'gameProfiles'
  | 'gameProfileEditor'
  | 'botProfiles'
  | 'botProfileEditor'
  | 'newSession'
  | 'liveSession'
  | 'issues'
  | 'logs'
  | 'reports'
  | 'helpFirstTest'
  | 'settings';

export const routes = {
  dashboard: 'dashboard',
  gameProfiles: 'gameProfiles',
  gameProfileEditor: 'gameProfileEditor',
  botProfiles: 'botProfiles',
  botProfileEditor: 'botProfileEditor',
  newSession: 'newSession',
  liveSession: 'liveSession',
  issues: 'issues',
  logs: 'logs',
  reports: 'reports',
  helpFirstTest: 'helpFirstTest',
  settings: 'settings'
} as const satisfies Record<PageId, PageId>;
