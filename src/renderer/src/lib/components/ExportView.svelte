<script>
    // Export view. Recipients are selected by display NAME; a name fans
    // out to every user record (machine identity) sharing it, and each
    // record gets its own per-key encrypted output. Delivery: clipboard
    // (single recipient), real file save, or the Slack exchange channel.

    let users = $state([])
    let secrets = $state([])
    let error = $state(null)
    let success = $state(null)
    let exporting = $state(false)

    let selected = $state(new Set())   // selected group labels
    let filter = $state('*:*:*')
    let serializer = $state('json-crypt')
    let platform = $state('auto')
    let output_mode = $state('clipboard')

    let preview_result = $state('')
    let send_results = $state([])      // per-recipient slack results

    // One entry per display name; a name owned by several machine
    // identities (user@host records) fans out to all of them.
    const groups = $derived.by(() => {
        const by_label = new Map()
        for (const u of users) {
            const label = u.name || u.username
            if (!by_label.has(label)) by_label.set(label, [])
            by_label.get(label).push(u)
        }
        return [...by_label.entries()]
            .map(([label, members]) => ({ label, members }))
            .sort((a, b) => a.label.localeCompare(b.label))
    })

    const recipients = $derived(
        groups
            .filter(g => selected.has(g.label))
            .flatMap(g => g.members)
    )

    // Only env/command output actually varies by platform.
    const platform_relevant = $derived(
        output_mode !== 'slack'
        && (serializer === 'env' || serializer === 'command')
    )

    // A clipboard can only hold one importable blob.
    const clipboard_blocked = $derived(
        output_mode === 'clipboard' && recipients.length > 1
    )

    const effective_serializer = $derived(
        output_mode === 'slack' ? 'json-crypt' : serializer
    )

    const can_export = $derived(
        !exporting && recipients.length > 0 && secrets.length > 0
        && !clipboard_blocked
    )

    function toggle(label) {
        const next = new Set(selected)
        if (next.has(label)) {
            next.delete(label)
        } else {
            next.add(label)
        }
        selected = next
    }

    async function load_data() {
        try {
            users = await window.api.getUsers()
            await load_preview()
        } catch (e) {
            error = e.message
        }
    }

    async function load_preview() {
        try {
            error = null
            secrets = await window.api.getSecrets(filter)
        } catch (e) {
            error = e.message
            secrets = []
        }
    }

    async function handle_export() {
        if (!can_export) return
        exporting = true
        error = null
        success = null
        preview_result = ''
        send_results = []

        const to = recipients.map(u => u.username)
        const system = !platform_relevant || platform === 'auto'
            ? null
            : platform === 'windows' ? 'win32' : 'linux'

        try {
            if (output_mode === 'clipboard') {
                const r = await window.api.exportSecrets({
                    to, filter, serializer: effective_serializer, system,
                })
                await navigator.clipboard.writeText(r.results[0].output)
                preview_result = r.results[0].output
                success = `Copied ${r.count} secret(s) for `
                    + `${r.results[0].username} to clipboard`
            } else if (output_mode === 'file') {
                const r = await window.api.exportSecretsSave({
                    to, filter, serializer: effective_serializer, system,
                })
                if (!r.canceled) {
                    success = `Saved ${r.saved.length} file(s): `
                        + r.saved.join(', ')
                }
            } else {
                const r = await window.api.sendSecretsSlack({ to, filter })
                send_results = r.results
                const ok = r.results.filter(x => x.ok).length
                const failed = r.results.length - ok
                success = failed === 0
                    ? `Sent to ${ok} recipient(s) via Slack`
                    : null
                error = failed > 0
                    ? `${failed} of ${r.results.length} send(s) failed — see below`
                    : null
            }
        } catch (e) {
            error = e.message
        } finally {
            exporting = false
        }
    }

    function apply_filter() {
        load_preview()
    }

    $effect(() => {
        load_data()
    })
</script>

<div class="export-view">
    <div class="page-header">
        <h1>Export Secrets</h1>
        <p class="subtitle">Encrypt and share secrets with other users</p>
    </div>

    {#if error}
        <div class="alert error">{error}</div>
    {/if}
    {#if success}
        <div class="alert success">{success}</div>
    {/if}

    <div class="export-layout">
        <div class="form-section">
            <div class="card">
                <h2>Export Configuration</h2>

                <div class="form-group">
                    <span class="field-label">Recipients</span>
                    {#if groups.length === 0}
                        <p class="hint">No users in this vault yet.</p>
                    {:else}
                        <div class="recipient-list">
                            {#each groups as g (g.label)}
                                <label class="recipient">
                                    <input
                                        type="checkbox"
                                        checked={selected.has(g.label)}
                                        onchange={() => toggle(g.label)}
                                    >
                                    <span class="recipient-name">
                                        {g.label}
                                        {#if g.members.some(m => m.is_owner)}
                                            <span class="you">(you)</span>
                                        {/if}
                                    </span>
                                    <span class="recipient-detail">
                                        {g.members.length === 1
                                            ? g.members[0].email
                                            : `${g.members.length} machines`}
                                    </span>
                                </label>
                            {/each}
                        </div>
                        <span class="hint">
                            A name covers every machine identity registered
                            for it{recipients.length > 0
                                ? ` — ${recipients.length} recipient record(s) selected`
                                : ''}.
                        </span>
                    {/if}
                </div>

                <div class="form-group">
                    <label for="filter">Filter Pattern</label>
                    <div class="filter-input">
                        <input
                            id="filter"
                            type="text"
                            bind:value={filter}
                            placeholder="app:env:key (e.g. myapp:prod:*)"
                            onkeydown={(e) => e.key === 'Enter' && apply_filter()}
                        />
                        <button class="secondary" onclick={apply_filter}>Apply</button>
                    </div>
                    <span class="hint">Use glob patterns: * matches anything</span>
                </div>

                <div class="form-group">
                    <span class="field-label">Output</span>
                    <div class="toggle-group" role="group" aria-label="Output">
                        <button class:active={output_mode === 'clipboard'} onclick={() => output_mode = 'clipboard'}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                            Clipboard
                        </button>
                        <button class:active={output_mode === 'file'} onclick={() => output_mode = 'file'}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                            Save File
                        </button>
                        <button class:active={output_mode === 'slack'} onclick={() => output_mode = 'slack'}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M22 2L11 13" /><path d="M22 2l-7 20-4-9-9-4 20-7z" /></svg>
                            Slack
                        </button>
                    </div>
                    {#if clipboard_blocked}
                        <span class="hint warn-text">
                            Clipboard holds one export — pick a single
                            recipient, or switch to Save File / Slack.
                        </span>
                    {:else if output_mode === 'slack'}
                        <span class="hint">
                            Sends encrypted json-crypt blobs through the
                            configured exchange channel. Recipients need a
                            verified Slack binding.
                        </span>
                    {/if}
                </div>

                <div class="form-group">
                    <label for="serializer">Format</label>
                    <select id="serializer" bind:value={serializer}
                        disabled={output_mode === 'slack'}>
                        <option value="json-crypt">JSON Encrypted (json-crypt)</option>
                        <option value="env">Environment (.env)</option>
                        <option value="command">Command (set/export)</option>
                        <option value="backup">Backup (plaintext JSON)</option>
                    </select>
                    {#if output_mode === 'slack'}
                        <span class="hint">Slack delivery always uses json-crypt.</span>
                    {/if}
                </div>

                {#if platform_relevant}
                    <div class="form-group">
                        <span class="field-label">Platform</span>
                        <div class="toggle-group" role="group" aria-label="Platform">
                            <button class:active={platform === 'auto'} onclick={() => platform = 'auto'}>Auto</button>
                            <button class:active={platform === 'windows'} onclick={() => platform = 'windows'}>Windows</button>
                            <button class:active={platform === 'linux'} onclick={() => platform = 'linux'}>Linux</button>
                        </div>
                    </div>
                {/if}

                <button
                    class="primary export-btn"
                    onclick={handle_export}
                    disabled={!can_export}
                >
                    {#if exporting}
                        <span class="spinner"></span>
                        Exporting...
                    {:else if output_mode === 'slack'}
                        Send {secrets.length} Secret{secrets.length !== 1 ? 's' : ''}
                        to {recipients.length} recipient{recipients.length !== 1 ? 's' : ''}
                    {:else}
                        Export {secrets.length} Secret{secrets.length !== 1 ? 's' : ''}
                        {recipients.length > 1 ? `× ${recipients.length}` : ''}
                    {/if}
                </button>
            </div>
        </div>

        <div class="preview-section">
            {#if send_results.length > 0}
                <div class="card">
                    <h2>Slack Delivery</h2>
                    <ul class="send-results">
                        {#each send_results as r (r.username)}
                            <li class:ok={r.ok} class:failed={!r.ok}>
                                <span class="mono">{r.username}</span>
                                {#if r.ok}
                                    — sent {r.count} secret(s)
                                {:else}
                                    — {r.error}
                                {/if}
                            </li>
                        {/each}
                    </ul>
                </div>
            {/if}

            <div class="card">
                <h2>Matching Secrets ({secrets.length})</h2>
                {#if secrets.length === 0}
                    <div class="empty">No secrets match the filter pattern.</div>
                {:else}
                    <div class="preview-table-wrap">
                        <table>
                            <thead>
                                <tr>
                                    <th>App</th>
                                    <th>Env</th>
                                    <th>Key</th>
                                    <th>Type</th>
                                </tr>
                            </thead>
                            <tbody>
                                {#each secrets as secret}
                                    <tr>
                                        <td>{secret.app}</td>
                                        <td><span class="env-badge">{secret.env}</span></td>
                                        <td class="mono">{secret.key}</td>
                                        <td class="type-label">{secret.type}</td>
                                    </tr>
                                {/each}
                            </tbody>
                        </table>
                    </div>
                {/if}
            </div>

            {#if preview_result}
                <div class="card">
                    <h2>Export Output</h2>
                    <pre class="output-preview">{preview_result}</pre>
                </div>
            {/if}
        </div>
    </div>
</div>

<style>
    .export-view {
        display: flex;
        flex-direction: column;
        gap: 20px;
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

    .alert {
        padding: 10px 14px;
        border-radius: 6px;
        font-size: 14px;
    }

    .alert.error {
        background: rgba(233, 69, 96, 0.15);
        border: 1px solid var(--accent);
        color: var(--danger-text);
    }

    .alert.success {
        background: var(--success-dim);
        border: 1px solid var(--success);
        color: var(--success);
    }

    .export-layout {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 20px;
        align-items: start;
    }

    .card {
        background: var(--bg-card);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        padding: 20px;
    }

    .card h2 {
        font-size: 15px;
        font-weight: 600;
        margin-bottom: 16px;
        color: var(--text-muted);
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }

    .form-group {
        margin-bottom: 16px;
    }

    /* Direct children only: the nested .recipient labels/checkboxes
       must keep their own flex layout and casing. */
    .form-group > label,
    .form-group > .field-label {
        display: block;
        font-size: 12px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--text-muted);
        margin-bottom: 6px;
    }

    .form-group > select,
    .form-group > input {
        width: 100%;
    }

    .recipient-list {
        display: flex;
        flex-direction: column;
        gap: 2px;
        max-height: 220px;
        overflow-y: auto;
        border: 1px solid var(--border);
        border-radius: 6px;
        padding: 6px;
        background: var(--bg);
    }

    .recipient {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 6px 8px;
        border-radius: 4px;
        font-size: 14px;
        color: var(--text);
        cursor: pointer;
    }

    .recipient input[type='checkbox'] {
        width: auto;
        flex-shrink: 0;
        accent-color: var(--accent);
    }

    .recipient:hover {
        background: rgba(233, 69, 96, 0.08);
    }

    .recipient-name {
        font-weight: 500;
    }

    .you {
        color: var(--text-muted);
        font-size: 12px;
    }

    .recipient-detail {
        margin-left: auto;
        color: var(--text-muted);
        font-size: 12px;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .filter-input {
        display: flex;
        gap: 8px;
    }

    .filter-input input {
        flex: 1;
    }

    .hint {
        display: block;
        font-size: 12px;
        color: var(--text-muted);
        margin-top: 4px;
    }

    .warn-text {
        color: var(--warning);
    }

    .toggle-group {
        display: flex;
        gap: 0;
        border: 1px solid var(--border);
        border-radius: 6px;
        overflow: hidden;
    }

    .toggle-group button {
        flex: 1;
        padding: 8px 12px;
        background: var(--bg-input);
        color: var(--text-muted);
        border: none;
        border-radius: 0;
        font-size: 13px;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        transition: all var(--transition);
    }

    .toggle-group button:not(:last-child) {
        border-right: 1px solid var(--border);
    }

    .toggle-group button.active {
        background: var(--accent);
        color: white;
    }

    .toggle-group button:hover:not(.active) {
        background: var(--border);
        color: var(--text);
    }

    .toggle-group button:active {
        transform: none;
    }

    .export-btn {
        width: 100%;
        padding: 12px;
        font-size: 15px;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        margin-top: 8px;
    }

    .export-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .spinner {
        width: 16px;
        height: 16px;
        border: 2px solid rgba(255, 255, 255, 0.3);
        border-top-color: white;
        border-radius: 50%;
        animation: spin 0.6s linear infinite;
    }

    @keyframes spin {
        to { transform: rotate(360deg); }
    }

    .preview-section {
        display: flex;
        flex-direction: column;
        gap: 16px;
    }

    .preview-table-wrap {
        max-height: 400px;
        overflow-y: auto;
    }

    .send-results {
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 6px;
        font-size: 13px;
    }

    .send-results li.ok {
        color: var(--success);
    }

    .send-results li.failed {
        color: var(--danger-text);
    }

    .mono {
        font-family: var(--font-mono);
        font-weight: 600;
    }

    .env-badge {
        display: inline-block;
        padding: 2px 8px;
        border-radius: 4px;
        font-size: 12px;
        font-weight: 600;
        background: rgba(78, 204, 163, 0.15);
        color: var(--success);
    }

    .type-label {
        color: var(--text-muted);
        font-size: 13px;
    }

    .empty {
        text-align: center;
        padding: 32px;
        color: var(--text-muted);
    }

    .output-preview {
        background: var(--bg);
        border: 1px solid var(--border);
        border-radius: 6px;
        padding: 12px;
        font-family: var(--font-mono);
        font-size: 12px;
        white-space: pre-wrap;
        word-break: break-all;
        max-height: 300px;
        overflow-y: auto;
        color: var(--success);
    }
</style>
