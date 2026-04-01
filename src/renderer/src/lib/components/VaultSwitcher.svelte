<script>
    const VAULT_COLORS = ['#e94560', '#4ecca3', '#0f3460', '#8892a4', '#f0a030']

    function vault_color(name) {
        const idx = name.charCodeAt(0) % VAULT_COLORS.length
        return VAULT_COLORS[idx]
    }

    let { active_vault = null, onswitch } = $props()
    let open = $state(false)
    let vaults = $state([])
    let loading = $state(true)
    let creating = $state(false)
    let dropdown_el = $state(null)

    async function load_vaults() {
        try {
            vaults = await window.api.listVaults()
        } catch {
            vaults = []
        } finally {
            loading = false
        }
    }

    async function switch_vault(vault) {
        try {
            const data = { name: vault.name }
            if (vault.from_env) data.vault_path = vault.path
            await window.api.switchVault(data)
            open = false
            onswitch?.()
        } catch (e) {
            console.error('Failed to switch vault:', e)
        }
    }

    async function create_vault() {
        creating = true
        try {
            const result = await window.api.createVault()
            if (!result.canceled) {
                await load_vaults()
                open = false
                onswitch?.()
            }
        } catch (e) {
            console.error('Failed to create vault:', e)
        } finally {
            creating = false
        }
    }

    async function remove_vault(name) {
        try {
            await window.api.removeVault({ name })
            await load_vaults()
        } catch (e) {
            console.error('Failed to remove vault:', e)
        }
    }

    function handle_click_outside(event) {
        if (dropdown_el && !dropdown_el.contains(event.target)) {
            open = false
        }
    }

    $effect(() => {
        load_vaults()
    })

    $effect(() => {
        if (open) {
            document.addEventListener('mousedown', handle_click_outside)
        } else {
            document.removeEventListener('mousedown', handle_click_outside)
        }
        return () => document.removeEventListener('mousedown', handle_click_outside)
    })
</script>

{#if !loading}
    <div class="vault-switcher" bind:this={dropdown_el}>
        <button
            class="vault-trigger"
            class:is-open={open}
            onclick={() => { open = !open }}
        >
            <span class="vault-icon" style="background: {vault_color(active_vault || '')}">
                {(active_vault || '?')[0].toUpperCase()}
            </span>
            <span class="vault-trigger-info">
                <span class="vault-trigger-name">{active_vault || 'No vault'}</span>
                <span class="vault-trigger-meta">
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="10" height="10">
                        <rect x="3" y="7" width="10" height="8" rx="2" />
                        <path d="M5 7V5a3 3 0 016 0v2" stroke-linecap="round" />
                    </svg>
                    {vaults.length} vault{vaults.length !== 1 ? 's' : ''}
                </span>
            </span>
            <svg class="vault-chevron" class:rotated={open} viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="11" height="11">
                <path d="M2 4l4 4 4-4" />
            </svg>
        </button>

        {#if open}
            <div class="vault-dropdown">
                <div class="dropdown-header">Switch Vault</div>

                <div class="vault-list">
                    {#each vaults as vault (vault.name)}
                        <div
                            class="vault-item"
                            class:active={vault.name === active_vault}
                        >
                            <button
                                class="vault-item-main"
                                onclick={() => switch_vault(vault)}
                            >
                                <span class="vault-icon small" style="background: {vault_color(vault.name)}">
                                    {vault.name[0].toUpperCase()}
                                </span>
                                <span class="vault-item-info">
                                    <span class="vault-item-name">
                                        {vault.name}
                                        {#if vault.is_default}
                                            <span class="badge default">DEFAULT</span>
                                        {/if}
                                        {#if vault.from_env}
                                            <span class="badge env">{vault.from_env}</span>
                                        {/if}
                                        {#if !vault.initialized}
                                            <span class="badge warning">NOT INIT</span>
                                        {/if}
                                    </span>
                                    <span class="vault-item-path">{vault.path}</span>
                                </span>
                                {#if vault.name === active_vault}
                                    <svg class="check-icon" viewBox="0 0 14 14" fill="none" width="14" height="14">
                                        <path d="M2 7l4 4 6-7" stroke="var(--success)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
                                    </svg>
                                {/if}
                            </button>
                            {#if vault.name !== active_vault}
                                <button
                                    class="vault-remove-btn"
                                    title="Unregister vault"
                                    onclick={() => remove_vault(vault.name)}
                                >
                                    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" width="10" height="10">
                                        <path d="M2 2l8 8M10 2l-8 8" />
                                    </svg>
                                </button>
                            {/if}
                        </div>
                    {/each}
                </div>

                <div class="dropdown-footer">
                    <button
                        class="add-vault-btn"
                        disabled={creating}
                        onclick={create_vault}
                    >
                        <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" width="11" height="11">
                            <path d="M7 2v10M2 7h10" />
                        </svg>
                        {creating ? 'Creating...' : 'Create Vault'}
                    </button>
                </div>
            </div>
        {/if}
    </div>
{/if}

<style>
    .vault-switcher {
        padding: 12px 12px 0;
        position: relative;
    }

    .vault-trigger {
        width: 100%;
        background: transparent;
        border: 1px solid var(--border);
        border-radius: var(--radius);
        padding: 8px 10px;
        display: flex;
        align-items: center;
        gap: 10px;
        cursor: pointer;
        transition: all 0.15s;
        color: var(--text);
    }

    .vault-trigger:hover,
    .vault-trigger.is-open {
        background: var(--bg-card);
        border-color: rgba(233, 69, 96, 0.35);
    }

    .vault-trigger:active {
        transform: none;
    }

    .vault-icon {
        width: 30px;
        height: 30px;
        border-radius: 6px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 13px;
        font-weight: 700;
        color: #fff;
        flex-shrink: 0;
        font-family: var(--font-mono);
    }

    .vault-icon.small {
        width: 26px;
        height: 26px;
        font-size: 11px;
    }

    .vault-trigger-info {
        flex: 1;
        text-align: left;
        min-width: 0;
    }

    .vault-trigger-name {
        display: block;
        font-size: 13px;
        font-weight: 600;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .vault-trigger-meta {
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: 10px;
        color: var(--text-muted);
        margin-top: 1px;
    }

    .vault-chevron {
        color: var(--text-muted);
        flex-shrink: 0;
        transition: transform 0.2s;
    }

    .vault-chevron.rotated {
        transform: rotate(180deg);
    }

    .vault-dropdown {
        position: absolute;
        top: calc(100% + 4px);
        left: 12px;
        right: 12px;
        background: var(--bg-card);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        z-index: 100;
        overflow: hidden;
        box-shadow: 0 16px 40px rgba(0, 0, 0, 0.7);
    }

    .dropdown-header {
        padding: 8px 10px 6px;
        border-bottom: 1px solid var(--border);
        font-size: 10px;
        font-weight: 600;
        color: var(--text-muted);
        text-transform: uppercase;
        letter-spacing: 0.08em;
    }

    .vault-list {
        max-height: 240px;
        overflow-y: auto;
    }

    .vault-item {
        display: flex;
        align-items: center;
        border-bottom: 1px solid rgba(42, 42, 74, 0.4);
    }

    .vault-item:last-child {
        border-bottom: none;
    }

    .vault-item-main {
        flex: 1;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 10px;
        background: transparent;
        border: none;
        border-radius: 0;
        cursor: pointer;
        color: var(--text);
        min-width: 0;
        text-align: left;
    }

    .vault-item-main:hover {
        background: var(--bg-input);
    }

    .vault-item-main:active {
        transform: none;
    }

    .vault-item.active .vault-item-main {
        background: rgba(233, 69, 96, 0.08);
    }

    .vault-item-info {
        flex: 1;
        min-width: 0;
    }

    .vault-item-name {
        display: flex;
        align-items: center;
        gap: 5px;
        font-size: 12px;
        font-weight: 500;
    }

    .vault-item-path {
        display: block;
        font-size: 10px;
        color: var(--text-muted);
        margin-top: 1px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        font-family: var(--font-mono);
    }

    .badge {
        font-size: 9px;
        border-radius: 4px;
        padding: 1px 5px;
        font-weight: 600;
    }

    .badge.default {
        background: rgba(233, 69, 96, 0.15);
        color: var(--accent);
    }

    .badge.env {
        background: rgba(78, 204, 163, 0.15);
        color: var(--success);
    }

    .badge.warning {
        background: rgba(240, 160, 48, 0.15);
        color: var(--warning);
    }

    .check-icon {
        flex-shrink: 0;
    }

    .vault-remove-btn {
        padding: 6px 8px;
        background: transparent;
        border: none;
        border-radius: 4px;
        color: var(--text-muted);
        cursor: pointer;
        opacity: 0;
        transition: all 0.15s;
        margin-right: 4px;
    }

    .vault-item:hover .vault-remove-btn {
        opacity: 1;
    }

    .vault-remove-btn:hover {
        color: var(--accent);
        background: rgba(233, 69, 96, 0.15);
    }

    .vault-remove-btn:active {
        transform: none;
    }

    .dropdown-footer {
        border-top: 1px solid var(--border);
        padding: 6px 10px;
    }

    .add-vault-btn {
        width: 100%;
        background: transparent;
        border: 1px dashed var(--border);
        border-radius: 6px;
        padding: 6px 0;
        color: var(--text-muted);
        font-size: 11px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        transition: all 0.15s;
    }

    .add-vault-btn:hover {
        border-color: var(--accent);
        color: var(--accent);
    }

    .add-vault-btn:active {
        transform: none;
    }

    .add-vault-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }
</style>
