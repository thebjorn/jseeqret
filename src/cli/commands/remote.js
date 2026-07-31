import { Command } from 'commander'
import { SqliteStorage } from '../../core/sqlite-storage.js'
import { Remote } from '../../core/models/remote.js'
import { require_vault } from '../utils.js'

/**
 * Split a USER@HOST argument, exiting with a friendly error when it
 * does not look like one.
 */
function parse_userhost(userhost) {
    const at = userhost.indexOf('@')
    const username = at > 0 ? userhost.slice(0, at) : ''
    const hostname = at > 0 ? userhost.slice(at + 1) : ''
    if (!username || !hostname) {
        console.error(
            'Error: Expected USER@HOST (e.g. myuser@myhost.example.com),'
            + ` got: ${userhost}`
        )
        process.exit(1)
    }
    return { username, hostname }
}

const remote_add = new Command('add')
    .description('Add (or update) an ssh remote named ALIAS at USERHOST')
    .argument('<alias>', 'Short name for the remote')
    .argument('<userhost>', 'ssh identity (user@host)')
    .requiredOption(
        '--set <template>',
        'Remote command template to set a secret. {key} and {value} are'
        + ' substituted shell-quoted, so do not add your own quotes'
        + ' around them. Without a {value} placeholder the value is'
        + ' piped on stdin instead (preferred: it keeps the secret out'
        + ' of the remote command line).'
    )
    .option(
        '--get <template>',
        'Remote command template to fetch a secret value (prints the'
        + ' value on stdout). {key} is substituted shell-quoted. Omit'
        + ' for a push-only remote.'
    )
    .addHelpText('after', `
Example:
    jseeqret remote add myhost myuser@myhost.example.com \\
        --set ". /srv/venv/myvenv/bin/activate && myvault set-secret --key {key} --stdin" \\
        --get "... myvault get-secret --key {key} --stdout"

Afterwards \`jseeqret push myhost myapp:prod:FOO\` runs the set
command on the host over ssh for each matching secret (piping the
value on stdin, since the template has no {value} placeholder),
and \`jseeqret verify myhost myapp:prod:FOO\` compares the get
command's output to the vault value.`)
    .action(async (alias, userhost, opts) => {
        require_vault()
        const { username, hostname } = parse_userhost(userhost)

        if (!opts.set.includes('{key}')) {
            console.error('Error: --set template must contain {key}')
            process.exit(1)
        }
        if (opts.get != null && !opts.get.includes('{key}')) {
            console.error('Error: --get template must contain {key}')
            process.exit(1)
        }

        const remote = new Remote({
            alias,
            username,
            hostname,
            set_cmd: opts.set,
            get_cmd: opts.get ?? null,
        })

        const storage = new SqliteStorage()
        try {
            await storage.upsert_remote(remote)
        } catch (e) {
            console.error(`Error: ${e.message}`)
            process.exit(1)
        }

        console.log(`Added remote ${alias} (${remote.userhost})`)
        if (remote.value_via_stdin) {
            console.log(
                'Values will be piped on stdin'
                + ' (no {value} placeholder in --set).'
            )
        } else {
            console.log(
                'Values will be passed on the remote command line'
                + ' ({value} placeholder in --set).'
            )
        }
    })

const remote_list = new Command('list')
    .description('List the registered ssh remotes')
    .action(async () => {
        require_vault()
        const storage = new SqliteStorage()
        const remotes = await storage.fetch_remotes()

        if (remotes.length === 0) {
            console.log(
                'No remotes registered'
                + ' (use `jseeqret remote add` to add one).'
            )
            return
        }

        for (const remote of remotes) {
            console.log(`${remote.alias}  ${remote.userhost}`)
            console.log(`    set: ${remote.set_cmd}`)
            if (remote.get_cmd) {
                console.log(`    get: ${remote.get_cmd}`)
            } else {
                console.log('    get: (none -- push only)')
            }
        }
    })

const remote_rm = new Command('rm')
    .description('Remove the ssh remote named ALIAS')
    .argument('<alias>', 'Remote to remove')
    .action(async (alias) => {
        require_vault()
        const storage = new SqliteStorage()
        const deleted = await storage.remove_remote(alias)

        if (!deleted) {
            console.error(`Error: No remote named ${alias}`)
            process.exit(1)
        }
        console.log(`Removed remote ${alias}`)
    })

/**
 * Manage ssh remote targets: named hosts that secrets can be pushed
 * to (`jseeqret push <alias>`) and verified against
 * (`jseeqret verify <alias>`).
 *
 * @example
 * jseeqret remote add myhost myuser@myhost.example.com \
 *     --set "myvault set-secret --key {key} --stdin" \
 *     --get "myvault get-secret --key {key} --stdout"
 */
export const remote_commands = new Command('remote')
    .description('Manage ssh remote targets for push/verify')

remote_commands.addCommand(remote_add)
remote_commands.addCommand(remote_list)
remote_commands.addCommand(remote_rm)
