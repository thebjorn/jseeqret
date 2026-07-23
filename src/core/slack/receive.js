/**
 * Ad-hoc secret receive over the Slack exchange channel.
 *
 * Shared by `jseeqret receive --via slack` and the GUI Import page so
 * both fronts drive exactly the same fail-closed rules:
 *
 *  - Only `secret` envelopes are consumed here. Onboarding kinds
 *    (invite, user_list, secret_batch, ...) travel over the same pipe
 *    but belong to the onboarding pollers -- they are skipped, never
 *    deleted, never imported. (Feeding them to the json-crypt
 *    serializer was the old crash: an envelope has no `secrets` array.)
 *  - A blob whose sender cannot be matched to a locally-linked user is
 *    an error (no silent skip) so a targeted attack from the channel is
 *    noisy rather than silent.
 *  - A blob that conflicts with local values writes NOTHING until the
 *    caller supplies per-secret `resolutions` or a fallback `strategy`.
 *    The walk stops at that blob: its thread stays on Slack and the
 *    cursor does not advance past it, so the next call sees it again.
 *  - The thread is deleted after a successful import (forward secrecy).
 *    A failed delete aborts before the cursor advances -- the blob is
 *    re-imported (idempotently) rather than silently left on Slack.
 */

import { get_serializer } from '../serializers/index.js'
import { MESSAGE_KINDS } from '../serializers/envelope.js'
import { plan_secret_merge, apply_secret_merge, secret_id, describe_conflicts } from '../merge.js'
import { trace } from '../trace.js'
import { poll_envelopes, delete_thread, mark_stale } from './transport.js'
import { SLACK_KEYS, slack_config_set } from './config.js'
import { find_user_by_slack_handle } from './identity.js'

/**
 * Resolve an inbound Slack user_id to a locally-linked user record.
 * The users.info step binds the ciphertext authentication ("someone
 * holding sender.private_key wrote this") to a Slack-visible identity.
 */
async function resolve_sender(storage, client, sender_user_id) {
    let slack_user
    try {
        const r = await client.web.users.info({ user: sender_user_id })
        slack_user = r.user
    } catch (e) {
        throw new Error(
            `failed to resolve sender ${sender_user_id}: ${e.message}`
        )
    }

    const sender = await find_user_by_slack_handle(storage, slack_user.name)
    if (!sender) {
        throw new Error(
            `inbound blob from unknown Slack handle '@${slack_user.name}'`
            + ` (user_id ${sender_user_id}). Run:`
            + ` jseeqret slack link <local_user> --handle ${slack_user.name}`
        )
    }
    return sender
}

function max_ts(a, b) {
    if (!b) return a
    return Number(b) > Number(a) ? b : a
}

/**
 * Pull `secret` envelopes addressed to me from the exchange channel and
 * import them. Persists the `slack.last_seen_ts` cursor past every fully
 * handled (imported + deleted) or permanently stale frame.
 *
 * Conflict handling is two-phase, mirroring the GUI file import: without
 * `resolutions`/`strategy` the first conflicted blob stops the walk and
 * is reported back (`needs_resolution`), nothing written; the caller
 * collects choices and calls again.
 *
 * @param {import('../sqlite-storage.js').SqliteStorage} storage
 * @param {import('./client.js').SlackClient} client
 * @param {object} opts
 * @param {string} opts.channel_id
 * @param {string} opts.self_user_id
 * @param {Uint8Array} opts.receiver_private_key
 * @param {string} [opts.oldest_ts='0'] - the poll cursor
 * @param {string|null} [opts.strategy] - 'mine' | 'theirs' | 'newer'
 * @param {object|null} [opts.resolutions] - "app:env:key" -> 'mine'|'theirs'
 * @returns {Promise<{
 *   imported: number, added: number, updated: number,
 *   kept: number, skipped: number,
 *   needs_resolution: boolean, conflicts: Array<object>,
 *   conflict_sender: string|null,
 * }>}
 */
export async function receive_secrets(storage, client, opts) {
    const {
        channel_id, self_user_id, receiver_private_key,
        oldest_ts = '0', strategy = null, resolutions = null,
    } = opts

    const SerializerClass = get_serializer('json-crypt')
    const stats = {}
    const totals = { imported: 0, added: 0, updated: 0, kept: 0, skipped: 0 }
    let highest_ts = oldest_ts
    let pending = null   // first unresolvable-conflict blob stops the walk

    for await (const env of poll_envelopes({
        client, channel_id, self_user_id, oldest_ts, stats,
    })) {
        if (env.kind !== MESSAGE_KINDS.secret) {
            // Onboarding traffic addressed to us -- another poller's
            // job. Old ones are marked stale so the cursor stops paying
            // a re-scan for them once they are permanently irrelevant.
            trace(`receive: skipped ${env.kind} envelope at ${env.file_ts}`)
            mark_stale(stats, env.file_ts)
            continue
        }

        const sender = await resolve_sender(storage, client, env.sender_user_id)

        const serializer = new SerializerClass({
            sender,
            receiver_private_key,
        })
        const secrets = serializer.load(JSON.stringify(env.payload))

        const plan = await plan_secret_merge(storage, secrets)
        const unresolved = plan.conflicts.filter(c =>
            !(resolutions && resolutions[secret_id(c.incoming)]) && !strategy
        )
        if (unresolved.length > 0) {
            pending = { sender, conflicts: unresolved }
            break
        }

        const r = await apply_secret_merge(storage, plan, {
            resolutions: resolutions || {},
            strategy,
        })
        totals.imported += r.added + r.updated
        totals.added += r.added
        totals.updated += r.updated
        totals.kept += r.kept
        totals.skipped += r.skipped

        // Delete the thread. A failure propagates so last_seen_ts is
        // NOT advanced past this blob.
        await delete_thread({
            client,
            channel_id,
            file_id: env.file_id,
            reply_ts: env.reply_ts,
        })

        highest_ts = max_ts(highest_ts, env.file_ts)
    }

    // Frames walk oldest-first, so stale_ts can never leap the cursor
    // over a pending (conflicted) or unseen frame.
    const next = max_ts(highest_ts, stats.stale_ts)
    if (next !== oldest_ts) {
        await slack_config_set(storage, SLACK_KEYS.last_seen_ts, next)
    }

    return {
        ...totals,
        needs_resolution: pending != null,
        conflicts: pending ? describe_conflicts(pending.conflicts) : [],
        conflict_sender: pending ? pending.sender.username : null,
    }
}
