/**
 * Vault registry — maps vault names to absolute paths.
 *
 * Stored at ~/.seeqret/vaults.json with structure:
 *   { "_default": "work", "work": "/srv/.seeqret", "personal": "/home/me/.seeqret" }
 */

import fs from 'fs'
import path from 'path'
import os from 'os'

function get_registry_dir() {
    return path.join(os.homedir(), '.seeqret')
}

function get_registry_file() {
    return path.join(get_registry_dir(), 'vaults.json')
}

/**
 * Read the registry file, returning {} if it doesn't exist.
 * @returns {object}
 */
export function read_registry() {
    if (!fs.existsSync(get_registry_file())) return {}
    const data = fs.readFileSync(get_registry_file(), 'utf-8')
    return JSON.parse(data)
}

/**
 * Write the registry object to disk, creating ~/.seeqret if needed.
 * @param {object} registry
 */
export function write_registry(registry) {
    if (!fs.existsSync(get_registry_dir())) {
        fs.mkdirSync(get_registry_dir(), { mode: 0o700, recursive: true })
    }
    fs.writeFileSync(get_registry_file(), JSON.stringify(registry, null, 4), 'utf-8')
}

/**
 * Add a named vault to the registry.
 * @param {string} name
 * @param {string} vault_path - absolute path to the vault directory
 */
export function registry_add(name, vault_path) {
    if (name === '_default') {
        throw new Error('Cannot use "_default" as a vault name')
    }
    const abs_path = path.resolve(vault_path)
    const registry = read_registry()
    registry[name] = abs_path
    write_registry(registry)
}

/**
 * Remove a named vault from the registry.
 * @param {string} name
 * @returns {boolean} true if the vault existed
 */
export function registry_remove(name) {
    if (name === '_default') {
        throw new Error('Cannot remove "_default" directly')
    }
    const registry = read_registry()
    if (!(name in registry)) return false
    delete registry[name]
    if (registry._default === name) {
        delete registry._default
    }
    write_registry(registry)
    return true
}

/**
 * Set the default vault name.
 * @param {string} name
 */
export function registry_use(name) {
    const registry = read_registry()
    if (!(name in registry)) {
        throw new Error(`Vault "${name}" is not registered`)
    }
    registry._default = name
    write_registry(registry)
}

/**
 * List all registered vaults.
 * @returns {Array.<{name: string, path: string, is_default: boolean}>}
 */
export function registry_list() {
    const registry = read_registry()
    const default_name = registry._default || null
    return Object.entries(registry)
        .filter(([key]) => key !== '_default')
        .map(([name, vault_path]) => ({
            name,
            path: vault_path,
            is_default: name === default_name,
        }))
}

/**
 * Resolve a vault name to an absolute path via the registry.
 * @param {string} name
 * @returns {string|null} absolute path, or null if not found
 */
export function registry_resolve(name) {
    const registry = read_registry()
    return registry[name] || null
}

/**
 * Get the default vault name from the registry.
 * @returns {string|null}
 */
export function registry_default() {
    const registry = read_registry()
    return registry._default || null
}

export { get_registry_dir, get_registry_file }
