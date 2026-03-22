<script>
  let { onsubmit } = $props()
  let app = $state('*')
  let env = $state('*')
  let key = $state('')
  let value = $state('')
  let type = $state('str')
  let error = $state(null)
  let app_options = $state([])
  let env_options = $state([])

  async function load_options() {
      try {
          const secrets = await window.api.getSecrets('*')
          app_options = [...new Set(secrets.map(s => s.app))].sort()
          env_options = [...new Set(secrets.map(s => s.env))].sort()
      } catch {
          // vault might not be initialized
      }
  }

  async function handleSubmit(e) {
      e.preventDefault()
      if (!key || !value) {
          error = 'Key and value are required'
          return
      }
      try {
          error = null
          await window.api.addSecret({ app, env, key, value, type })
          if (onsubmit) onsubmit()
      } catch (e) {
          error = e.message
      }
  }

  $effect(() => {
      load_options()
  })
</script>

<form class="secret-form" onsubmit={handleSubmit}>
  {#if error}
    <div class="error">{error}</div>
  {/if}
  <div class="row">
    <div class="field">
      <label for="secret-app">App</label>
      <input id="secret-app" bind:value={app} placeholder="*" list="app-options" />
      <datalist id="app-options">
        {#each app_options as opt}
          <option value={opt}>{opt}</option>
        {/each}
      </datalist>
    </div>
    <div class="field">
      <label for="secret-env">Env</label>
      <input id="secret-env" bind:value={env} placeholder="*" list="env-options" />
      <datalist id="env-options">
        {#each env_options as opt}
          <option value={opt}>{opt}</option>
        {/each}
      </datalist>
    </div>
    <div class="field">
      <label for="key">Key</label>
      <input id="key" bind:value={key} placeholder="SECRET_NAME" required />
    </div>
    <div class="field wide">
      <label for="value">Value</label>
      <input id="value" bind:value={value} placeholder="secret value" required />
    </div>
    <div class="field narrow">
      <label for="type">Type</label>
      <select id="type" bind:value={type}>
        <option value="str">str</option>
        <option value="int">int</option>
      </select>
    </div>
    <div class="field narrow">
      <button class="primary" type="submit">Add</button>
    </div>
  </div>
</form>

<style>
  .secret-form {
    background: var(--bg-card);
    padding: 16px;
    border-radius: 8px;
    margin-bottom: 16px;
  }

  .row {
    display: flex;
    gap: 12px;
    align-items: flex-end;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    flex: 1;
    min-width: 0;
  }

  .field.wide {
    flex: 3;
  }

  .field.narrow {
    flex: 0 0 auto;
  }

  label {
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
  }

  .error {
    padding: 8px 12px;
    background: rgba(233, 69, 96, 0.15);
    border: 1px solid var(--accent);
    border-radius: 6px;
    color: var(--accent);
    margin-bottom: 12px;
    font-size: 14px;
  }
</style>
