<script>
    // Team Lead panel: invite form + in-flight list + Approve action.
    // Backed entirely by core primitives over window.api.onboard*.

    import SlackStatusCard from './SlackStatusCard.svelte'
    import ApproveDialog from './ApproveDialog.svelte'

    let slack_ready = $state(false)
    let rows = $state([])
    let error = $state(null)
    let notice = $state(null)
    let me = $state(null)   // own identity incl. fingerprint

    let email = $state('')
    let project = $state('')
    let name = $state('')
    let inviting = $state(false)

    let approve_target = $state(null)
    let poll_timer = null

    const STATE_BADGE = {
        invited: 'invited',
        introduced: 'introduced',
        approved: 'approved',
        provisioned: 'provisioned',
        complete: 'complete',
        expired: 'expired',
    }

    async function load_list() {
        try {
            rows = await window.api.onboardList()
        } catch (e) {
            error = e.message
        }
    }

    async function load_me() {
        try {
            me = await window.api.getIntroduction()
        } catch { /* not registered yet — fingerprint card stays hidden */ }
    }

    async function poll() {
        if (!slack_ready) return
        try {
            const r = await window.api.onboardPoll()
            rows = r.list
            const unexpected = r.events.filter(
                e => e.kind !== 'received' && !e.expected
            )
            if (unexpected.length > 0) {
                notice = `Unexpected introduction(s): ${unexpected.map(e => e.email).join(', ')}`
            }
        } catch (e) {
            error = e.message
        }
    }

    async function submit_invite(event) {
        event.preventDefault()
        if (!email || !project) return
        inviting = true
        error = null
        notice = null
        try {
            const r = await window.api.onboardInvite({ email, project, name: name || null })
            notice = `Invited ${email}. Read your fingerprint ${r.fingerprint} aloud on the voice call.`
            email = ''
            project = ''
            name = ''
            await load_list()
        } catch (e) {
            error = e.message
        } finally {
            inviting = false
        }
    }

    let resending = $state(null)   // email currently being resent

    // Re-post the invite for a row that never advanced (invited) or timed
    // out (expired). Safe because core only re-posts when nothing has been
    // captured yet; it reuses the row's stored project + display name.
    async function resend(row) {
        resending = row.email
        error = null
        notice = null
        try {
            const r = await window.api.onboardInvite({
                email: row.email,
                project: row.project_filter,
                name: row.name || null,
            })
            notice = `Re-sent invite to ${row.email}.`
                + ` Read your fingerprint ${r.fingerprint} aloud on the voice call.`
            await load_list()
        } catch (e) {
            error = e.message
        } finally {
            resending = null
        }
    }

    function open_approve(row) {
        approve_target = row
    }

    function on_approved(summary) {
        approve_target = null
        notice = `Approved: sent ${summary.users_sent} user(s) and ${summary.secrets_sent} secret(s).`
        load_list()
    }

    function on_slack_ready() {
        slack_ready = true
        poll()
    }

    $effect(() => {
        load_list()
        load_me()
        poll_timer = setInterval(poll, 15000)
        return () => clearInterval(poll_timer)
    })
</script>

<div class="onboard-view">
    <div class="page-header">
        <h1>Onboarding</h1>
        <p class="subtitle">Invite and provision new teammates over Slack</p>
    </div>

    {#if error}
        <div class="alert error">{error}</div>
    {/if}
    {#if notice}
        <div class="alert notice">{notice}</div>
    {/if}

    <SlackStatusCard onready={on_slack_ready} />

    {#if me?.fingerprint}
        <div class="own-fp">
            <div class="own-fp-text">
                <span class="own-fp-title">Your fingerprint</span>
                <span class="own-fp-note">
                    Read this aloud on the voice call — the person you
                    onboard verifies it against the invite they received.
                </span>
            </div>
            <span class="own-fp-value">{me.fingerprint}</span>
        </div>
    {/if}

    <form class="invite-form" onsubmit={submit_invite}>
        <h2>Invite a new user</h2>
        <div class="grid">
            <label>
                <span>Email</span>
                <input type="email" bind:value={email} placeholder="newhire@example.com" required>
            </label>
            <label>
                <span>Project filter</span>
                <input type="text" bind:value={project} placeholder="myapp:*:*" required>
            </label>
            <label>
                <span>Display name (optional)</span>
                <input type="text" bind:value={name} placeholder="newhire@host">
            </label>
        </div>
        <button class="primary" type="submit" disabled={inviting || !slack_ready}>
            {inviting ? 'Inviting...' : 'Send invite'}
        </button>
        {#if !slack_ready}
            <p class="muted">Sign in to Slack above before inviting.</p>
        {/if}
    </form>

    <div class="list-section">
        <h2>In-flight onboardings</h2>
        {#if rows.length === 0}
            <p class="muted">Nothing in flight.</p>
        {:else}
            <table class="onboard-table">
                <thead>
                    <tr><th>Name</th><th>Email</th><th>State</th><th>Project</th><th>Fingerprint</th><th></th></tr>
                </thead>
                <tbody>
                    {#each rows as row (row.email)}
                        <tr class:expired={row.state === 'expired'}>
                            <td>{row.name || '—'}</td>
                            <td>{row.email}</td>
                            <td><span class="badge {row.state}">{STATE_BADGE[row.state] || row.state}</span></td>
                            <td class="mono">{row.project_filter || ''}</td>
                            <td class="mono">{row.fingerprint || '—'}</td>
                            <td class="actions">
                                {#if row.state === 'invited' || row.state === 'expired'}
                                    <button
                                        class="resend-btn"
                                        disabled={!slack_ready || resending === row.email}
                                        onclick={() => resend(row)}
                                    >
                                        {resending === row.email ? 'Resending...' : 'Resend'}
                                    </button>
                                {/if}
                                <button
                                    class="approve-btn"
                                    disabled={row.state !== 'introduced'}
                                    onclick={() => open_approve(row)}
                                >
                                    Approve
                                </button>
                            </td>
                        </tr>
                    {/each}
                </tbody>
            </table>
        {/if}
    </div>
</div>

{#if approve_target}
    <ApproveDialog
        row={approve_target}
        self_fingerprint={me?.fingerprint}
        onclose={() => approve_target = null}
        onapproved={on_approved}
    />
{/if}

<style>
    .onboard-view {
        display: flex;
        flex-direction: column;
        gap: 20px;
        max-width: 820px;
    }

    .page-header h1 {
        font-size: 24px;
        font-weight: 600;
        margin-bottom: 4px;
    }

    .subtitle {
        color: var(--text-muted);
        font-size: 14px;
    }

    .own-fp {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 20px;
        background: var(--bg-card);
        border: 1px solid var(--success);
        border-radius: var(--radius);
        padding: 14px 20px;
    }

    .own-fp-text {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .own-fp-title {
        font-size: 14px;
        font-weight: 600;
    }

    .own-fp-note {
        font-size: 12px;
        color: var(--text-muted);
        line-height: 1.4;
    }

    .own-fp-value {
        font-family: var(--font-mono);
        font-size: 32px;
        font-weight: 700;
        letter-spacing: 0.15em;
        color: var(--success);
        flex-shrink: 0;
    }

    .invite-form,
    .list-section {
        background: var(--bg-card);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        padding: 20px;
        display: flex;
        flex-direction: column;
        gap: 14px;
    }

    h2 {
        font-size: 16px;
        font-weight: 600;
    }

    .grid {
        display: grid;
        grid-template-columns: 1fr 1fr 1fr;
        gap: 12px;
    }

    label {
        display: flex;
        flex-direction: column;
        gap: 6px;
        font-size: 13px;
        color: var(--text-muted);
    }

    input {
        padding: 8px 10px;
        background: var(--bg-input);
        border: 1px solid var(--border);
        border-radius: 6px;
        color: var(--text);
        font-size: 14px;
    }

    .primary {
        align-self: flex-start;
        padding: 8px 16px;
        background: var(--accent);
        color: #fff;
        border: none;
        border-radius: 6px;
        cursor: pointer;
    }

    .primary:disabled {
        opacity: 0.5;
        cursor: default;
    }

    .muted {
        color: var(--text-muted);
        font-size: 13px;
    }

    .onboard-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 13px;
    }

    .onboard-table th {
        text-align: left;
        color: var(--text-muted);
        font-weight: 500;
        padding: 6px 8px;
        border-bottom: 1px solid var(--border);
    }

    .onboard-table td {
        padding: 8px;
        border-bottom: 1px solid var(--border);
    }

    .mono {
        font-family: var(--font-mono);
    }

    tr.expired {
        opacity: 0.5;
    }

    .badge {
        display: inline-block;
        padding: 2px 8px;
        border-radius: 10px;
        font-size: 11px;
        background: var(--bg-input);
        color: var(--text-muted);
    }

    .badge.introduced { color: var(--accent); }
    .badge.complete { color: var(--success); }
    .badge.provisioned { color: var(--success); }

    .actions {
        display: flex;
        gap: 8px;
        justify-content: flex-end;
    }

    .resend-btn {
        padding: 5px 12px;
        background: transparent;
        color: var(--text-muted);
        border: 1px solid var(--border);
        border-radius: 6px;
        font-size: 12px;
        cursor: pointer;
    }

    .resend-btn:disabled {
        opacity: 0.4;
        cursor: default;
    }

    .approve-btn {
        padding: 5px 12px;
        background: var(--accent);
        color: #fff;
        border: none;
        border-radius: 6px;
        font-size: 12px;
        cursor: pointer;
    }

    .approve-btn:disabled {
        opacity: 0.4;
        cursor: default;
        background: var(--bg-input);
        color: var(--text-muted);
    }

    .alert {
        padding: 10px 14px;
        border-radius: 6px;
        font-size: 13px;
    }

    .alert.error {
        background: rgba(233, 69, 96, 0.15);
        border: 1px solid var(--accent);
        color: var(--danger-text);
    }

    .alert.notice {
        background: var(--success-dim, rgba(78, 204, 163, 0.12));
        border: 1px solid var(--success);
        color: var(--success);
    }
</style>
