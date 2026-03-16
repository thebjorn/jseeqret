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

    // Apply sorting
    if (sortColumn) {
      result = [...result].sort((a, b) => {
        const va = String(a[sortColumn] ?? '').toLowerCase()
        const vb = String(b[sortColumn] ?? '').toLowerCase()
        const cmp = va < vb ? -1 : va > vb ? 1 : 0
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
        <th></th>
      </tr>
      <tr class="filter-row">
        <th><input type="text" bind:value={columnFilters.app} placeholder="filter..." class="col-filter" /></th>
        <th><input type="text" bind:value={columnFilters.env} placeholder="filter..." class="col-filter" /></th>
        <th><input type="text" bind:value={columnFilters.key} placeholder="filter..." class="col-filter" /></th>
        <th></th>
        <th><input type="text" bind:value={columnFilters.type} placeholder="filter..." class="col-filter" /></th>
        <th></th>
      </tr>
    </thead>
    <tbody>
      {#each filteredSecrets as secret, i}
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
      {#if filteredSecrets.length === 0 && secrets.length > 0}
        <tr>
          <td colspan="6" class="empty-filtered">No secrets match the column filters.</td>
        </tr>
      {/if}
    </tbody>
  </table>
  <div class="table-footer">
    {filteredSecrets.length} of {secrets.length} secret(s)
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
    color: var(--accent);
    margin-bottom: 12px;
  }

  .empty {
    text-align: center;
    padding: 40px;
    color: var(--text-muted);
  }
</style>
