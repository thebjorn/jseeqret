/**
 * User resolution helpers shared by the CLI and the Electron GUI.
 *
 * Identities default to `user@host` (see vault.js `qualified_user`).
 * These helpers let commands accept a bare username as long as it is
 * unambiguous, so existing vaults and habits keep working. Mirrors the
 * Python seeqret `resolve_user()` / `resolve_recipients()` (issue #25).
 */

import { current_user, qualified_user } from './vault.js'

/**
 * Thrown when a name matches no user in the vault.
 */
export class UnknownUserError extends Error {
    constructor(username) {
        super(`user '${username}' not found in vault.`)
        this.name = 'UnknownUserError'
        this.username = username
    }
}

/**
 * Thrown when a bare name matches several `user@host` users.
 */
export class AmbiguousUserError extends Error {
    constructor(username, candidates) {
        const names = candidates
            .map(u => `  - ${u.username} <${u.email}>`)
            .join('\n')
        super(
            `ambiguous user '${username}'. The name matches more than`
            + ` one user:\n${names}\nUse the full user@host form to`
            + ' disambiguate (jseeqret users to list known users).'
        )
        this.name = 'AmbiguousUserError'
        this.username = username
        this.candidates = candidates
    }
}

/**
 * Resolve NAME to a user in the vault.
 *
 * Tries an exact username match first (so a legacy bare-name owner wins
 * over a qualified user with the same bare name). A bare name with no
 * `@host` qualifier then falls back to a single qualified match.
 *
 * @param {import('./sqlite-storage.js').SqliteStorage} storage
 * @param {string} name
 * @returns {Promise<import('./models/user.js').User>}
 * @throws {AmbiguousUserError|UnknownUserError}
 */
export async function resolve_user(storage, name) {
    const users = await storage.fetch_users()
    for (const user of users) {
        if (user.username === name) return user
    }
    if (!name.includes('@')) {
        const matches = users.filter(
            u => u.username.startsWith(`${name}@`)
        )
        if (matches.length === 1) return matches[0]
        if (matches.length > 1) {
            throw new AmbiguousUserError(name, matches)
        }
    }
    throw new UnknownUserError(name)
}

/**
 * Fetch the vault user matching the current OS user, trying the
 * hostname-qualified identity (`user@host`) first and falling back to
 * the bare username (vaults created before hostname qualification), so
 * existing username-only vaults keep working with no migration.
 *
 * @param {import('./sqlite-storage.js').SqliteStorage} storage
 * @returns {Promise<import('./models/user.js').User|null>}
 */
export async function fetch_self(storage) {
    return (await storage.fetch_user(qualified_user()))
        || (await storage.fetch_user(current_user()))
}

/**
 * Expand `--to` NAMES into an ordered, de-duplicated list of recipient
 * usernames. Two tokens are special:
 *   - `self` is passed through unchanged (the export layer maps it to
 *     the vault owner).
 *   - `all` expands to every known user except the vault owner.
 * Any other name is resolved with {@link resolve_user}.
 *
 * @param {import('./sqlite-storage.js').SqliteStorage} storage
 * @param {string[]} names
 * @returns {Promise<string[]>}
 */
export async function resolve_recipients(storage, names) {
    const admin = await storage.fetch_admin()
    const recipients = []
    const seen = new Set()

    const add = (name) => {
        if (!seen.has(name)) {
            seen.add(name)
            recipients.push(name)
        }
    }

    for (const name of names) {
        if (name === 'self') {
            add('self')
        } else if (name === 'all') {
            const users = await storage.fetch_users()
            for (const user of users) {
                if (admin && user.username === admin.username) continue
                add(user.username)
            }
        } else {
            const user = await resolve_user(storage, name)
            add(user.username)
        }
    }

    return recipients
}
