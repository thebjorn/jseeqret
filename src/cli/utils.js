/**
 * CLI utility functions.
 */

import Table from 'cli-table3'
import { is_initialized, current_user, get_seeqret_dir } from '../core/vault.js'
import { SqliteStorage } from '../core/sqlite-storage.js'

/**
 * Print data as a formatted table.
 * @param {string} headers - comma-separated column headers
 * @param {Array} items - array of objects with .row property, or arrays
 */
export function as_table(headers, items) {
    const cols = headers.split(',').map(s => s.trim())
    const rows = items.map(item => item.row || item)

    // Calculate max content width per column (including header)
    const max_widths = cols.map((header, i) => {
        const cell_widths = rows.map(row => String(row[i] ?? '').length)
        return Math.max(header.length, ...cell_widths)
    })

    const term_width = process.stdout.columns || 80
    // cli-table3 overhead: 1 left border + 1 right border per col + 1 padding each side per col
    const overhead = cols.length * 3 + 1
    const available = Math.max(term_width - overhead, cols.length * 4)

    // Shrink widest columns first until total fits
    const widths = [...max_widths]
    const MIN_COL = 4
    while (widths.reduce((a, b) => a + b, 0) > available) {
        const max = Math.max(...widths)
        if (max <= MIN_COL) break

        // Find the second-widest value (or MIN_COL if all are the same)
        const target = Math.max(MIN_COL, ...widths.filter(w => w < max))
        // Shrink all widest columns toward the target, but only enough to fit
        const excess = widths.reduce((a, b) => a + b, 0) - available
        const widest_count = widths.filter(w => w === max).length
        const shrink_each = Math.min(max - target, Math.ceil(excess / widest_count))

        for (let i = 0; i < widths.length; i++) {
            if (widths[i] === max) widths[i] -= shrink_each
        }
    }

    const col_widths = widths.map(w => w + 2)  // +2 for cli-table3 padding

    // Render with bold mid-lines, then strip all but the header separator
    const table = new Table({
        head: cols,
        colWidths: col_widths,
        wordWrap: true,
        chars: {
            'mid': '═', 'mid-mid': '╪', 'left-mid': '╞', 'right-mid': '╡',
        },
    })

    for (const row of rows) {
        table.push(row)
    }

    const output = table.toString()

    // Remove mid-lines except the first one (under header)
    let found = false
    const lines = output.split('\n').filter(line => {
        if (line.includes('╞') && line.includes('╡')) {
            if (!found) { found = true; return true }
            return false
        }
        return true
    })

    console.log(lines.join('\n'))
}

/**
 * Validate that the vault is initialized and the current user is valid.
 * Exits the process if not.
 */
export function require_vault() {
    if (!is_initialized()) {
        console.error('Error: Vault is not initialized. Run `jseeqret init` first.')
        process.exit(1)
    }
}

/**
 * Validate the current user is a registered vault user.
 */
export async function validate_current_user() {
    const user = current_user()
    const storage = new SqliteStorage()
    const users = await storage.fetch_users({ username: user })

    if (users.length === 0) {
        console.error('Error: You are not a valid user of this vault.')
        process.exit(1)
    }
}
