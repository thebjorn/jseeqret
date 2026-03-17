<script>
    let { status = null, onnavigate } = $props()
    let stats = $state({ secrets: 0, users: 0, owner: null })
    let loading = $state(true)

    async function load_stats() {
        try {
            const [secrets, users] = await Promise.all([
                window.api.getSecrets('*'),
                window.api.getUsers(),
            ])
            stats = {
                secrets: secrets.length,
                users: users.length,
                owner: status?.currentUser || 'unknown',
            }
        } catch {
            // vault might not be initialized
        } finally {
            loading = false
        }
    }

    $effect(() => {
        load_stats()
    })
</script>

<div class="dashboard">
    <div class="page-header">
        <h1>Dashboard</h1>
        <p class="subtitle">Vault overview and quick actions</p>
    </div>

    <div class="stats-grid">
        <div class="stat-card">
            <div class="stat-icon secrets">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
                </svg>
            </div>
            <div class="stat-content">
                <span class="stat-value">{loading ? '...' : stats.secrets}</span>
                <span class="stat-label">Secrets</span>
            </div>
        </div>

        <div class="stat-card">
            <div class="stat-icon users">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
            </div>
            <div class="stat-content">
                <span class="stat-value">{loading ? '...' : stats.users}</span>
                <span class="stat-label">Users</span>
            </div>
        </div>

        <div class="stat-card">
            <div class="stat-icon owner">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
            </div>
            <div class="stat-content">
                <span class="stat-value mono">{loading ? '...' : (stats.owner || '—')}</span>
                <span class="stat-label">Vault Owner</span>
            </div>
        </div>
    </div>

    {#if status}
        <div class="vault-info">
            <h2>Vault Information</h2>
            <div class="info-grid">
                <div class="info-item">
                    <span class="info-label">Status</span>
                    <span class="info-value">
                        <span class="status-badge" class:active={status.initialized}>
                            {status.initialized ? 'Initialized' : 'Not initialized'}
                        </span>
                    </span>
                </div>
                <div class="info-item">
                    <span class="info-label">Vault Path</span>
                    <span class="info-value mono">{status.vaultDir || '—'}</span>
                </div>
                <div class="info-item">
                    <span class="info-label">Current User</span>
                    <span class="info-value mono">{status.currentUser || '—'}</span>
                </div>
            </div>
        </div>
    {/if}

    <div class="quick-actions">
        <h2>Quick Actions</h2>
        <div class="action-grid">
            <button class="action-card" onclick={() => onnavigate('secrets')}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                <span>Add Secret</span>
            </button>
            <button class="action-card" onclick={() => onnavigate('export')}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                <span>Export Secrets</span>
            </button>
            <button class="action-card" onclick={() => onnavigate('import')}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                <span>Import Secrets</span>
            </button>
            <button class="action-card" onclick={() => onnavigate('introduction')}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                </svg>
                <span>My Introduction</span>
            </button>
        </div>
    </div>
</div>

<style>
    .dashboard {
        display: flex;
        flex-direction: column;
        gap: 24px;
    }

    .page-header h1 {
        font-size: 24px;
        font-weight: 600;
        margin-bottom: 4px;
    }

    .subtitle {
        color: var(--text-muted);
        font-size: 14px;
    }

    .stats-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 16px;
    }

    .stat-card {
        background: var(--bg-card);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        padding: 20px;
        display: flex;
        align-items: center;
        gap: 16px;
        transition: border-color var(--transition);
    }

    .stat-card:hover {
        border-color: var(--accent);
    }

    .stat-icon {
        width: 48px;
        height: 48px;
        border-radius: 12px;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
    }

    .stat-icon svg {
        width: 24px;
        height: 24px;
    }

    .stat-icon.secrets {
        background: rgba(233, 69, 96, 0.15);
        color: var(--accent);
    }

    .stat-icon.users {
        background: rgba(78, 204, 163, 0.15);
        color: var(--success);
    }

    .stat-icon.owner {
        background: rgba(15, 52, 96, 0.8);
        color: var(--text);
    }

    .stat-content {
        display: flex;
        flex-direction: column;
    }

    .stat-value {
        font-size: 28px;
        font-weight: 700;
        line-height: 1.2;
    }

    .stat-value.mono {
        font-family: var(--font-mono);
        font-size: 16px;
    }

    .stat-label {
        font-size: 13px;
        color: var(--text-muted);
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }

    .vault-info {
        background: var(--bg-card);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        padding: 20px;
    }

    .vault-info h2 {
        font-size: 16px;
        margin-bottom: 16px;
        font-weight: 600;
    }

    .info-grid {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    .info-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 8px 0;
        border-bottom: 1px solid var(--border);
    }

    .info-item:last-child {
        border-bottom: none;
    }

    .info-label {
        font-size: 13px;
        color: var(--text-muted);
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }

    .info-value {
        font-size: 14px;
    }

    .info-value.mono {
        font-family: var(--font-mono);
        color: var(--success);
    }

    .status-badge {
        display: inline-block;
        padding: 3px 10px;
        border-radius: 12px;
        font-size: 12px;
        font-weight: 600;
        background: rgba(233, 69, 96, 0.15);
        color: var(--accent);
    }

    .status-badge.active {
        background: var(--success-dim);
        color: var(--success);
    }

    .quick-actions h2 {
        font-size: 16px;
        margin-bottom: 12px;
        font-weight: 600;
    }

    .action-grid {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 12px;
    }

    .action-card {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 10px;
        padding: 20px 16px;
        background: var(--bg-card);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        color: var(--text-muted);
        font-size: 13px;
        font-weight: 500;
        transition: all var(--transition);
        cursor: pointer;
    }

    .action-card svg {
        width: 24px;
        height: 24px;
    }

    .action-card:hover {
        border-color: var(--accent);
        color: var(--text);
        background: rgba(233, 69, 96, 0.08);
    }

    .action-card:active {
        transform: scale(0.98);
    }
</style>
