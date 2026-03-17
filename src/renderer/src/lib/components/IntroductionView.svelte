<script>
    let user_info = $state(null)
    let error = $state(null)
    let copied = $state(false)
    let show_full_key = $state(false)
    let copy_timeout = null

    async function load_introduction() {
        try {
            user_info = await window.api.getIntroduction()
        } catch (e) {
            error = e.message
        }
    }

    function get_command() {
        if (!user_info) return ''
        return `jseeqret add user --username ${user_info.username} --email ${user_info.email} --pubkey ${user_info.pubkey}`
    }

    async function copy_command() {
        try {
            await navigator.clipboard.writeText(get_command())
            copied = true
            if (copy_timeout) clearTimeout(copy_timeout)
            copy_timeout = setTimeout(() => { copied = false }, 2000)
        } catch {
            error = 'Failed to copy to clipboard'
        }
    }

    $effect(() => {
        load_introduction()
    })
</script>

<div class="intro-view">
    <div class="page-header">
        <h1>Introduction</h1>
        <p class="subtitle">Share your identity with vault administrators</p>
    </div>

    {#if error}
        <div class="alert error">{error}</div>
    {/if}

    {#if user_info}
        <div class="intro-content">
            <div class="identity-card">
                <div class="identity-header">
                    <div class="identity-avatar">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                        </svg>
                    </div>
                    <div class="identity-info">
                        <h2>{user_info.username}</h2>
                        <span class="email">{user_info.email}</span>
                    </div>
                </div>

                <div class="key-section">
                    <div class="key-header">
                        <span class="key-label">Public Key</span>
                        <button class="ghost" onclick={() => show_full_key = !show_full_key}>
                            {show_full_key ? 'Collapse' : 'Expand'}
                        </button>
                    </div>
                    <div class="key-value" class:expanded={show_full_key}>
                        <code>{show_full_key ? user_info.pubkey : user_info.pubkey.slice(0, 32) + '...'}</code>
                    </div>
                </div>
            </div>

            <div class="command-section">
                <div class="command-header">
                    <h2>Onboarding Command</h2>
                    <p>Share this command with vault administrators to get added to their vault.</p>
                </div>

                <div class="command-block">
                    <div class="command-label">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                            <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
                        </svg>
                        Terminal
                    </div>
                    <pre class="command-code">{get_command()}</pre>
                    <button
                        class="copy-btn"
                        class:copied
                        onclick={copy_command}
                    >
                        {#if copied}
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polyline points="20 6 9 17 4 12" /></svg>
                            Copied!
                        {:else}
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                            Copy
                        {/if}
                    </button>
                </div>
            </div>

            <div class="steps-section">
                <h2>How It Works</h2>
                <div class="steps">
                    <div class="step">
                        <div class="step-number">1</div>
                        <div class="step-content">
                            <strong>Copy the command above</strong>
                            <p>This contains your public key for secure secret exchange</p>
                        </div>
                    </div>
                    <div class="step">
                        <div class="step-number">2</div>
                        <div class="step-content">
                            <strong>Send it to the vault administrator</strong>
                            <p>They run the command to register you in their vault</p>
                        </div>
                    </div>
                    <div class="step">
                        <div class="step-number">3</div>
                        <div class="step-content">
                            <strong>Receive encrypted secrets</strong>
                            <p>Once added, they can export secrets encrypted just for you</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    {:else if !error}
        <div class="loading">Loading introduction data...</div>
    {/if}
</div>

<style>
    .intro-view {
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

    .intro-content {
        display: flex;
        flex-direction: column;
        gap: 20px;
        max-width: 700px;
    }

    .identity-card {
        background: var(--bg-card);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        padding: 24px;
    }

    .identity-header {
        display: flex;
        align-items: center;
        gap: 16px;
        margin-bottom: 20px;
    }

    .identity-avatar {
        width: 56px;
        height: 56px;
        border-radius: 14px;
        background: rgba(233, 69, 96, 0.15);
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
    }

    .identity-avatar svg {
        width: 28px;
        height: 28px;
        color: var(--accent);
    }

    .identity-info h2 {
        font-family: var(--font-mono);
        font-size: 20px;
        font-weight: 700;
        margin-bottom: 2px;
    }

    .email {
        color: var(--text-muted);
        font-size: 14px;
    }

    .key-section {
        background: var(--bg);
        border: 1px solid var(--border);
        border-radius: 6px;
        padding: 12px;
    }

    .key-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 8px;
    }

    .key-label {
        font-size: 12px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--text-muted);
    }

    .key-value code {
        font-family: var(--font-mono);
        font-size: 12px;
        color: var(--success);
        word-break: break-all;
        line-height: 1.6;
    }

    .command-section {
        background: var(--bg-card);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        padding: 24px;
    }

    .command-header h2 {
        font-size: 16px;
        font-weight: 600;
        margin-bottom: 4px;
    }

    .command-header p {
        color: var(--text-muted);
        font-size: 14px;
        margin-bottom: 16px;
    }

    .command-block {
        background: var(--bg);
        border: 1px solid var(--border);
        border-radius: 6px;
        overflow: hidden;
        position: relative;
    }

    .command-label {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 8px 12px;
        font-size: 12px;
        color: var(--text-muted);
        border-bottom: 1px solid var(--border);
        background: rgba(15, 52, 96, 0.3);
    }

    .command-code {
        padding: 16px;
        font-family: var(--font-mono);
        font-size: 13px;
        color: var(--success);
        white-space: pre-wrap;
        word-break: break-all;
        line-height: 1.6;
        margin: 0;
    }

    .copy-btn {
        position: absolute;
        top: 40px;
        right: 8px;
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 12px;
        background: var(--bg-input);
        color: var(--text-muted);
        border: 1px solid var(--border);
        border-radius: 6px;
        font-size: 13px;
        cursor: pointer;
        transition: all var(--transition);
    }

    .copy-btn:hover {
        color: var(--text);
        border-color: var(--accent);
    }

    .copy-btn.copied {
        color: var(--success);
        border-color: var(--success);
        background: var(--success-dim);
    }

    .steps-section {
        background: var(--bg-card);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        padding: 24px;
    }

    .steps-section h2 {
        font-size: 16px;
        font-weight: 600;
        margin-bottom: 16px;
    }

    .steps {
        display: flex;
        flex-direction: column;
        gap: 16px;
    }

    .step {
        display: flex;
        gap: 16px;
        align-items: flex-start;
    }

    .step-number {
        width: 32px;
        height: 32px;
        border-radius: 50%;
        background: rgba(233, 69, 96, 0.15);
        color: var(--accent);
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: 700;
        font-size: 14px;
        flex-shrink: 0;
    }

    .step-content strong {
        display: block;
        font-size: 14px;
        margin-bottom: 2px;
    }

    .step-content p {
        font-size: 13px;
        color: var(--text-muted);
        line-height: 1.4;
    }

    .loading {
        text-align: center;
        padding: 60px;
        color: var(--text-muted);
    }
</style>
