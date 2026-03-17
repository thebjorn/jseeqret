<script>
    import Sidebar from './lib/components/Sidebar.svelte'
    import DashboardView from './lib/components/DashboardView.svelte'
    import SecretList from './lib/components/SecretList.svelte'
    import SecretForm from './lib/components/SecretForm.svelte'
    import UserList from './lib/components/UserList.svelte'
    import FilterBar from './lib/components/FilterBar.svelte'
    import ExportView from './lib/components/ExportView.svelte'
    import ImportView from './lib/components/ImportView.svelte'
    import IntroductionView from './lib/components/IntroductionView.svelte'

    let view = $state('dashboard')
    let filter = $state('*')
    let show_add_form = $state(false)
    let refresh_key = $state(0)
    let vault_status = $state(null)

    async function load_status() {
        try {
            vault_status = await window.api.getVaultStatus()
        } catch (e) {
            vault_status = { initialized: false, error: e.message }
        }
    }

    function on_secret_added() {
        show_add_form = false
        refresh_key++
    }

    function navigate(target) {
        view = target
    }

    $effect(() => {
        load_status()
    })
</script>

<div class="app-layout">
    <Sidebar
        {view}
        onnavigate={navigate}
        status={vault_status}
    />

    <main class="main-content">
        {#if !vault_status}
            <div class="loading">
                <div class="loading-spinner"></div>
                <span>Connecting to vault...</span>
            </div>
        {:else if !vault_status.initialized}
            <div class="not-initialized">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="48" height="48" class="init-icon">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
                <h2>Vault not initialized</h2>
                <p>
                    Set the <code>JSEEQRET</code> environment variable
                    (or <code>SEEQRET</code>) and restart, or use the CLI:
                </p>
                <div class="init-command">
                    <code>jseeqret init &lt;dir&gt; --user &lt;username&gt; --email &lt;email&gt;</code>
                </div>
            </div>
        {:else}
            {#if view === 'dashboard'}
                <DashboardView status={vault_status} onnavigate={navigate} />
            {:else if view === 'secrets'}
                <div class="secrets-view">
                    <div class="page-header">
                        <h1>Secrets</h1>
                        <p class="subtitle">Manage encrypted secrets in your vault</p>
                    </div>

                    <div class="toolbar">
                        <FilterBar bind:filter onchange={() => refresh_key++} />
                        <button class="primary" onclick={() => show_add_form = !show_add_form}>
                            {show_add_form ? 'Cancel' : '+ Add Secret'}
                        </button>
                    </div>

                    {#if show_add_form}
                        <SecretForm onsubmit={on_secret_added} />
                    {/if}

                    {#key refresh_key}
                        <SecretList {filter} />
                    {/key}
                </div>
            {:else if view === 'users'}
                <UserList />
            {:else if view === 'export'}
                <ExportView />
            {:else if view === 'import'}
                <ImportView />
            {:else if view === 'introduction'}
                <IntroductionView />
            {/if}
        {/if}
    </main>
</div>

<style>
    .app-layout {
        display: flex;
        height: 100vh;
        overflow: hidden;
    }

    .main-content {
        flex: 1;
        overflow-y: auto;
        padding: 28px 32px;
    }

    .secrets-view {
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
        gap: 12px;
        align-items: center;
    }

    .not-initialized {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        text-align: center;
        padding: 80px 20px;
        gap: 16px;
    }

    .init-icon {
        color: var(--accent);
        opacity: 0.6;
    }

    .not-initialized h2 {
        color: var(--accent);
        font-size: 20px;
    }

    .not-initialized p {
        color: var(--text-muted);
        max-width: 500px;
    }

    .not-initialized code {
        background: var(--bg-input);
        padding: 2px 6px;
        border-radius: 4px;
        font-family: var(--font-mono);
        font-size: 13px;
    }

    .init-command {
        margin-top: 8px;
    }

    .init-command code {
        display: inline-block;
        padding: 10px 18px;
        background: var(--bg-card);
        border: 1px solid var(--border);
        border-radius: 6px;
        font-family: var(--font-mono);
        font-size: 14px;
        color: var(--success);
    }

    .loading {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 80px;
        gap: 16px;
        color: var(--text-muted);
    }

    .loading-spinner {
        width: 32px;
        height: 32px;
        border: 3px solid var(--border);
        border-top-color: var(--accent);
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
        to { transform: rotate(360deg); }
    }
</style>
