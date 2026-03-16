<script>
  let users = $state([])
  let error = $state(null)

  // Sorting state
  let sortColumn = $state(null)
  let sortDirection = $state('asc')

  // Column filter state
  let columnFilters = $state({ username: '', email: '', pubkey: '' })

  async function loadUsers() {
    try {
      error = null
      users = await window.api.getUsers()
    } catch (e) {
      error = e.message
      users = []
    }
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

  let filteredUsers = $derived.by(() => {
    let result = users

    if (columnFilters.username) {
      const f = columnFilters.username.toLowerCase()
      result = result.filter(u => u.username.toLowerCase().includes(f))
    }
    if (columnFilters.email) {
      const f = columnFilters.email.toLowerCase()
      result = result.filter(u => u.email.toLowerCase().includes(f))
    }
    if (columnFilters.pubkey) {
      const f = columnFilters.pubkey.toLowerCase()
      result = result.filter(u => u.pubkey.toLowerCase().includes(f))
    }

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
    loadUsers()
  })
</script>

<div class="user-list">
  <h2>Users</h2>

  {#if error}
    <div class="error">{error}</div>
  {/if}

  {#if users.length === 0 && !error}
    <div class="empty">No users found.</div>
  {:else}
    <table>
      <thead>
        <tr class="header-row">
          <th class="sortable" onclick={() => handleSort('username')}>Username{sortIndicator('username')}</th>
          <th class="sortable" onclick={() => handleSort('email')}>Email{sortIndicator('email')}</th>
          <th>Public Key</th>
        </tr>
        <tr class="filter-row">
          <th><input type="text" bind:value={columnFilters.username} placeholder="filter..." class="col-filter" /></th>
          <th><input type="text" bind:value={columnFilters.email} placeholder="filter..." class="col-filter" /></th>
          <th><input type="text" bind:value={columnFilters.pubkey} placeholder="filter..." class="col-filter" /></th>
        </tr>
      </thead>
      <tbody>
        {#each filteredUsers as user}
          <tr>
            <td class="username">{user.username}</td>
            <td>{user.email}</td>
            <td class="pubkey" title={user.pubkey}>
              <code>{user.pubkey.slice(0, 20)}...</code>
            </td>
          </tr>
        {/each}
        {#if filteredUsers.length === 0 && users.length > 0}
          <tr>
            <td colspan="3" class="empty-filtered">No users match the column filters.</td>
          </tr>
        {/if}
      </tbody>
    </table>
    <div class="table-footer">
      {filteredUsers.length} of {users.length} user(s)
    </div>
  {/if}
</div>

<style>
  h2 {
    margin-bottom: 16px;
    font-size: 18px;
  }

  .username {
    font-family: var(--font-mono);
    font-weight: 600;
  }

  .pubkey code {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-muted);
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
