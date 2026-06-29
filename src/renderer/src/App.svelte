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
    import OnboardingView from './lib/components/OnboardingView.svelte'
    import OnboardingWizard from './lib/components/OnboardingWizard.svelte'

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

    function handle_vault_switch() {
        refresh_key++
        load_status()
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
        onvaultswitch={handle_vault_switch}
    />

    <main class="main-content">
        {#if !vault_status}
            <div class="loading">
                <div class="loading-spinner"></div>
                <span>Connecting to vault...</span>
            </div>
        {:else if !vault_status.initialized}
            <OnboardingWizard vault_status={vault_status} onrefresh={handle_vault_switch} />
        {:else}
            {#key refresh_key}
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

                    <SecretList {filter} />
                </div>
            {:else if view === 'users'}
                <UserList />
            {:else if view === 'export'}
                <ExportView />
            {:else if view === 'import'}
                <ImportView />
            {:else if view === 'introduction'}
                <IntroductionView />
            {:else if view === 'onboarding'}
                <OnboardingView />
            {/if}
            {/key}
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
