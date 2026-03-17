<script>
    let { view = 'dashboard', onnavigate, status = null } = $props()
    
    const nav_items = [
        { id: 'dashboard', label: 'Dashboard', icon: 'grid' },
        { id: 'secrets', label: 'Secrets', icon: 'key' },
        { id: 'users', label: 'Users', icon: 'users' },
        { id: 'export', label: 'Export', icon: 'upload' },
        { id: 'import', label: 'Import', icon: 'download' },
        { id: 'introduction', label: 'Introduction', icon: 'share' },
    ]
</script>

<aside class="sidebar">
    <div class="brand">
        <svg class="brand-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
        <span class="brand-text">jseeqret</span>
    </div>

    <nav>
        {#each nav_items as item}
            <button
                class="nav-item"
                class:active={view === item.id}
                onclick={() => onnavigate(item.id)}
            >
                <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    {#if item.icon === 'grid'}
                        <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
                    {:else if item.icon === 'key'}
                        <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
                    {:else if item.icon === 'users'}
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
                    {:else if item.icon === 'upload'}
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
                    {:else if item.icon === 'download'}
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
                    {:else if item.icon === 'share'}
                        <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                    {/if}
                </svg>
                <span>{item.label}</span>
            </button>
        {/each}
    </nav>

    <div class="sidebar-footer">
        {#if status}
            <div class="vault-status">
                <span class="status-dot" class:initialized={status.initialized}></span>
                <span class="status-label">
                    {status.initialized ? 'Vault active' : 'Not initialized'}
                </span>
            </div>
            {#if status.currentUser}
                <div class="current-user">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
                    </svg>
                    <span>{status.currentUser}</span>
                </div>
            {/if}
        {/if}
    </div>
</aside>

<style>
    .sidebar {
        width: var(--sidebar-width);
        min-width: var(--sidebar-width);
        height: 100vh;
        background: var(--bg-sidebar);
        border-right: 1px solid var(--border);
        display: flex;
        flex-direction: column;
        overflow-y: auto;
    }

    .brand {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 20px 16px;
        border-bottom: 1px solid var(--border);
    }

    .brand-icon {
        width: 24px;
        height: 24px;
        color: var(--accent);
        flex-shrink: 0;
    }

    .brand-text {
        font-family: var(--font-mono);
        font-size: 18px;
        font-weight: 700;
        color: var(--accent);
        letter-spacing: -0.02em;
    }

    nav {
        flex: 1;
        padding: 8px 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
    }

    .nav-item {
        display: flex;
        align-items: center;
        gap: 10px;
        width: 100%;
        padding: 10px 16px;
        background: transparent;
        color: var(--text-muted);
        border: none;
        border-radius: 0;
        border-left: 3px solid transparent;
        font-size: 14px;
        font-weight: 400;
        text-align: left;
        transition: all var(--transition);
        cursor: pointer;
    }

    .nav-item:hover {
        color: var(--text);
        background: rgba(233, 69, 96, 0.08);
    }

    .nav-item.active {
        color: var(--text);
        background: rgba(233, 69, 96, 0.12);
        border-left-color: var(--accent);
        font-weight: 500;
    }

    .nav-item:active {
        transform: none;
    }

    .nav-icon {
        width: 18px;
        height: 18px;
        flex-shrink: 0;
    }

    .sidebar-footer {
        padding: 12px 16px;
        border-top: 1px solid var(--border);
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .vault-status {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 12px;
        color: var(--text-muted);
    }

    .status-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--text-muted);
        flex-shrink: 0;
    }

    .status-dot.initialized {
        background: var(--success);
        box-shadow: 0 0 6px rgba(78, 204, 163, 0.5);
    }

    .current-user {
        display: flex;
        align-items: center;
        gap: 6px;
        font-family: var(--font-mono);
        font-size: 13px;
        color: var(--success);
    }
</style>
