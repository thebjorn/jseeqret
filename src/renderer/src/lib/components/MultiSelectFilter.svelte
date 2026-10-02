<script>
    // Column-header dropdown with a checkbox per value. An empty
    // selection means "no restriction". The list is a native popover
    // (top layer + light dismiss), so scrolling table containers can't
    // clip it; CSS anchor positioning pins it under the trigger.

    let { options = [], selected = $bindable([]), label = 'filter' } = $props()

    const uid = $props.id()
    const anchor = `--msf-${uid}`

    const summary = $derived(
        selected.length === 0 ? 'All'
            : selected.length === 1 ? String(selected[0])
            : `${selected.length} selected`
    )

    function toggle(value) {
        selected = selected.includes(value)
            ? selected.filter(v => v !== value)
            : [...selected, value]
    }
</script>

<button
    type="button"
    class="trigger"
    class:active={selected.length > 0}
    popovertarget="msf-{uid}"
    style="anchor-name: {anchor}"
    aria-label="Filter {label}"
    title={selected.join(', ')}
>
    <span class="summary">{summary}</span>
    <span class="caret">▾</span>
</button>

<div
    id="msf-{uid}"
    popover="auto"
    class="menu"
    style="position-anchor: {anchor}"
>
    {#if options.length === 0}
        <div class="none">No values</div>
    {:else}
        <button
            type="button"
            class="clear"
            disabled={selected.length === 0}
            onclick={() => selected = []}
        >Show all</button>
        {#each options as value (value)}
            <label class="option">
                <input
                    type="checkbox"
                    checked={selected.includes(value)}
                    onchange={() => toggle(value)}
                >
                <span>{value}</span>
            </label>
        {/each}
    {/if}
</div>

<style>
    .trigger {
        width: 100%;
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 4px 8px;
        font-size: 12px;
        font-weight: 400;
        text-align: left;
        background: var(--bg);
        border: 1px solid var(--border);
        border-radius: 4px;
        color: var(--text-muted);
    }

    .trigger.active {
        color: var(--text);
        border-color: var(--accent);
    }

    .trigger:active {
        transform: none;
    }

    .summary {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .caret {
        font-size: 10px;
    }

    .menu {
        position: fixed;
        inset: auto;
        top: anchor(bottom);
        left: anchor(left);
        position-try-fallbacks: flip-block;
        min-width: anchor-size(width);
        max-height: 280px;
        overflow-y: auto;
        margin: 2px 0;
        padding: 4px;
        background: var(--bg-card);
        border: 1px solid var(--border);
        border-radius: 6px;
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
        color: var(--text);
    }

    .option {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 5px 8px;
        border-radius: 4px;
        font-size: 13px;
        cursor: pointer;
        white-space: nowrap;
    }

    .option:hover {
        background: rgba(233, 69, 96, 0.08);
    }

    .option input[type='checkbox'] {
        width: auto;
        accent-color: var(--accent);
    }

    .clear {
        width: 100%;
        padding: 4px 8px;
        margin-bottom: 2px;
        font-size: 12px;
        text-align: left;
        background: transparent;
        color: var(--text-muted);
        border-radius: 4px;
    }

    .clear:hover:not(:disabled) {
        background: var(--bg-input);
        color: var(--text);
    }

    .clear:disabled {
        opacity: 0.4;
        cursor: default;
    }

    .none {
        padding: 6px 8px;
        font-size: 12px;
        color: var(--text-muted);
    }
</style>
