<script>
  let { onsubmit } = $props()
  let app = $state('*')
  let env = $state('*')
  let key = $state('')
  let value = $state('')
  let type = $state('str')
  let error = $state(null)

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
</script>

<form class="secret-form" onsubmit={handleSubmit}>
  {#if error}
    <div class="error">{error}</div>
  {/if}
  <div class="fields">
    <div class="field">
      <label for="app">App</label>
      <input id="app" bind:value={app} placeholder="*" />
    </div>
    <div class="field">
      <label for="env">Env</label>
      <input id="env" bind:value={env} placeholder="*" />
    </div>
    <div class="field">
      <label for="key">Key</label>
      <input id="key" bind:value={key} placeholder="SECRET_NAME" required />
    </div>
    <div class="field wide">
      <label for="value">Value</label>
      <input id="value" bind:value={value} placeholder="secret value" required />
    </div>
    <div class="field">
      <label for="type">Type</label>
      <select id="type" bind:value={type}>
        <option value="str">str</option>
        <option value="int">int</option>
      </select>
    </div>
    <div class="field">
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

  .fields {
    display: flex;
    gap: 12px;
    align-items: flex-end;
    flex-wrap: wrap;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .field.wide {
    flex: 1;
    min-width: 200px;
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
