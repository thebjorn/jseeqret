<script>
    // The fingerprint gate. Shows the captured fingerprint big, requires an
    // explicit "verified on a voice call" checkbox plus a type-back, and
    // keeps Approve disabled until both are satisfied. The flag is passed to
    // the core primitive, which RE-VALIDATES it -- this dialog is UX, not
    // authority (see documentation/completed/onboarding/plan.md, Trust model).

    let { row, self_fingerprint = null, onclose, onapproved } = $props()

    let verified = $state(false)
    let typed = $state('')
    let busy = $state(false)
    let error = $state(null)

    const can_approve = $derived(
        verified && typed.trim() === row.fingerprint && !busy
    )

    async function approve() {
        if (!can_approve) return
        busy = true
        error = null
        try {
            const summary = await window.api.onboardApprove({
                email: row.email,
                verified: true,
                fingerprint: typed.trim(),
            })
            onapproved?.(summary)
        } catch (e) {
            error = e.message
            busy = false
        }
    }
</script>

<div
    class="backdrop"
    role="presentation"
    onclick={(e) => { if (e.target === e.currentTarget) onclose?.() }}
>
    <div class="dialog" role="dialog" aria-modal="true" tabindex="-1">
        <h2>Approve {row.name ? `${row.name} <${row.email}>` : row.email}</h2>
        <p class="muted">
            Verify this fingerprint OUT-OF-BAND on a voice call before
            approving. Never trust a fingerprint that came over Slack.
        </p>

        <div class="fingerprint">{row.fingerprint}</div>

        {#if self_fingerprint}
            <div class="own-fp">
                Read YOUR fingerprint back to them:
                <span class="own-fp-value">{self_fingerprint}</span>
            </div>
        {/if}

        {#if error}
            <div class="alert error">{error}</div>
        {/if}

        <label class="check">
            <input type="checkbox" bind:checked={verified}>
            I verified this fingerprint on a voice call
        </label>

        <label class="field">
            <span>Type the fingerprint back to confirm</span>
            <input
                type="text"
                bind:value={typed}
                placeholder={row.fingerprint}
                autocomplete="off"
                spellcheck="false"
            >
        </label>

        <div class="actions">
            <button class="ghost" onclick={onclose}>Cancel</button>
            <button class="primary" disabled={!can_approve} onclick={approve}>
                {busy ? 'Approving...' : 'Approve & provision'}
            </button>
        </div>
    </div>
</div>

<style>
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
        width: 440px;
        max-width: 90vw;
        background: var(--bg-card);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        padding: 24px;
        display: flex;
        flex-direction: column;
        gap: 14px;
    }

    h2 {
        font-size: 18px;
        font-weight: 600;
    }

    .muted {
        color: var(--text-muted);
        font-size: 13px;
        line-height: 1.5;
    }

    .fingerprint {
        font-family: var(--font-mono);
        font-size: 48px;
        font-weight: 700;
        letter-spacing: 0.15em;
        text-align: center;
        color: var(--success);
        background: var(--bg);
        border: 1px solid var(--border);
        border-radius: 8px;
        padding: 16px;
    }

    .own-fp {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        font-size: 13px;
        color: var(--text-muted);
        background: var(--bg);
        border: 1px solid var(--border);
        border-radius: 6px;
        padding: 8px 12px;
    }

    .own-fp-value {
        font-family: var(--font-mono);
        font-size: 20px;
        font-weight: 700;
        letter-spacing: 0.12em;
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

    .actions {
        display: flex;
        justify-content: flex-end;
        gap: 10px;
        margin-top: 4px;
    }

    .ghost {
        padding: 8px 16px;
        background: transparent;
        color: var(--text-muted);
        border: 1px solid var(--border);
        border-radius: 6px;
        cursor: pointer;
    }

    .primary {
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

    .alert.error {
        background: rgba(233, 69, 96, 0.15);
        border: 1px solid var(--accent);
        color: var(--danger-text);
        padding: 8px 12px;
        border-radius: 6px;
        font-size: 13px;
    }
</style>
