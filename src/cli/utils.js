/**
 * CLI utility functions.
 */

import Table from 'cli-table3'
import { isInitialized, currentUser, getSeeqretDir } from '../core/vault.js'
import { SqliteStorage } from '../core/sqlite-storage.js'

/**
 * Print data as a formatted table.
 * @param {string} headers - comma-separated column headers
 * @param {Array} items - array of objects with .row property, or arrays
 */
export function asTable(headers, items) {
  const cols = headers.split(',').map(s => s.trim())
  const termWidth = process.stdout.columns || 80
  // Borders/padding: 1 left border + (3 per col: space+content+space) + 1 separator between cols + 1 right border
  // Simplified: each col has 3 chars overhead, plus 1 for the left border
  const overhead = cols.length * 3 + 1
  const available = Math.max(termWidth - overhead, cols.length * 4)
  const colWidth = Math.floor(available / cols.length)
  const colWidths = cols.map(() => colWidth)

  const table = new Table({
    head: cols,
    colWidths,
    wordWrap: true,
  })
  for (const item of items) {
    const row = item.row || item
    table.push(row)
  }
  console.log(table.toString())
}

/**
 * Validate that the vault is initialized and the current user is valid.
 * Exits the process if not.
 */
export function requireVault() {
  if (!isInitialized()) {
    console.error('Error: Vault is not initialized. Run `jseeqret init` first.')
    process.exit(1)
  }
}

/**
 * Validate the current user is a registered vault user.
 */
export function validateCurrentUser() {
  const user = currentUser()
  const storage = new SqliteStorage()
  const users = storage.fetchUsers({ username: user })
  if (users.length === 0) {
    console.error('Error: You are not a valid user of this vault.')
    process.exit(1)
  }
}
