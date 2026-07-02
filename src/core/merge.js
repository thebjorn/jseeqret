/**
 * Import-merge semantics for secrets.
 *
 * When user A exports to user B, B may already hold some of the same
 * (app, env, key) identities with DIFFERENT values -- A changed theirs,
 * B changed theirs, or both did. A timestamp alone cannot distinguish
 * those cases (no common ancestor is tracked, and clocks skew), so the
 * timestamps carried by v006 exports are ADVISORY: they pick defaults,
 * a human (or an explicit strategy) picks winners.
 *
 * The flow is plan -> resolve -> apply:
 *   - `plan_secret_merge` classifies incoming secrets against the vault
 *     WITHOUT writing anything: additions / identical / conflicts.
 *   - callers surface conflicts (GUI panel, CLI listing) or map them
 *     through a strategy ('mine' | 'theirs' | 'newer').
 *   - `apply_secret_merge` writes additions and resolved conflicts;
 *     unresolved conflicts are reported back, never silently clobbered.
 *
 * This replaces three divergent legacy behaviors: the GUI import threw
 * mid-loop on the first duplicate, CLI load/receive silently overwrote,
 * and the Python env-import silently kept local values.
 */

export const MERGE_STRATEGIES = ['mine', 'theirs', 'newer']

/** The identity string used to key conflicts and resolutions. */
export function secret_id(s) {
    return `${s.app}:${s.env}:${s.key}`
}

/**
 * Classify incoming secrets against the vault. Read-only.
 *
 * @param {import('./sqlite-storage.js').SqliteStorage} storage
 * @param {Array<import('./models/secret.js').Secret>} incoming
 * @returns {Promise<{
 *   additions: Array<import('./models/secret.js').Secret>,
 *   identical: Array<import('./models/secret.js').Secret>,
 *   conflicts: Array<{incoming: object, local: object}>,
 * }>}
 */
export async function plan_secret_merge(storage, incoming) {
    const additions = []
    const identical = []
    const conflicts = []

    for (const secret of incoming) {
        const existing = await storage.fetch_secrets({
            app: secret.app, env: secret.env, key: secret.key,
        })
        if (existing.length === 0) {
            additions.push(secret)
            continue
        }
        const local = existing[0]
        const same = String(local.get_value()) === String(secret.get_value())
            && local.type === secret.type
        if (same) {
            identical.push(secret)
        } else {
            conflicts.push({ incoming: secret, local })
        }
    }

    return { additions, identical, conflicts }
}

/**
 * Resolve one conflict under a strategy. 'newer' compares the advisory
 * timestamps; a missing incoming timestamp (old exporter) or a tie
 * keeps the local value -- conservative by construction.
 *
 * @param {{incoming: object, local: object}} conflict
 * @param {string} strategy - one of MERGE_STRATEGIES
 * @returns {'mine'|'theirs'}
 */
export function resolve_conflict(conflict, strategy) {
    if (strategy === 'mine') return 'mine'
    if (strategy === 'theirs') return 'theirs'
    if (strategy === 'newer') {
        const local_ts = conflict.local.updated_at ?? 0
        const incoming_ts = conflict.incoming.updated_at ?? 0
        return incoming_ts > local_ts ? 'theirs' : 'mine'
    }
    throw new Error(
        `unknown merge strategy '${strategy}'`
        + ` (expected ${MERGE_STRATEGIES.join('/')})`
    )
}

/**
 * Apply a merge plan. Additions are inserted; identical secrets are
 * skipped untouched (their local timestamp is preserved); conflicts are
 * written only when resolved -- by an explicit per-secret resolution
 * ("app:env:key" -> 'mine'|'theirs') or the fallback strategy. Anything
 * left unresolved is returned, not written.
 *
 * @param {import('./sqlite-storage.js').SqliteStorage} storage
 * @param {object} plan - from plan_secret_merge
 * @param {object} [opts]
 * @param {object} [opts.resolutions] - per-secret choices
 * @param {string|null} [opts.strategy] - fallback for unlisted conflicts
 * @returns {Promise<{added: number, updated: number, kept: number,
 *          skipped: number, unresolved: Array<object>}>}
 */
export async function apply_secret_merge(storage, plan, opts = {}) {
    const { resolutions = {}, strategy = null } = opts

    let added = 0
    let updated = 0
    let kept = 0
    const unresolved = []

    for (const secret of plan.additions) {
        await storage.add_secret(secret)
        added += 1
    }

    for (const conflict of plan.conflicts) {
        const choice = resolutions[secret_id(conflict.incoming)]
            || (strategy ? resolve_conflict(conflict, strategy) : null)
        if (choice === 'theirs') {
            await storage.upsert_secret(conflict.incoming)
            updated += 1
        } else if (choice === 'mine') {
            kept += 1
        } else {
            unresolved.push(conflict)
        }
    }

    return {
        added,
        updated,
        kept,
        skipped: plan.identical.length,
        unresolved,
    }
}
