<script>
  let { filter = '*' } = $props()
  let secrets = $state([])
  let error = $state(null)
  let revealedKeys = $state(new Set())

  async function loadSecrets() {
    try {
      error = null
      secrets = await window.api.getSecrets(filter)
    } catch (e) {
      error = e.message
      secrets = []
    }
  }

  function toggleReveal(idx) {
    const next = new Set(revealedKeys)
    if (next.has(idx)) {
      next.delete(idx)
    } else {
      next.add(idx)
    }
    revealedKeys = next
  }

  async function removeSecret(secret) {
    if (!confirm(`Remove ${secret.app}:${secret.env}:${secret.key}?`)) return
    try {
      await window.api.removeSecret(`${secret.app}:${secret.env}:${secret.key}`)
      await loadSecrets()
    } catch (e) {
      error = e.message
    }
  }

  function maskValue(val) {
    if (typeof val === 'string' && val.length > 3) {
      return val.slice(0, 2) + '*'.repeat(Math.min(val.length - 2, 20))
    }
    return '***'
  }

  $effect(() => {
    loadSecrets()
  })
</script>

{#if error}
  <div class="error">{error}</div>
{/if}

{#if secrets.length === 0 && !error}
  <div class="empty">No secrets found.</div>
{:else}
  <table>
    <thead>
      <tr>
        <th>App</th>
        <th>Env</th>
        <th>Key</th>
        <th>Value</th>
        <th>Type</th>
        <th></th>
      </tr>
    </thead>
    <tbody>
      {#each secrets as secret, i}
        <tr>
          <td>{secret.app}</td>
          <td>{secret.env}</td>
          <td class="key">{secret.key}</td>
          <td class="value" onclick={() => toggleReveal(i)} title="Click to toggle">
            <code>
              {revealedKeys.has(i) ? secret.value : maskValue(String(secret.value))}
            </code>
          </td>
          <td class="type">{secret.type}</td>
          <td>
            <button class="delete" onclick={() => removeSecret(secret)} title="Remove">
              x
            </button>
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
{/if}

<style>
  .key {
    font-family: var(--font-mono);
    font-weight: 600;
  }

  .value {
    cursor: pointer;
    max-width: 300px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .value code {
    font-family: var(--font-mono);
    font-size: 13px;
    color: var(--success);
  }

  .type {
    color: var(--text-muted);
    font-size: 13px;
  }

  .delete {
    background: transparent;
    color: var(--accent);
    padding: 4px 8px;
    font-size: 14px;
    border-radius: 4px;
  }

  .delete:hover {
    background: var(--accent);
    color: white;
  }

  .error {
    padding: 12px;
    background: rgba(233, 69, 96, 0.15);
    border: 1px solid var(--accent);
    border-radius: 6px;
    color: var(--accent);
    margin-bottom: 12px;
  }

  .empty {
    text-align: center;
    padding: 40px;
    color: var(--text-muted);
  }
</style>
