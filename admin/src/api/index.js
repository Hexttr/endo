// Barrel module — re-exports every per-entity API so existing imports
// (`import { fetchNodes } from '../api'`) keep working without touching
// 20+ files. New code is free to reach directly into sub-modules:
//   import { fetchNodes } from '../api/nodes'
// which is marginally cheaper to tree-shake and makes the dependency graph
// more explicit.
export {
  setActiveSchemaId, getActiveSchemaId, BASE,
} from './_client'

export * from './auth'
export * from './nodes'
export * from './edges'
export * from './finals'
export * from './sections'
export * from './users'
export * from './sessions'
export * from './schemas'
export * from './bots'
export * from './audit'
