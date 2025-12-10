export { apiClient } from './client'
export { snapshotsApi } from './snapshots'
export { searchApi } from './search'
export { foldersApi } from './folders'
export { analyticsApi } from './analytics'
export { vizApi } from './viz'

export const api = {
  snapshots: () => import('./snapshots').then((m) => m.snapshotsApi),
  search: () => import('./search').then((m) => m.searchApi),
  folders: () => import('./folders').then((m) => m.foldersApi),
  analytics: () => import('./analytics').then((m) => m.analyticsApi),
  viz: () => import('./viz').then((m) => m.vizApi),
}
