// Which secrets an export covers. Kept free of electron imports so the
// selection rule can be tested without starting the app.

import { FilterSpec } from '../core/filter.js'

/**
 * Secrets matching the `filter` pattern, narrowed to `keys` when given.
 *
 * `keys` is the list of app:env:key ids the GUI's export table is
 * showing after its column filters. It can only remove secrets from the
 * pattern's matches, never add any. Omitted (not an array) = no
 * narrowing, the CLI-equivalent behavior.
 *
 * @param {object} storage SqliteStorage
 * @param {string} filter app:env:key glob pattern
 * @param {string[]} [keys] app:env:key ids to keep
 */
export async function select_export_secrets(storage, filter, keys) {
    const fspec = new FilterSpec(filter)
    const secrets = await storage.fetch_secrets(fspec.to_filter_dict())
    if (!Array.isArray(keys)) return secrets

    const wanted = new Set(keys)
    return secrets.filter(s => wanted.has(`${s.app}:${s.env}:${s.key}`))
}
