#!/usr/bin/env node

/**
 * jseeqret CLI - compatible with Python seeqret's command structure.
 */

import { Command, Option } from 'commander'
import { set_log_level } from '../core/logger.js'
import { init_command } from './commands/init.js'
import { add_commands } from './commands/add.js'
import { list_command } from './commands/list.js'
import { get_command } from './commands/get.js'
import { rm_commands } from './commands/rm.js'
import { edit_commands } from './commands/edit.js'
import { users_command } from './commands/users.js'
import { owner_command } from './commands/owner.js'
import { whoami_command } from './commands/whoami.js'
import { keys_command } from './commands/keys.js'
import { upgrade_command } from './commands/upgrade.js'
import { info_command } from './commands/info.js'
import { backup_command } from './commands/backup.js'
import { export_command } from './commands/export.js'
import { load_command } from './commands/load.js'
import { env_command } from './commands/env.js'
import { importenv_command } from './commands/importenv.js'
import { setenv_command } from './commands/setenv.js'
import { serializers_command } from './commands/serializers.js'
import { introduction_command } from './commands/introduction.js'
import { server_commands } from './commands/server.js'
import { gui_command } from './commands/gui.js'

const program = new Command()

program
    .name('jseeqret')
    .description('Secure secrets manager (JS port of seeqret)')
    .version('0.5.1')
    .addOption(
        new Option('-L, --log <level>', 'Set log level')
            .choices(['ERROR', 'WARNING', 'INFO', 'DEBUG'])
            .default('ERROR')
    )
    .hook('preAction', (this_command) => {
        const opts = this_command.opts()
        if (opts.log) set_log_level(opts.log)
    })

program.addCommand(init_command)
program.addCommand(list_command)
program.addCommand(get_command)
program.addCommand(add_commands)
program.addCommand(rm_commands)
program.addCommand(edit_commands)
program.addCommand(users_command)
program.addCommand(owner_command)
program.addCommand(whoami_command)
program.addCommand(keys_command)
program.addCommand(upgrade_command)
program.addCommand(info_command)
program.addCommand(backup_command)
program.addCommand(export_command)
program.addCommand(load_command)
program.addCommand(env_command)
program.addCommand(importenv_command)
program.addCommand(setenv_command)
program.addCommand(serializers_command)
program.addCommand(introduction_command)
program.addCommand(server_commands)
program.addCommand(gui_command)

program.parse()
