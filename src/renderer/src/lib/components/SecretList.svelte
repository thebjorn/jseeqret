<script>
  let { filter = '*' } = $props()
  let secrets = $state([])
  let error = $state(null)
  let revealedKeys = $state(new Set())

  // Sorting state
  let sortColumn = $state(null)
  let sortDirection = $state('asc')

  // Column filter state
  let columnFilters = $state({ app: '', env: '', key: '', value: '', type: '' })

  async function loadSecrets() {
    try {
      error = null
      secrets = await window.api.getSecrets(filter)
    } catch (e) {
      error = e.message
      secrets = []
    }
  }

  // Key reveals/copies by the secret's identity, not its row index --
  // filtering or sorting reorders rows, and an index-keyed reveal would
  // suddenly expose a different secret's value.
  function secret_id(secret) {
    return `${secret.app}:${secret.env}:${secret.key}`
  }

  function toggleReveal(secret) {
    const id = secret_id(secret)
    const next = new Set(revealedKeys)
    if (next.has(id)) {
      next.delete(id)
    } else {
      next.add(id)
    }
    revealedKeys = next
  }

  let copied_id = $state(null)

  async function copy_value(secret) {
      const id = secret_id(secret)
      await navigator.clipboard.writeText(String(secret.value))
      copied_id = id
      setTimeout(() => { if (copied_id === id) copied_id = null }, 1500)
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

  // Edit dialog: value only — app:env:key is the secret's identity
  // (rename = remove + add) and the type stays with the stored value.
  let edit_target = $state(null)
  let edit_value = $state('')
  let saving = $state(false)

  function open_edit(secret) {
    edit_target = secret
    edit_value = String(secret.value)
  }

  async function submit_edit(event) {
    event.preventDefault()
    saving = true
    error = null
    try {
      await window.api.updateSecret({
        app: edit_target.app,
        env: edit_target.env,
        key: edit_target.key,
        value: edit_value,
      })
      edit_target = null
      await loadSecrets()
    } catch (e) {
      error = e.message
    } finally {
      saving = false
    }
  }

  function maskValue(val) {
    if (typeof val === 'string' && val.length > 3) {
      return val.slice(0, 2) + '*'.repeat(Math.min(val.length - 2, 20))
    }
    return '***'
  }

  function fmt_updated(ts) {
    return ts ? new Date(ts * 1000).toLocaleDateString() : '—'
  }

  function handleSort(column) {
    if (sortColumn === column) {
      sortDirection = sortDirection === 'asc' ? 'desc' : 'asc'
    } else {
      sortColumn = column
      sortDirection = 'asc'
    }
  }

  function sortIndicator(column) {
    if (sortColumn !== column) return ''
    return sortDirection === 'asc' ? ' \u25B2' : ' \u25BC'
  }

  let filteredSecrets = $derived.by(() => {
    let result = secrets

    // Apply column filters
    if (columnFilters.app) {
      const f = columnFilters.app.toLowerCase()
      result = result.filter(s => s.app.toLowerCase().includes(f))
    }
    if (columnFilters.env) {
      const f = columnFilters.env.toLowerCase()
      result = result.filter(s => s.env.toLowerCase().includes(f))
    }
    if (columnFilters.key) {
      const f = columnFilters.key.toLowerCase()
      result = result.filter(s => s.key.toLowerCase().includes(f))
    }
    if (columnFilters.type) {
      const f = columnFilters.type.toLowerCase()
      result = result.filter(s => s.type.toLowerCase().includes(f))
    }

    // Apply sorting (updated_at is numeric; the rest sort as text)
    if (sortColumn) {
      result = [...result].sort((a, b) => {
        let cmp
        if (sortColumn === 'updated_at') {
          cmp = (a.updated_at ?? 0) - (b.updated_at ?? 0)
        } else {
          const va = String(a[sortColumn] ?? '').toLowerCase()
          const vb = String(b[sortColumn] ?? '').toLowerCase()
          cmp = va < vb ? -1 : va > vb ? 1 : 0
        }
        return sortDirection === 'asc' ? cmp : -cmp
      })
    }

    return result
  })

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
      <tr class="header-row">
        <th class="sortable" onclick={() => handleSort('app')}>App{sortIndicator('app')}</th>
        <th class="sortable" onclick={() => handleSort('env')}>Env{sortIndicator('env')}</th>
        <th class="sortable" onclick={() => handleSort('key')}>Key{sortIndicator('key')}</th>
        <th>Value</th>
        <th class="sortable" onclick={() => handleSort('type')}>Type{sortIndicator('type')}</th>
        <th class="sortable" onclick={() => handleSort('updated_at')}>Updated{sortIndicator('updated_at')}</th>
        <th></th>
      </tr>
      <tr class="filter-row">
        <th><input type="text" bind:value={columnFilters.app} placeholder="filter..." class="col-filter" /></th>
        <th><input type="text" bind:value={columnFilters.env} placeholder="filter..." class="col-filter" /></th>
        <th><input type="text" bind:value={columnFilters.key} placeholder="filter..." class="col-filter" /></th>
        <th></th>
        <th><input type="text" bind:value={columnFilters.type} placeholder="filter..." class="col-filter" /></th>
        <th></th>
        <th></th>
      </tr>
    </thead>
    <tbody>
      {#each filteredSecrets as secret (secret_id(secret))}
        <tr>
          <td>{secret.app}</td>
          <td>{secret.env}</td>
          <td class="key">{secret.key}</td>
          <td class="value" onclick={() => toggleReveal(secret)} title="Click to toggle">
            <code>
              {revealedKeys.has(secret_id(secret)) ? secret.value : maskValue(String(secret.value))}
            </code>
          </td>
          <td class="type">{secret.type}</td>
          <td class="type" title={secret.updated_at
              ? new Date(secret.updated_at * 1000).toLocaleString() : ''}>
            {fmt_updated(secret.updated_at)}
          </td>
          <td class="actions">
            <button class="copy" onclick={() => copy_value(secret)} title="Copy value">
              {copied_id === secret_id(secret) ? '✓' : '⎘'}
            </button>
            <button class="edit" onclick={() => open_edit(secret)} title="Edit value">
              ✎
            </button>
            <button class="delete" onclick={() => removeSecret(secret)} title="Remove">
              ×
            </button>
          </td>
        </tr>
      {/each}
      {#if filteredSecrets.length === 0 && secrets.length > 0}
        <tr>
          <td colspan="7" class="empty-filtered">No secrets match the column filters.</td>
        </tr>
      {/if}
    </tbody>
  </table>
  <div class="table-footer">
    {filteredSecrets.length} of {secrets.length} secret(s)
  </div>
{/if}

{#if edit_target}
  <div
    class="backdrop"
    role="presentation"
    onclick={(e) => { if (e.target === e.currentTarget) edit_target = null }}
  >
    <form class="dialog" onsubmit={submit_edit}>
      <h2>Edit secret</h2>
      <div class="identity mono">
        {edit_target.app}:{edit_target.env}:{edit_target.key}
        <span class="type-tag">{edit_target.type}</span>
      </div>
      <label class="field">
        <span>Value</span>
        <input
          type="text"
          bind:value={edit_value}
          class="mono"
          autocomplete="off"
          spellcheck="false"
          required
        >
      </label>
      <div class="dialog-actions">
        <button type="button" class="ghost"
          onclick={() => edit_target = null}>Cancel</button>
        <button type="submit" class="primary" disabled={saving}>
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </form>
  </div>
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

  .actions {
    white-space: nowrap;
  }

  .copy {
    background: transparent;
    color: var(--text-muted);
    padding: 4px 8px;
    font-size: 14px;
    border-radius: 4px;
  }

  .copy:hover {
    background: rgba(78, 204, 163, 0.15);
    color: var(--success);
  }

  .edit {
    background: transparent;
    color: var(--text-muted);
    padding: 4px 8px;
    font-size: 14px;
    border-radius: 4px;
  }

  .edit:hover {
    background: var(--bg-input);
    color: var(--text);
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
    width: 460px;
    max-width: 90vw;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .dialog h2 {
    font-size: 18px;
    font-weight: 600;
  }

  .identity {
    font-family: var(--font-mono);
    font-size: 14px;
    font-weight: 600;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 8px 12px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  .type-tag {
    font-size: 11px;
    font-weight: 500;
    color: var(--text-muted);
    background: var(--bg-input);
    border-radius: 4px;
    padding: 1px 6px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 13px;
    color: var(--text-muted);
  }

  .field input.mono {
    font-family: var(--font-mono);
  }

  .dialog-actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    margin-top: 4px;
  }

  .sortable {
    cursor: pointer;
    user-select: none;
  }

  .sortable:hover {
    color: var(--text);
  }

  .filter-row th {
    padding: 4px 6px;
    background: var(--bg-card);
    border-bottom: 1px solid var(--border);
  }

  .col-filter {
    width: 100%;
    padding: 4px 8px !important;
    font-size: 12px !important;
    background: var(--bg) !important;
    border: 1px solid var(--border) !important;
    border-radius: 4px !important;
    color: var(--text) !important;
  }

  .col-filter::placeholder {
    color: var(--text-muted);
    opacity: 0.5;
  }

  .empty-filtered {
    text-align: center;
    color: var(--text-muted);
    padding: 20px !important;
  }

  .table-footer {
    text-align: right;
    font-size: 12px;
    color: var(--text-muted);
    padding: 8px 12px;
  }

  .error {
    padding: 12px;
    background: rgba(233, 69, 96, 0.15);
    border: 1px solid var(--accent);
    border-radius: 6px;
    color: var(--danger-text);
    margin-bottom: 12px;
  }

  .empty {
    text-align: center;
    padding: 40px;
    color: var(--text-muted);
  }
</style>
