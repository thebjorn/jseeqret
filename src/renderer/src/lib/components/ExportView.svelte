<script>
    let users = $state([])
    let secrets = $state([])
    let error = $state(null)
    let success = $state(null)
    let exporting = $state(false)

    let recipient = $state('')
    let filter = $state('*:*:*')
    let serializer = $state('json-crypt')
    let platform = $state('auto')
    let output_mode = $state('clipboard')

    let preview_result = $state('')

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
        if (!recipient) {
            error = 'Please select a recipient'
            return
        }
        if (secrets.length === 0) {
            error = 'No secrets match the filter'
            return
        }

        exporting = true
        error = null
        success = null

        try {
            const system = platform === 'auto'
                ? null
                : platform === 'windows' ? 'win32' : 'linux'

            const result = await window.api.exportSecrets({
                to: recipient,
                filter,
                serializer,
                system,
            })

            if (output_mode === 'clipboard') {
                await navigator.clipboard.writeText(result.output)
                success = `Copied ${result.count} secret(s) to clipboard`
            } else {
                preview_result = result.output
                success = `Exported ${result.count} secret(s)`
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
                    <label for="recipient">Recipient</label>
                    <select id="recipient" bind:value={recipient}>
                        <option value="">Select a user...</option>
                        {#each users as user}
                            <option value={user.username}>{user.username} ({user.email})</option>
                        {/each}
                    </select>
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
                    <label for="serializer">Format</label>
                    <select id="serializer" bind:value={serializer}>
                        <option value="json-crypt">JSON Encrypted (json-crypt)</option>
                        <option value="env">Environment (.env)</option>
                        <option value="command">Command (set/export)</option>
                        <option value="backup">Backup (plaintext JSON)</option>
                    </select>
                </div>

                <div class="form-group">
                    <span class="field-label">Platform</span>
                    <div class="toggle-group" role="group" aria-label="Platform">
                        <button class:active={platform === 'auto'} onclick={() => platform = 'auto'}>Auto</button>
                        <button class:active={platform === 'windows'} onclick={() => platform = 'windows'}>Windows</button>
                        <button class:active={platform === 'linux'} onclick={() => platform = 'linux'}>Linux</button>
                    </div>
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
                    </div>
                </div>

                <button
                    class="primary export-btn"
                    onclick={handle_export}
                    disabled={exporting || !recipient || secrets.length === 0}
                >
                    {#if exporting}
                        <span class="spinner"></span>
                        Exporting...
                    {:else}
                        Export {secrets.length} Secret{secrets.length !== 1 ? 's' : ''}
                    {/if}
                </button>
            </div>
        </div>

        <div class="preview-section">
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
        color: var(--accent);
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

    .form-group label,
    .form-group .field-label {
        display: block;
        font-size: 12px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--text-muted);
        margin-bottom: 6px;
    }

    .form-group select,
    .form-group input {
        width: 100%;
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
        opacity: 0.7;
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
