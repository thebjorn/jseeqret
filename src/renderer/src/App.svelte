<script>
  import SecretList from './lib/components/SecretList.svelte'
  import SecretForm from './lib/components/SecretForm.svelte'
  import UserList from './lib/components/UserList.svelte'
  import FilterBar from './lib/components/FilterBar.svelte'
  import StatusBar from './lib/components/StatusBar.svelte'

  let view = $state('secrets')
  let filter = $state('*')
  let showAddForm = $state(false)
  let refreshKey = $state(0)
  let vaultStatus = $state(null)

  async function loadStatus() {
    try {
      vaultStatus = await window.api.getVaultStatus()
    } catch (e) {
      vaultStatus = { initialized: false, error: e.message }
    }
  }

  function onSecretAdded() {
    showAddForm = false
    refreshKey++
  }

  $effect(() => {
    loadStatus()
  })
</script>

<div class="app">
  <header>
    <h1>jseeqret</h1>
    <nav>
      <button class:active={view === 'secrets'} onclick={() => view = 'secrets'}>
        Secrets
      </button>
      <button class:active={view === 'users'} onclick={() => view = 'users'}>
        Users
      </button>
    </nav>
  </header>

  {#if !vaultStatus}
    <div class="loading">Loading...</div>
  {:else if !vaultStatus.initialized}
    <div class="not-initialized">
      <h2>Vault not initialized</h2>
      <p>Set the JSEEQRET environment variable (or SEEQRET) and restart, or use the CLI:</p>
      <code>jseeqret init &lt;dir&gt; --user &lt;username&gt; --email &lt;email&gt;</code>
    </div>
  {:else}
    <StatusBar status={vaultStatus} />

    {#if view === 'secrets'}
      <div class="toolbar">
        <FilterBar bind:filter onchange={() => refreshKey++} />
        <button class="primary" onclick={() => showAddForm = !showAddForm}>
          {showAddForm ? 'Cancel' : '+ Add Secret'}
        </button>
      </div>

      {#if showAddForm}
        <SecretForm onsubmit={onSecretAdded} />
      {/if}

      {#key refreshKey}
        <SecretList {filter} />
      {/key}
    {:else if view === 'users'}
      <UserList />
    {/if}
  {/if}
</div>

<style>
  .app {
    max-width: 1100px;
    margin: 0 auto;
    padding: 20px;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 24px;
    padding-bottom: 16px;
    border-bottom: 1px solid var(--border);
  }

  header h1 {
    font-size: 24px;
    font-family: var(--font-mono);
    color: var(--accent);
  }

  nav {
    display: flex;
    gap: 8px;
  }

  nav button {
    background: transparent;
    color: var(--text-muted);
    padding: 6px 16px;
    border-radius: 6px;
    font-size: 14px;
  }

  nav button:hover, nav button.active {
    background: var(--bg-input);
    color: var(--text);
  }

  .toolbar {
    display: flex;
    gap: 12px;
    align-items: center;
    margin-bottom: 16px;
  }

  .not-initialized {
    text-align: center;
    padding: 60px 20px;
  }

  .not-initialized h2 {
    margin-bottom: 12px;
    color: var(--accent);
  }

  .not-initialized code {
    display: inline-block;
    margin-top: 12px;
    padding: 8px 16px;
    background: var(--bg-input);
    border-radius: 6px;
    font-family: var(--font-mono);
  }

  .loading {
    text-align: center;
    padding: 60px;
    color: var(--text-muted);
  }
</style>
