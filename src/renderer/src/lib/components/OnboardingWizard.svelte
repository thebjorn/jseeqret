<script>
    // New-user first-run wizard. Walks an uninitialized vault through:
    //   1. Install (done — the wizard is running)
    //   2. Create vault (one click)
    //   3. Slack login + channel
    //   4. Introduce + verify the TL fingerprint on a voice call
    //   5. Secrets arrive (gated on the verified TL key)
    //   6. Done
    // No business logic here — every action is a core primitive over
    // window.api.

    import SlackStatusCard from './SlackStatusCard.svelte'

    let { vault_status = null, onrefresh = null } = $props()

    let step = $state('loading')
    let error = $state(null)
    let busy = $state(false)

    let me = $state(null)          // { username, email, pubkey, fingerprint }
    let invite = $state(null)      // received invite payload
    let verified = $state(false)
    let typed = $state('')
    let progress = $state(null)    // { imported_users, imported_secrets, complete }
    let poll_timer = null

    const can_join = $derived(
        invite && verified && typed.trim() === invite.tl_fingerprint && !busy
    )

    async function decide_step() {
        error = null
        if (!vault_status?.initialized) {
            step = 'create'
            return
        }
        let slack
        try {
            slack = await window.api.slackStatus()
        } catch (e) {
            error = e.message
            return
        }
        if (!slack?.ready) {
            step = 'slack'
            return
        }
        // Vault + Slack ready: load identity, then try to pick up any
        // provisioning already waiting (e.g. approved while we were away).
        try {
            me = await window.api.getIntroduction()
        } catch { /* not registered yet — fine */ }

        try {
            const r = await window.api.onboardProvisionPoll()
            progress = r
            if (r.complete) { step = 'done'; return }
            step = 'waiting'
            start_waiting()
            return
        } catch {
            // No trust on file yet — we still need to introduce ourselves.
        }
        try {
            invite = await window.api.onboardReceiveInvite()
        } catch (e) {
            error = e.message
        }
        step = 'introduce'
    }

    async function create_vault() {
        busy = true
        error = null
        try {
            const result = await window.api.createVault()
            if (!result.canceled) onrefresh?.()
        } catch (e) {
            error = e.message
        } finally {
            busy = false
        }
    }

    async function refresh_invite() {
        busy = true
        try {
            invite = await window.api.onboardReceiveInvite()
        } catch (e) {
            error = e.message
        } finally {
            busy = false
        }
    }

    async function join() {
        if (!can_join) return
        busy = true
        error = null
        try {
            const r = await window.api.onboardJoin({
                tl_slack_user_id: invite.tl_slack_user_id,
                tl_pubkey: invite.tl_pubkey,
                tl_fingerprint: invite.tl_fingerprint,
                project: invite.project,
            })
            me = me || {}
            me.fingerprint = r.fingerprint
            step = 'waiting'
            start_waiting()
        } catch (e) {
            error = e.message
        } finally {
            busy = false
        }
    }

    async function provision_tick() {
        try {
            const r = await window.api.onboardProvisionPoll()
            progress = r
            if (r.complete) {
                clearInterval(poll_timer)
                step = 'done'
            }
        } catch (e) {
            error = e.message
        }
    }

    function start_waiting() {
        clearInterval(poll_timer)
        provision_tick()
        poll_timer = setInterval(provision_tick, 10000)
    }

    function finish() {
        clearInterval(poll_timer)
        onrefresh?.()
    }

    $effect(() => {
        decide_step()
        return () => clearInterval(poll_timer)
    })
</script>

<div class="wizard">
    <div class="wizard-head">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="40" height="40" class="logo">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
        <h1>Welcome to jseeqret</h1>
        <p class="subtitle">Let's get your vault set up.</p>
    </div>

    {#if error}
        <div class="alert error">{error}</div>
    {/if}

    {#if step === 'loading'}
        <p class="muted">Loading...</p>

    {:else if step === 'create'}
        <div class="card">
            <h2>Create your vault</h2>
            <p class="muted">
                Pick a folder for your personal vault. Everything else is
                automatic.
            </p>
            <button class="primary" disabled={busy} onclick={create_vault}>
                {busy ? 'Creating...' : 'Choose folder & create vault'}
            </button>
        </div>

    {:else if step === 'slack'}
        <div class="card">
            <h2>Connect Slack</h2>
            <p class="muted">
                Sign in to Slack and pick the <code>#seeqrets</code> channel.
                This is how your team lead reaches you.
            </p>
            <SlackStatusCard onready={decide_step} />
        </div>

    {:else if step === 'introduce'}
        <div class="card">
            <h2>Introduce yourself</h2>
            {#if !invite}
                <p class="muted">
                    Waiting for an invite from your team lead in
                    <code>#seeqrets</code>...
                </p>
                <button class="ghost" disabled={busy} onclick={refresh_invite}>
                    {busy ? 'Checking...' : 'Check again'}
                </button>
            {:else}
                <p class="muted">
                    Get on a voice call with your team lead. Confirm THEIR
                    fingerprint below matches what they read aloud, and read
                    them YOURS. Never trust a fingerprint over Slack alone.
                </p>

                <div class="fp-pair">
                    <div class="fp-box">
                        <span class="fp-label">Team lead's fingerprint</span>
                        <span class="fp">{invite.tl_fingerprint}</span>
                    </div>
                    {#if me?.fingerprint}
                        <div class="fp-box">
                            <span class="fp-label">Your fingerprint (read aloud)</span>
                            <span class="fp">{me.fingerprint}</span>
                        </div>
                    {/if}
                </div>

                <label class="check">
                    <input type="checkbox" bind:checked={verified}>
                    I verified the team lead's fingerprint on a voice call
                </label>
                <label class="field">
                    <span>Type the team lead's fingerprint to confirm</span>
                    <input type="text" bind:value={typed} placeholder={invite.tl_fingerprint} autocomplete="off" spellcheck="false">
                </label>

                <button class="primary" disabled={!can_join} onclick={join}>
                    {busy ? 'Sending...' : 'Confirm & introduce myself'}
                </button>
            {/if}
        </div>

    {:else if step === 'waiting'}
        <div class="card">
            <h2>Waiting to be approved</h2>
            <p class="muted">
                Your team lead is verifying your fingerprint and approving you.
                This screen updates automatically.
            </p>
            {#if me?.fingerprint}
                <div class="fp-box center">
                    <span class="fp-label">Read this to your team lead</span>
                    <span class="fp">{me.fingerprint}</span>
                </div>
            {/if}
            {#if progress && (progress.imported_users || progress.imported_secrets)}
                <p class="muted">
                    Imported {progress.imported_users} teammate(s),
                    {progress.imported_secrets} secret(s) so far...
                </p>
            {/if}
            <div class="spinner"></div>
        </div>

    {:else if step === 'done'}
        <div class="card center">
            <svg viewBox="0 0 24 24" fill="none" stroke="var(--success)" stroke-width="2" width="48" height="48"><polyline points="20 6 9 17 4 12" /></svg>
            <h2>You're set up!</h2>
            <p class="muted">
                Your teammates and secrets have been imported.
            </p>
            <button class="primary" onclick={finish}>Go to dashboard</button>
        </div>
    {/if}
</div>

<style>
    .wizard {
        max-width: 560px;
        margin: 40px auto;
        display: flex;
        flex-direction: column;
        gap: 20px;
    }

    .wizard-head {
        text-align: center;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
    }

    .logo {
        color: var(--accent);
    }

    .wizard-head h1 {
        font-size: 24px;
        font-weight: 700;
    }

    .subtitle {
        color: var(--text-muted);
    }

    .card {
        background: var(--bg-card);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        padding: 24px;
        display: flex;
        flex-direction: column;
        gap: 14px;
    }

    .card.center {
        align-items: center;
        text-align: center;
    }

    h2 {
        font-size: 18px;
        font-weight: 600;
    }

    .muted {
        color: var(--text-muted);
        font-size: 14px;
        line-height: 1.5;
    }

    code {
        background: var(--bg-input);
        padding: 1px 5px;
        border-radius: 4px;
        font-family: var(--font-mono);
        font-size: 13px;
    }

    .fp-pair {
        display: flex;
        gap: 12px;
        flex-wrap: wrap;
    }

    .fp-box {
        flex: 1;
        min-width: 180px;
        background: var(--bg);
        border: 1px solid var(--border);
        border-radius: 8px;
        padding: 14px;
        display: flex;
        flex-direction: column;
        gap: 8px;
        align-items: center;
    }

    .fp-box.center {
        align-self: center;
    }

    .fp-label {
        font-size: 12px;
        color: var(--text-muted);
    }

    .fp {
        font-family: var(--font-mono);
        font-size: 36px;
        font-weight: 700;
        letter-spacing: 0.15em;
        color: var(--success);
    }

    .check {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 14px;
        cursor: pointer;
    }

    .field {
        display: flex;
        flex-direction: column;
        gap: 6px;
        font-size: 13px;
        color: var(--text-muted);
    }

    .field input {
        padding: 8px 10px;
        background: var(--bg-input);
        border: 1px solid var(--border);
        border-radius: 6px;
        color: var(--text);
        font-family: var(--font-mono);
        font-size: 14px;
    }

    .primary {
        align-self: flex-start;
        padding: 10px 18px;
        background: var(--accent);
        color: #fff;
        border: none;
        border-radius: 6px;
        font-size: 14px;
        cursor: pointer;
    }

    .card.center .primary {
        align-self: center;
    }

    .primary:disabled {
        opacity: 0.5;
        cursor: default;
    }

    .ghost {
        align-self: flex-start;
        padding: 8px 16px;
        background: transparent;
        color: var(--text-muted);
        border: 1px solid var(--border);
        border-radius: 6px;
        cursor: pointer;
    }

    .alert.error {
        background: rgba(233, 69, 96, 0.15);
        border: 1px solid var(--accent);
        color: var(--accent);
        padding: 10px 14px;
        border-radius: 6px;
        font-size: 13px;
    }

    .spinner {
        width: 28px;
        height: 28px;
        border: 3px solid var(--border);
        border-top-color: var(--accent);
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
        align-self: center;
    }

    @keyframes spin {
        to { transform: rotate(360deg); }
    }
</style>
