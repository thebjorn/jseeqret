import { Command } from 'commander'
import { list_serializers } from '../../core/serializers/index.js'
import { as_table } from '../utils.js'

export const serializers_command = new Command('serializers')
    .description('List available serializers')
    .action(() => {
        const serializers = list_serializers()
        const rows = serializers.map(cls => [cls.name, cls.tag, cls.version, cls.description])
        const headers = 'Name, Tag, Version, Description'

        // Use as_table-style output
        console.log()
        for (const row of rows) {
            console.log(`  ${row[1].padEnd(12)} v${row[2]}  ${row[3]}`)
        }
        console.log()
    })
