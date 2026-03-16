#!/usr/bin/env node

/**
 * jseeqret CLI - compatible with Python seeqret's command structure.
 */

import { Command } from 'commander'
import { initCommand } from './commands/init.js'
import { addCommands } from './commands/add.js'
import { listCommand } from './commands/list.js'
import { getCommand } from './commands/get.js'
import { rmCommands } from './commands/rm.js'
import { editCommands } from './commands/edit.js'
import { usersCommand } from './commands/users.js'
import { ownerCommand } from './commands/owner.js'
import { whoamiCommand } from './commands/whoami.js'
import { keysCommand } from './commands/keys.js'
import { upgradeCommand } from './commands/upgrade.js'
import { infoCommand } from './commands/info.js'

const program = new Command()

program
  .name('jseeqret')
  .description('Secure secrets manager (JS port of seeqret)')
  .version('0.1.0')

program.addCommand(initCommand)
program.addCommand(listCommand)
program.addCommand(getCommand)
program.addCommand(addCommands)
program.addCommand(rmCommands)
program.addCommand(editCommands)
program.addCommand(usersCommand)
program.addCommand(ownerCommand)
program.addCommand(whoamiCommand)
program.addCommand(keysCommand)
program.addCommand(upgradeCommand)
program.addCommand(infoCommand)

program.parse()
