/**
 * Remote model - an ssh target that secrets can be pushed to and
 * verified against. Compatible with Python seeqret's Remote dataclass
 * (migration v007 `remotes` table).
 *
 * `set_cmd` and `get_cmd` are remote command templates with
 * `{key}`/`{value}` placeholders, e.g.:
 *
 *     . /srv/venv/myvenv/bin/activate && myvault set-secret --key {key} --stdin
 *     ... myvault get-secret --key {key} --stdout
 *
 * Placeholders are substituted with shell-quoted values, so the
 * templates must not add their own quotes. A `set_cmd` without a
 * `{value}` placeholder (like the one above) receives the value on
 * stdin instead -- preferable, since command-line arguments are
 * visible in `ps` on the remote host. `get_cmd` is optional; without
 * it the remote is push-only.
 */

export class Remote {
    /**
     * @param {object} opts
     * @param {string} opts.alias
     * @param {string} opts.username
     * @param {string} opts.hostname
     * @param {string} opts.set_cmd
     * @param {string|null} [opts.get_cmd]
     */
    constructor({ alias, username, hostname, set_cmd, get_cmd = null }) {
        this.alias = alias
        this.username = username
        this.hostname = hostname
        this.set_cmd = set_cmd
        this.get_cmd = get_cmd
    }

    get userhost() {
        return `${this.username}@${this.hostname}`
    }

    get value_via_stdin() {
        return !this.set_cmd.includes('{value}')
    }
}
