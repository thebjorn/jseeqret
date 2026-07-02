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
    let introduced = $state(false) // introduction already sent to the TL
    let reintroduce = $state(false) // recovery: force a re-send on confirm
    let progress = $state(null)    // { imported_users, imported_secrets, complete }
    let poll_timer = null

    const can_join = $derived(
        invite && verified && typed.trim() === invite.tl_fingerprint && !busy
    )

    // Distinct provisioning warnings (poll repeats them every tick). A
    // failed import must be visible -- otherwise the waiting step spins
    // forever with no explanation.
    const warning_msgs = $derived(
        [...new Set((progress?.warnings || []).map(w => `${w.kind}: ${w.error}`))]
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
        await auto_introduce()
        step = 'introduce'
    }

    // Send the introduction as soon as an invite is found. It only
    // publishes our own pubkey/fingerprint (nothing to protect), so the
    // TL sees progress immediately; the voice-call verification below
    // still gates trust in the TL's key. Idempotent in core -- calling
    // this on every refresh sends at most one introduction.
    async function auto_introduce() {
        if (!invite) return
        try {
            const r = await window.api.onboardIntroduce({
                tl_slack_user_id: invite.tl_slack_user_id,
                email: invite.email,
            })
            me = me || {}
            me.fingerprint = r.fingerprint
            introduced = true
        } catch {
            // Best-effort: the confirm button still sends it via join.
        }
    }

    async function create_vault() {
        busy = true
        error = null
        try {
            // onboarding: true marks the new vault as mid-wizard so the
            // app keeps this component mounted after `initialized` flips.
            const result = await window.api.createVault({ onboarding: true })
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
            await auto_introduce()
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
                // Introduce under the email the TL invited us by, not the
                // vault's user@host placeholder, so the TL can match us.
                email: invite.email,
                // Recovery must re-send even though we already introduced.
                force: reintroduce,
            })
            me = me || {}
            me.fingerprint = r.fingerprint
            introduced = true
            reintroduce = false
            step = 'waiting'
            start_waiting()
        } catch (e) {
            error = e.message
        } finally {
            busy = false
        }
    }

    // Recovery from a stuck "waiting" state: if the team lead never
    // approves (e.g. an earlier introduction went out under the wrong
    // identity, or the introduction was lost to Slack retention), let the
    // user re-introduce. We route BACK THROUGH the introduce step rather
    // than re-joining silently, so the out-of-band fingerprint gate is
    // re-applied and we never re-anchor trust on a Slack-delivered key
    // without a fresh human check.
    async function recover_reintroduce() {
        busy = true
        error = null
        try {
            const inv = await window.api.onboardReceiveInvite()
            if (!inv) {
                error = 'No invite found in #seeqrets. Ask your team lead to'
                    + ' resend the invite, then try again.'
                return
            }
            clearInterval(poll_timer)
            invite = inv
            verified = false
            typed = ''
            introduced = false
            reintroduce = true
            step = 'introduce'
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

    async function finish() {
        clearInterval(poll_timer)
        try {
            await window.api.onboardWizardDone()
        } catch (e) {
            error = e.message
            return
        }
        onrefresh?.()
    }

    // Escape hatch for a team lead (or a restore) whose fresh vault has
    // no inviter: leave the wizard without completing Slack onboarding.
    async function skip_onboarding() {
        busy = true
        error = null
        try {
            await window.api.onboardWizardDone()
            clearInterval(poll_timer)
            onrefresh?.()
        } catch (e) {
            error = e.message
        } finally {
            busy = false
        }
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
                {#if introduced}
                    <p class="sent-note">
                        Your introduction is on its way to your team lead.
                    </p>
                {/if}
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
                    {#if busy}
                        Sending...
                    {:else if introduced}
                        Confirm verification
                    {:else}
                        Confirm & introduce myself
                    {/if}
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
            {#if warning_msgs.length}
                <div class="alert warn">
                    <strong>Some deliveries could not be imported:</strong>
                    <ul>
                        {#each warning_msgs as w (w)}
                            <li>{w}</li>
                        {/each}
                    </ul>
                </div>
            {/if}
            <div class="spinner"></div>
            <div class="recover">
                <p class="muted">
                    Stuck here for a while? Your team lead may need to resend
                    the invite. Then re-verify their fingerprint and introduce
                    yourself again.
                </p>
                <button class="ghost" disabled={busy} onclick={recover_reintroduce}>
                    {busy ? 'Checking...' : 'Re-verify & re-introduce'}
                </button>
            </div>
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

    {#if step === 'slack' || step === 'introduce' || step === 'waiting'}
        <div class="wizard-foot">
            <button class="link" disabled={busy} onclick={skip_onboarding}>
                Skip onboarding — I'm setting up a new team
            </button>
            <button class="link" onclick={() => window.api.openLogs()}>
                Open logs
            </button>
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

    .alert.warn {
        background: rgba(240, 165, 0, 0.12);
        border: 1px solid rgba(240, 165, 0, 0.6);
        color: var(--text);
        padding: 10px 14px;
        border-radius: 6px;
        font-size: 13px;
    }

    .alert.warn ul {
        margin: 6px 0 0;
        padding-left: 18px;
    }

    .sent-note {
        color: var(--success);
        font-size: 13px;
    }

    .wizard-foot {
        display: flex;
        justify-content: space-between;
        gap: 12px;
    }

    .link {
        background: none;
        border: none;
        padding: 0;
        color: var(--text-muted);
        font-size: 12px;
        cursor: pointer;
        text-decoration: underline;
    }

    .link:disabled {
        opacity: 0.5;
        cursor: default;
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

    .recover {
        display: flex;
        flex-direction: column;
        gap: 10px;
        margin-top: 8px;
        padding-top: 14px;
        border-top: 1px solid var(--border);
    }

    @keyframes spin {
        to { transform: rotate(360deg); }
    }
</style>
