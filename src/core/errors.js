/**
 * Errors thrown by the public `get()` / `get_sync()` API. They mirror
 * Python seeqret's `SecretNotFound` and `AmbiguousSecret`.
 */

/**
 * No secret matches the requested app/env/key.
 */
export class SecretNotFound extends Error {
    /**
     * @param {string} key
     * @param {string} [app='*']
     * @param {string} [env='*']
     * @param {string|null} [location=null] - path of the vault database
     */
    constructor(key, app = '*', env = '*', location = null) {
        const where = location ? ` in vault ${location}` : ''
        super(
            `No secret ${app}:${env}:${key}${where}.\n`
            + `See where '${key}' exists with: jseeqret list -f "*:*:${key}"`
        )
        this.name = 'SecretNotFound'
        this.key = key
        this.app = app
        this.env = env
        this.location = location
    }
}

/**
 * More than one secret matches the requested app/env/key.
 */
export class AmbiguousSecret extends Error {
    /**
     * @param {string} key
     * @param {string} app
     * @param {string} env
     * @param {{app: string, env: string, key: string}[]} matches - only
     *     the names are kept, never values, since this error may be logged
     */
    constructor(key, app, env, matches) {
        const names = matches.map(m => `${m.app}:${m.env}:${m.key}`).sort()
        super(
            `${names.length} secrets match ${app}:${env}:${key}:\n`
            + names.map(n => `    ${n}`).join('\n') + '\n'
            + `Name the app and env, e.g. get('${names[0]}').`
        )
        this.name = 'AmbiguousSecret'
        this.key = key
        this.app = app
        this.env = env
        this.matches = names
    }
}
