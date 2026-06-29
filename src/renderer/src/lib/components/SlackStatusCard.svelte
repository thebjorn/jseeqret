<script>
    // Reusable Slack session card: login button, channel picker, and a
    // doctor traffic-light. Used by both the Team Lead panel and the
    // new-user wizard. All logic lives in core behind window.api.slack*.

    let { onready = null } = $props()

    let status = $state(null)
    let channels = $state([])
    let busy = $state(false)
    let error = $state(null)

    async function load_status() {
        try {
            status = await window.api.slackStatus()
            if (status?.ready) onready?.()
        } catch (e) {
            error = e.message
        }
    }

    async function login() {
        busy = true
        error = null
        try {
            const session = await window.api.slackLogin()
            channels = session.channels || []
            if (channels.length === 0) {
                error = 'No private channels found. Create #seeqrets and re-try.'
            }
            await load_status()
        } catch (e) {
            error = e.message
        } finally {
            busy = false
        }
    }

    async function pick_channel(channel) {
        busy = true
        error = null
        try {
            await window.api.slackSetChannel({
                channel_id: channel.id,
                channel_name: channel.name,
            })
            channels = []
            await load_status()
        } catch (e) {
            error = e.message
        } finally {
            busy = false
        }
    }

    $effect(() => {
        load_status()
    })
</script>

<div class="slack-card">
    <div class="slack-head">
        <span class="slack-title">Slack exchange</span>
        {#if status}
            <span class="light" class:ready={status.ready}></span>
            <span class="light-label">{status.ready ? 'Ready' : 'Not ready'}</span>
        {/if}
    </div>

    {#if error}
        <div class="alert error">{error}</div>
    {/if}

    {#if status && !status.logged_in}
        <p class="muted">Sign in to Slack to use the exchange channel.</p>
        <button class="primary" disabled={busy} onclick={login}>
            {busy ? 'Opening browser...' : 'Sign in to Slack'}
        </button>
    {:else if channels.length > 0}
        <p class="muted">Pick the exchange channel:</p>
        <div class="channel-list">
            {#each channels as c (c.id)}
                <button class="channel" disabled={busy} onclick={() => pick_channel(c)}>
                    #{c.name}
                </button>
            {/each}
        </div>
    {:else if status}
        <div class="rows">
            <div class="row"><span>Team</span><span>{status.team_name || '?'}</span></div>
            <div class="row"><span>Channel</span><span>#{status.channel_name || '(none)'}</span></div>
            {#if status.token_age_days != null}
                <div class="row"><span>Token age</span><span>{status.token_age_days} days</span></div>
            {/if}
        </div>
        {#if !status.ready && status.problems?.length}
            <ul class="problems">
                {#each status.problems as p}
                    <li>{p}</li>
                {/each}
            </ul>
        {/if}
    {/if}
</div>

<style>
    .slack-card {
        background: var(--bg-card);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    .slack-head {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .slack-title {
        font-weight: 600;
        font-size: 14px;
        flex: 1;
    }

    .light {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background: var(--accent);
    }

    .light.ready {
        background: var(--success);
        box-shadow: 0 0 6px rgba(78, 204, 163, 0.5);
    }

    .light-label {
        font-size: 12px;
        color: var(--text-muted);
    }

    .muted {
        color: var(--text-muted);
        font-size: 13px;
    }

    .channel-list {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
    }

    .channel {
        padding: 6px 12px;
        background: var(--bg-input);
        border: 1px solid var(--border);
        border-radius: 6px;
        font-family: var(--font-mono);
        font-size: 13px;
        color: var(--text);
        cursor: pointer;
    }

    .channel:hover {
        border-color: var(--accent);
    }

    .rows {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }

    .row {
        display: flex;
        justify-content: space-between;
        font-size: 13px;
    }

    .row span:first-child {
        color: var(--text-muted);
    }

    .problems {
        margin: 0;
        padding-left: 18px;
        color: var(--accent);
        font-size: 12px;
    }

    .alert.error {
        background: rgba(233, 69, 96, 0.15);
        border: 1px solid var(--accent);
        color: var(--accent);
        padding: 8px 12px;
        border-radius: 6px;
        font-size: 13px;
    }

    .primary {
        align-self: flex-start;
        padding: 8px 16px;
        background: var(--accent);
        color: #fff;
        border: none;
        border-radius: 6px;
        font-size: 13px;
        cursor: pointer;
    }

    .primary:disabled {
        opacity: 0.6;
        cursor: default;
    }
</style>
