<script>
  let users = $state([])
  let error = $state(null)

  async function loadUsers() {
    try {
      error = null
      users = await window.api.getUsers()
    } catch (e) {
      error = e.message
      users = []
    }
  }

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
        <tr>
          <th>Username</th>
          <th>Email</th>
          <th>Public Key</th>
        </tr>
      </thead>
      <tbody>
        {#each users as user}
          <tr>
            <td class="username">{user.username}</td>
            <td>{user.email}</td>
            <td class="pubkey" title={user.pubkey}>
              <code>{user.pubkey.slice(0, 20)}...</code>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
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
