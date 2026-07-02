<script>
    // Users view: the vault's user table (add / edit / delete) plus the
    // pending-introductions inbox. Introductions arrive over Slack as
    // user_list envelopes and are IMPORTED ONLY when the human accepts
    // them here -- one click when vouched by the verified team lead,
    // fingerprint ceremony otherwise. The gate is re-validated in core.

    let users = $state([])
    let error = $state(null)
    let notice = $state(null)

    let sort_column = $state(null)
    let sort_direction = $state('asc')
    let column_filters = $state({ name: '', username: '', email: '', pubkey: '' })

    // Pending introductions. Loaded best-effort: without a ready Slack
    // session the section simply stays hidden.
    let inbox = $state([])
    let inbox_error = $state(null)
    let slack_ready = $state(false)
    let checking_inbox = $state(false)
    let accepting = $state(null)      // file_id being accepted
    let dismissed = $state(new Set()) // file_ids hidden this session

    // Fingerprint ceremony for an introduction NOT vouched by the TL.
    let verify_target = $state(null)
    let verify_checked = $state(false)
    let verify_typed = $state('')

    // Add / edit dialogs
    let show_add = $state(false)
    let add_form = $state({ username: '', email: '', pubkey: '', name: '' })
    let edit_target = $state(null)
    let edit_form = $state({ name: '', email: '', pubkey: '' })
    let busy = $state(false)

    async function load_users() {
        try {
            error = null
            users = await window.api.getUsers()
        } catch (e) {
            error = e.message
            users = []
        }
    }

    async function check_inbox() {
        checking_inbox = true
        inbox_error = null
        try {
            const status = await window.api.slackStatus()
            slack_ready = !!status?.ready
            if (!slack_ready) {
                inbox = []
                return
            }
            inbox = await window.api.onboardInbox()
        } catch (e) {
            inbox_error = e.message
        } finally {
            checking_inbox = false
        }
    }

    const visible_inbox = $derived(
        inbox.filter(p => !dismissed.has(p.file_id))
    )

    async function accept(intro, { verified = false, fingerprint = null } = {}) {
        accepting = intro.file_id
        error = null
        notice = null
        try {
            const r = await window.api.onboardAccept({
                payload: intro.payload,
                file_id: intro.file_id,
                reply_ts: intro.reply_ts,
                verified,
                fingerprint,
            })
            const names = r.imported.map(u => u.name || u.username)
            notice = `Imported ${r.imported.length} user(s): ${names.join(', ')}`
            verify_target = null
            await load_users()
            await check_inbox()
        } catch (e) {
            error = e.message
        } finally {
            accepting = null
        }
    }

    function open_verify(intro) {
        verify_target = intro
        verify_checked = false
        verify_typed = ''
    }

    const can_verify_accept = $derived(
        verify_target && verify_checked
        && verify_typed.trim() === verify_target.fingerprint
        && accepting == null
    )

    function dismiss(intro) {
        dismissed = new Set([...dismissed, intro.file_id])
    }

    async function submit_add(event) {
        event.preventDefault()
        busy = true
        error = null
        notice = null
        try {
            await window.api.addUser({
                username: add_form.username.trim(),
                email: add_form.email.trim(),
                pubkey: add_form.pubkey.trim(),
                name: add_form.name.trim() || null,
            })
            notice = `Added ${add_form.username.trim()}.`
            show_add = false
            add_form = { username: '', email: '', pubkey: '', name: '' }
            await load_users()
        } catch (e) {
            error = e.message
        } finally {
            busy = false
        }
    }

    function open_edit(user) {
        edit_target = user
        edit_form = {
            name: user.name || '',
            email: user.email,
            pubkey: user.pubkey,
        }
    }

    async function submit_edit(event) {
        event.preventDefault()
        busy = true
        error = null
        notice = null
        try {
            await window.api.updateUser({
                username: edit_target.username,
                name: edit_form.name.trim() || null,
                email: edit_form.email.trim(),
                pubkey: edit_form.pubkey.trim(),
            })
            notice = `Updated ${edit_target.username}.`
            edit_target = null
            await load_users()
        } catch (e) {
            error = e.message
        } finally {
            busy = false
        }
    }

    async function remove_user(user) {
        const label = user.name
            ? `${user.name} (${user.username})` : user.username
        if (!confirm(`Delete ${label} from this vault?`)) return
        error = null
        notice = null
        try {
            await window.api.removeUser({ username: user.username })
            notice = `Deleted ${user.username}.`
            await load_users()
        } catch (e) {
            error = e.message
        }
    }

    function handle_sort(column) {
        if (sort_column === column) {
            sort_direction = sort_direction === 'asc' ? 'desc' : 'asc'
        } else {
            sort_column = column
            sort_direction = 'asc'
        }
    }

    function sort_indicator(column) {
        if (sort_column !== column) return ''
        return sort_direction === 'asc' ? ' ▲' : ' ▼'
    }

    let filtered_users = $derived.by(() => {
        let result = users

        if (column_filters.name) {
            const f = column_filters.name.toLowerCase()
            result = result.filter(u => (u.name || '').toLowerCase().includes(f))
        }
        if (column_filters.username) {
            const f = column_filters.username.toLowerCase()
            result = result.filter(u => u.username.toLowerCase().includes(f))
        }
        if (column_filters.email) {
            const f = column_filters.email.toLowerCase()
            result = result.filter(u => u.email.toLowerCase().includes(f))
        }
        if (column_filters.pubkey) {
            const f = column_filters.pubkey.toLowerCase()
            result = result.filter(u => u.pubkey.toLowerCase().includes(f))
        }

        if (sort_column) {
            result = [...result].sort((a, b) => {
                const va = String(a[sort_column] ?? '').toLowerCase()
                const vb = String(b[sort_column] ?? '').toLowerCase()
                const cmp = va < vb ? -1 : va > vb ? 1 : 0
                return sort_direction === 'asc' ? cmp : -cmp
            })
        }

        return result
    })

    $effect(() => {
        load_users()
        check_inbox()
    })
</script>

<div class="user-list">
    <div class="page-header">
        <h1>Users</h1>
        <p class="subtitle">Teammates who can receive your encrypted secrets</p>
    </div>

    {#if error}
        <div class="alert error">{error}</div>
    {/if}
    {#if notice}
        <div class="alert notice">{notice}</div>
    {/if}

    {#if visible_inbox.length > 0}
        <div class="inbox card">
            <h2>Pending introductions</h2>
            <p class="muted">
                New teammates waiting for your approval. Accepting imports
                their public key into this vault.
            </p>
            {#each visible_inbox as intro (intro.file_id)}
                <div class="intro-row" class:vouched={intro.vouched}>
                    <div class="intro-users">
                        {#each intro.users as u (u.username)}
                            <div class="intro-user">
                                <span class="intro-name">{u.name || u.username}</span>
                                <span class="intro-detail mono">{u.username} · {u.email}</span>
                            </div>
                        {/each}
                        {#if intro.vouched}
                            <span class="badge ok">vouched by your team lead</span>
                        {:else}
                            <span class="badge warn">
                                unverified sender — fingerprint
                                <span class="mono">{intro.fingerprint}</span>
                            </span>
                        {/if}
                    </div>
                    <div class="intro-actions">
                        <button class="ghost" onclick={() => dismiss(intro)}>
                            Dismiss
                        </button>
                        {#if intro.vouched}
                            <button
                                class="primary"
                                disabled={accepting === intro.file_id}
                                onclick={() => accept(intro)}
                            >
                                {accepting === intro.file_id ? 'Accepting...' : 'Accept'}
                            </button>
                        {:else}
                            <button class="primary" onclick={() => open_verify(intro)}>
                                Verify & accept
                            </button>
                        {/if}
                    </div>
                </div>
            {/each}
        </div>
    {/if}
    {#if inbox_error}
        <div class="alert error">Introduction inbox: {inbox_error}</div>
    {/if}

    <div class="toolbar">
        <button
            class="ghost"
            disabled={checking_inbox || !slack_ready}
            title={slack_ready
                ? 'Check Slack for new introductions'
                : 'Connect Slack (Onboarding page) to receive introductions'}
            onclick={check_inbox}
        >
            {checking_inbox ? 'Checking...' : 'Check introductions'}
        </button>
        <button class="primary" onclick={() => show_add = !show_add}>
            {show_add ? 'Cancel' : '+ Add user'}
        </button>
    </div>

    {#if show_add}
        <form class="card add-form" onsubmit={submit_add}>
            <h2>Add a user</h2>
            <p class="muted">
                Paste the values from the teammate's Introduction page.
                Verify their fingerprint out-of-band before sending secrets.
            </p>
            <div class="grid">
                <label>
                    <span>Username</span>
                    <input type="text" bind:value={add_form.username}
                        placeholder="alice@host" required>
                </label>
                <label>
                    <span>Email</span>
                    <input type="email" bind:value={add_form.email}
                        placeholder="alice@example.com" required>
                </label>
                <label>
                    <span>Display name (optional)</span>
                    <input type="text" bind:value={add_form.name}
                        placeholder="Alice">
                </label>
                <label class="wide">
                    <span>Public key (base64)</span>
                    <input type="text" bind:value={add_form.pubkey}
                        class="mono" placeholder="base64 public key" required>
                </label>
            </div>
            <button class="primary" type="submit" disabled={busy}>
                {busy ? 'Adding...' : 'Add user'}
            </button>
        </form>
    {/if}

    {#if users.length === 0 && !error}
        <div class="empty">No users found.</div>
    {:else if users.length > 0}
        <table>
            <thead>
                <tr class="header-row">
                    <th class="sortable" onclick={() => handle_sort('name')}>Name{sort_indicator('name')}</th>
                    <th class="sortable" onclick={() => handle_sort('username')}>Username{sort_indicator('username')}</th>
                    <th class="sortable" onclick={() => handle_sort('email')}>Email{sort_indicator('email')}</th>
                    <th>Fingerprint</th>
                    <th>Public Key</th>
                    <th></th>
                </tr>
                <tr class="filter-row">
                    <th><input type="text" bind:value={column_filters.name} placeholder="filter..." class="col-filter"></th>
                    <th><input type="text" bind:value={column_filters.username} placeholder="filter..." class="col-filter"></th>
                    <th><input type="text" bind:value={column_filters.email} placeholder="filter..." class="col-filter"></th>
                    <th></th>
                    <th><input type="text" bind:value={column_filters.pubkey} placeholder="filter..." class="col-filter"></th>
                    <th></th>
                </tr>
            </thead>
            <tbody>
                {#each filtered_users as user (user.username)}
                    <tr>
                        <td>{user.name || '—'}</td>
                        <td class="username">
                            {user.username}
                            {#if user.is_owner}
                                <span class="badge owner">owner</span>
                            {/if}
                        </td>
                        <td>{user.email}</td>
                        <td class="mono fingerprint">{user.fingerprint}</td>
                        <td class="pubkey" title={user.pubkey}>
                            <code>{user.pubkey.slice(0, 20)}...</code>
                        </td>
                        <td class="actions">
                            <button class="row-btn" title="Edit"
                                onclick={() => open_edit(user)}>
                                Edit
                            </button>
                            {#if !user.is_owner}
                                <button class="row-btn danger" title="Delete"
                                    onclick={() => remove_user(user)}>
                                    Delete
                                </button>
                            {/if}
                        </td>
                    </tr>
                {/each}
                {#if filtered_users.length === 0 && users.length > 0}
                    <tr>
                        <td colspan="6" class="empty-filtered">No users match the column filters.</td>
                    </tr>
                {/if}
            </tbody>
        </table>
        <div class="table-footer">
            {filtered_users.length} of {users.length} user(s)
        </div>
    {/if}
</div>

{#if edit_target}
    <div
        class="backdrop"
        role="presentation"
        onclick={(e) => { if (e.target === e.currentTarget) edit_target = null }}
    >
        <form class="dialog" onsubmit={submit_edit}>
            <h2>Edit {edit_target.username}</h2>
            <label class="field">
                <span>Display name</span>
                <input type="text" bind:value={edit_form.name} placeholder="Alice">
            </label>
            <label class="field">
                <span>Email</span>
                <input type="email" bind:value={edit_form.email} required>
            </label>
            <label class="field">
                <span>Public key (base64)</span>
                <input type="text" bind:value={edit_form.pubkey} class="mono"
                    disabled={edit_target.is_owner} required>
                {#if edit_target.is_owner}
                    <span class="hint">
                        The owner's key is bound to the vault's key files.
                    </span>
                {:else if edit_form.pubkey.trim() !== edit_target.pubkey}
                    <span class="hint warn-text">
                        Changing the key resets this user's verified Slack
                        binding — re-verify their fingerprint before sending.
                    </span>
                {/if}
            </label>
            <div class="dialog-actions">
                <button type="button" class="ghost"
                    onclick={() => edit_target = null}>Cancel</button>
                <button type="submit" class="primary" disabled={busy}>
                    {busy ? 'Saving...' : 'Save'}
                </button>
            </div>
        </form>
    </div>
{/if}

{#if verify_target}
    <div
        class="backdrop"
        role="presentation"
        onclick={(e) => { if (e.target === e.currentTarget) verify_target = null }}
    >
        <div class="dialog" role="dialog" aria-modal="true" tabindex="-1">
            <h2>Verify the sender</h2>
            <p class="muted">
                This introduction was NOT sent by your verified team lead.
                Verify the sender's fingerprint OUT-OF-BAND (voice call)
                before accepting — never trust a fingerprint over Slack.
            </p>
            <div class="big-fp">{verify_target.fingerprint}</div>
            <label class="check">
                <input type="checkbox" bind:checked={verify_checked}>
                I verified this fingerprint on a voice call
            </label>
            <label class="field">
                <span>Type the fingerprint back to confirm</span>
                <input type="text" bind:value={verify_typed} class="mono"
                    placeholder={verify_target.fingerprint}
                    autocomplete="off" spellcheck="false">
            </label>
            <div class="dialog-actions">
                <button class="ghost" onclick={() => verify_target = null}>
                    Cancel
                </button>
                <button
                    class="primary"
                    disabled={!can_verify_accept}
                    onclick={() => accept(verify_target, {
                        verified: true, fingerprint: verify_typed.trim(),
                    })}
                >
                    {accepting ? 'Accepting...' : 'Accept & import'}
                </button>
            </div>
        </div>
    </div>
{/if}

<style>
    .user-list {
        display: flex;
        flex-direction: column;
        gap: 16px;
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

    .toolbar {
        display: flex;
        justify-content: flex-end;
        gap: 10px;
    }

    .card {
        background: var(--bg-card);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        padding: 20px;
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    .card h2 {
        font-size: 16px;
        font-weight: 600;
    }

    .muted {
        color: var(--text-muted);
        font-size: 13px;
        line-height: 1.5;
    }

    .mono {
        font-family: var(--font-mono);
    }

    /* -- introductions inbox -- */

    .intro-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 16px;
        padding: 12px 14px;
        background: var(--bg);
        border: 1px solid var(--border);
        border-radius: 8px;
    }

    .intro-row.vouched {
        border-color: var(--success);
    }

    .intro-users {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }

    .intro-user {
        display: flex;
        flex-direction: column;
    }

    .intro-name {
        font-weight: 600;
        font-size: 14px;
    }

    .intro-detail {
        font-size: 12px;
        color: var(--text-muted);
    }

    .intro-actions {
        display: flex;
        gap: 8px;
        flex-shrink: 0;
    }

    .badge {
        display: inline-block;
        padding: 2px 8px;
        border-radius: 10px;
        font-size: 11px;
        background: var(--bg-input);
        color: var(--text-muted);
        align-self: flex-start;
    }

    .badge.ok {
        color: var(--success);
        background: var(--success-dim);
    }

    .badge.warn {
        color: var(--warning);
        background: rgba(240, 160, 48, 0.12);
    }

    .badge.owner {
        color: var(--success);
        background: var(--success-dim);
        margin-left: 6px;
    }

    /* -- add form -- */

    .add-form .grid {
        display: grid;
        grid-template-columns: 1fr 1fr 1fr;
        gap: 12px;
    }

    .add-form label {
        display: flex;
        flex-direction: column;
        gap: 6px;
        font-size: 13px;
        color: var(--text-muted);
    }

    .add-form label.wide {
        grid-column: 1 / -1;
    }

    .add-form .primary {
        align-self: flex-start;
    }

    /* -- table -- */

    .username {
        font-family: var(--font-mono);
        font-weight: 600;
    }

    .fingerprint {
        color: var(--success);
        font-weight: 600;
        letter-spacing: 0.08em;
    }

    .pubkey code {
        font-family: var(--font-mono);
        font-size: 12px;
        color: var(--text-muted);
    }

    .actions {
        white-space: nowrap;
        text-align: right;
    }

    .row-btn {
        padding: 4px 10px;
        background: transparent;
        color: var(--text-muted);
        border: 1px solid var(--border);
        border-radius: 6px;
        font-size: 12px;
        cursor: pointer;
    }

    .row-btn:hover {
        color: var(--text);
        border-color: var(--accent);
    }

    .row-btn.danger:hover {
        color: #fff;
        background: var(--accent);
        border-color: var(--accent);
    }

    .sortable {
        cursor: pointer;
        user-select: none;
    }

    .sortable:hover {
        color: var(--text);
    }

    .filter-row th {
        padding: 4px 6px;
        background: var(--bg-card);
        border-bottom: 1px solid var(--border);
    }

    .col-filter {
        width: 100%;
        padding: 4px 8px !important;
        font-size: 12px !important;
        background: var(--bg) !important;
        border: 1px solid var(--border) !important;
        border-radius: 4px !important;
        color: var(--text) !important;
    }

    .col-filter::placeholder {
        color: var(--text-muted);
        opacity: 0.75;
    }

    .empty-filtered {
        text-align: center;
        color: var(--text-muted);
        padding: 20px !important;
    }

    .table-footer {
        text-align: right;
        font-size: 12px;
        color: var(--text-muted);
        padding: 8px 12px;
    }

    /* -- dialogs -- */

    .backdrop {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.6);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 100;
    }

    .dialog {
        width: 460px;
        max-width: 90vw;
        background: var(--bg-card);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        padding: 24px;
        display: flex;
        flex-direction: column;
        gap: 14px;
    }

    .dialog h2 {
        font-size: 18px;
        font-weight: 600;
    }

    .field {
        display: flex;
        flex-direction: column;
        gap: 6px;
        font-size: 13px;
        color: var(--text-muted);
    }

    .hint {
        font-size: 12px;
        color: var(--text-muted);
    }

    .warn-text {
        color: var(--warning);
    }

    .check {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 14px;
        cursor: pointer;
    }

    .big-fp {
        font-family: var(--font-mono);
        font-size: 40px;
        font-weight: 700;
        letter-spacing: 0.15em;
        text-align: center;
        color: var(--warning);
        background: var(--bg);
        border: 1px solid var(--border);
        border-radius: 8px;
        padding: 14px;
    }

    .dialog-actions {
        display: flex;
        justify-content: flex-end;
        gap: 10px;
        margin-top: 4px;
    }

    /* -- alerts -- */

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
        background: var(--success-dim);
        border: 1px solid var(--success);
        color: var(--success);
    }

    .empty {
        text-align: center;
        padding: 40px;
        color: var(--text-muted);
    }
</style>
