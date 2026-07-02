export type PageId =
  | 'dashboard'
  | 'gameProfiles'
  | 'gameProfileEditor'
  | 'botProfiles'
  | 'newSession'
  | 'reports'
  | 'settings';

export const routes = {
  dashboard: 'dashboard',
  gameProfiles: 'gameProfiles',
  gameProfileEditor: 'gameProfileEditor',
  botProfiles: 'botProfiles',
  newSession: 'newSession',
  reports: 'reports',
  settings: 'settings'
} as const satisfies Record<PageId, PageId>;
