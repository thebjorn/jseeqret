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
  const table = new Table({ head: cols })
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
