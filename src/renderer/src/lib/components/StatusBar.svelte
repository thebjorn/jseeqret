<script>
  let { status } = $props()
</script>

<div class="status-bar">
  <span class="vault-path" title={status.vaultDir}>
    {status.vaultDir}
  </span>
  <span class="user">{status.currentUser}</span>
</div>

<style>
  .status-bar {
    display: flex;
    justify-content: space-between;
    padding: 8px 12px;
    background: var(--bg-card);
    border-radius: 6px;
    margin-bottom: 16px;
    font-size: 13px;
    color: var(--text-muted);
    font-family: var(--font-mono);
  }

  .vault-path {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .user {
    color: var(--success);
    flex-shrink: 0;
  }
</style>
