/**
 * Public barrel for the jseeqret core library. Re-exports the
 * high-level API (`get`, `init`, `close`), storage, models, crypto,
 * filter spec, vault helpers, migrations, serializer registry, and
 * `.env` parser. Consumers should import from here rather than
 * reaching into individual sub-modules.
 *
 * @module core
 * @example
 * import { get, init, FilterSpec } from 'jseeqret/core'
 * await init('/srv/.seeqret')
 * const value = await get('myapp:prod:DB_URL')
 */

export { Secret } from './models/secret.js'
export { User } from './models/user.js'
export { SqliteStorage } from './sqlite-storage.js'
export { FilterSpec } from './filter.js'
export { get_seeqret_dir, is_initialized, current_user } from './vault.js'
export * from './crypto/index.js'
export { run_migrations, upgrade_db } from './migrations.js'
export { get, get_sync, init, close, reload } from './api.js'
export { get_serializer, list_serializers } from './serializers/index.js'
export { parse_env } from './envfile.js'
