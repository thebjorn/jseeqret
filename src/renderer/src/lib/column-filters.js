// Column filters shared by the secret tables (Secrets and Export views).
//
// A filter value is either a list of allowed values (multi-select
// dropdown; empty list = no restriction) or a search string
// (case-insensitive substring; empty string = no restriction).

/**
 * Sorted distinct values of `field` in `rows`, plus any `selected` values
 * no longer present -- so a stale selection can still be unchecked.
 */
export function distinct_values(rows, field, selected = []) {
    const values = new Set(rows.map(row => row[field]))
    for (const v of selected) values.add(v)
    return [...values].sort((a, b) => String(a).localeCompare(String(b)))
}

function matches(value, f) {
    if (Array.isArray(f)) return f.length === 0 || f.includes(value)
    if (!f) return true
    return String(value ?? '').toLowerCase().includes(f.toLowerCase())
}

/**
 * Rows matching every column filter in `filters` ({ field: filter }).
 */
export function apply_column_filters(rows, filters) {
    const active = Object.entries(filters)
    return rows.filter(row => active.every(([field, f]) => matches(row[field], f)))
}
