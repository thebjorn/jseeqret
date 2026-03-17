<script>
    let users = $state([])
    let error = $state(null)
    let success = $state(null)
    let importing = $state(false)

    let sender = $state('')
    let serializer = $state('json-crypt')
    let input_mode = $state('paste')
    let paste_content = $state('')
    let file_name = $state('')
    let file_content = $state('')
    let drag_over = $state(false)
    let import_count = $state(0)

    let raw_content = $derived(input_mode === 'paste' ? paste_content : file_content)
    let has_content = $derived(raw_content.trim().length > 0)

    async function load_users() {
        try {
            users = await window.api.getUsers()
        } catch (e) {
            error = e.message
        }
    }

    function handle_file_drop(e) {
        e.preventDefault()
        drag_over = false
        const file = e.dataTransfer?.files?.[0]
        if (file) read_file(file)
    }

    function handle_file_select(e) {
        const file = e.target.files?.[0]
        if (file) read_file(file)
    }

    function read_file(file) {
        file_name = file.name
        const reader = new FileReader()
        reader.onload = () => {
            file_content = reader.result
        }
        reader.readAsText(file)
    }

    async function handle_import() {
        if (!has_content) {
            error = 'No content to import'
            return
        }

        importing = true
        error = null
        success = null

        try {
            const result = await window.api.importSecrets({
                from_user: sender || null,
                serializer,
                content: raw_content,
            })
            import_count = result.count
            success = `Successfully imported ${result.count} secret(s)`
            paste_content = ''
            file_content = ''
            file_name = ''
        } catch (e) {
            error = e.message
        } finally {
            importing = false
        }
    }

    $effect(() => {
        load_users()
    })
</script>

<div class="import-view">
    <div class="page-header">
        <h1>Import Secrets</h1>
        <p class="subtitle">Load secrets from an exported file or pasted content</p>
    </div>

    {#if error}
        <div class="alert error">{error}</div>
    {/if}
    {#if success}
        <div class="alert success">{success}</div>
    {/if}

    <div class="import-layout">
        <div class="form-section">
            <div class="card">
                <h2>Import Configuration</h2>

                <div class="form-group">
                    <label for="sender">Sender (optional)</label>
                    <select id="sender" bind:value={sender}>
                        <option value="">Auto-detect from content</option>
                        {#each users as user}
                            <option value={user.username}>{user.username} ({user.email})</option>
                        {/each}
                    </select>
                    <span class="hint">For json-crypt format, sender is detected automatically</span>
                </div>

                <div class="form-group">
                    <label for="import-serializer">Format</label>
                    <select id="import-serializer" bind:value={serializer}>
                        <option value="json-crypt">JSON Encrypted (json-crypt)</option>
                        <option value="env">Environment (.env)</option>
                        <option value="command">Command (set/export)</option>
                        <option value="backup">Backup (plaintext JSON)</option>
                    </select>
                </div>

                <div class="form-group">
                    <span class="field-label">Input Method</span>
                    <div class="toggle-group" role="group" aria-label="Input method">
                        <button class:active={input_mode === 'paste'} onclick={() => input_mode = 'paste'}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                            Paste
                        </button>
                        <button class:active={input_mode === 'file'} onclick={() => input_mode = 'file'}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><polyline points="13 2 13 9 20 9" /></svg>
                            File
                        </button>
                    </div>
                </div>
            </div>

            <div class="security-notice">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
                <div>
                    <strong>Encrypted transit</strong>
                    <p>Secrets encrypted with json-crypt are secured using NaCl public-key encryption. Only the intended recipient can decrypt them.</p>
                </div>
            </div>
        </div>

        <div class="content-section">
            <div class="card">
                <h2>{input_mode === 'paste' ? 'Paste Content' : 'Select File'}</h2>

                {#if input_mode === 'paste'}
                    <textarea
                        bind:value={paste_content}
                        placeholder="Paste exported content here..."
                        rows="16"
                        class="content-textarea"
                    ></textarea>
                {:else}
                    <div
                        class="dropzone"
                        class:drag-over={drag_over}
                        class:has-file={file_name}
                        role="button"
                        tabindex="0"
                        ondragover={(e) => { e.preventDefault(); drag_over = true }}
                        ondragleave={() => drag_over = false}
                        ondrop={handle_file_drop}
                    >
                        {#if file_name}
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="32" height="32" class="file-icon">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
                            </svg>
                            <span class="file-name">{file_name}</span>
                            <span class="file-size">{file_content.length} characters</span>
                            <button class="ghost" onclick={() => { file_name = ''; file_content = '' }}>Remove</button>
                        {:else}
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="40" height="40" class="drop-icon">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
                            </svg>
                            <span class="drop-text">Drop a file here or</span>
                            <label class="file-browse">
                                Browse
                                <input type="file" onchange={handle_file_select} accept=".json,.env,.txt" hidden />
                            </label>
                        {/if}
                    </div>
                {/if}

                <button
                    class="primary import-btn"
                    onclick={handle_import}
                    disabled={importing || !has_content}
                >
                    {#if importing}
                        <span class="spinner"></span>
                        Importing...
                    {:else}
                        Import Secrets
                    {/if}
                </button>
            </div>
        </div>
    </div>
</div>

<style>
    .import-view {
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

    .import-layout {
        display: grid;
        grid-template-columns: 1fr 1.2fr;
        gap: 20px;
        align-items: start;
    }

    .form-section {
        display: flex;
        flex-direction: column;
        gap: 16px;
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

    .form-group select {
        width: 100%;
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

    .security-notice {
        display: flex;
        gap: 12px;
        padding: 14px;
        background: rgba(78, 204, 163, 0.08);
        border: 1px solid rgba(78, 204, 163, 0.2);
        border-radius: var(--radius);
        font-size: 13px;
        color: var(--text-muted);
    }

    .security-notice svg {
        flex-shrink: 0;
        color: var(--success);
        margin-top: 2px;
    }

    .security-notice strong {
        display: block;
        color: var(--success);
        margin-bottom: 4px;
        font-size: 13px;
    }

    .security-notice p {
        line-height: 1.4;
    }

    .content-textarea {
        width: 100%;
        min-height: 300px;
        font-size: 13px;
        line-height: 1.5;
        margin-bottom: 12px;
    }

    .dropzone {
        border: 2px dashed var(--border);
        border-radius: var(--radius);
        padding: 48px 24px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 12px;
        transition: all var(--transition);
        margin-bottom: 12px;
        min-height: 250px;
        justify-content: center;
    }

    .dropzone.drag-over {
        border-color: var(--accent);
        background: rgba(233, 69, 96, 0.08);
    }

    .dropzone.has-file {
        border-style: solid;
        border-color: var(--success);
        background: var(--success-dim);
    }

    .drop-icon {
        color: var(--text-muted);
    }

    .drop-text {
        color: var(--text-muted);
        font-size: 14px;
    }

    .file-browse {
        color: var(--accent);
        cursor: pointer;
        font-weight: 500;
        font-size: 14px;
        transition: color var(--transition);
    }

    .file-browse:hover {
        color: var(--accent-hover);
    }

    .file-icon {
        color: var(--success);
    }

    .file-name {
        font-family: var(--font-mono);
        font-weight: 600;
        color: var(--text);
    }

    .file-size {
        font-size: 12px;
        color: var(--text-muted);
    }

    .import-btn {
        width: 100%;
        padding: 12px;
        font-size: 15px;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
    }

    .import-btn:disabled {
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
</style>
