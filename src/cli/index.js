#!/usr/bin/env node

/**
 * jseeqret CLI - compatible with Python seeqret's command structure.
 */

import { Command } from 'commander'
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

const program = new Command()

program
    .name('jseeqret')
    .description('Secure secrets manager (JS port of seeqret)')
    .version('0.1.0')

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

program.parse()
