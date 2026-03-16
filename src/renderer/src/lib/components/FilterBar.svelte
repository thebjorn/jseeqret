<script>
  let { filter = $bindable('*'), onchange } = $props()

  function handleKeydown(e) {
    if (e.key === 'Enter' && onchange) {
      onchange()
    }
  }
</script>

<div class="filter-bar">
  <input
    type="text"
    bind:value={filter}
    onkeydown={handleKeydown}
    placeholder="Filter: app:env:key (e.g. myapp:prod:*)"
  />
  <button class="secondary" onclick={onchange}>Apply</button>
</div>

<style>
  .filter-bar {
    display: flex;
    gap: 8px;
    flex: 1;
  }

  input {
    flex: 1;
  }
</style>
