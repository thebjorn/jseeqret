import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import {
    create_test_vault, cleanup_vault, run_command,
} from './cli-helpers.js'

let tmp_dir
let work_dir

beforeEach(async () => {
    const vault = await create_test_vault()
    tmp_dir = vault.tmp_dir

    // Create a working directory for env.template
    work_dir = fs.mkdtempSync(
        path.join(os.tmpdir(), 'jseeqret-env-work-')
    )

    // Add test secrets
    run_command([
        'add', 'key', 'DB_HOST', 'localhost',
        '--app', 'myapp', '--env', 'dev',
    ], { vault_dir: tmp_dir })
    run_command([
        'add', 'key', 'DB_PASS', 's3cret',
        '--app', 'myapp', '--env', 'dev',
    ], { vault_dir: tmp_dir })
})

afterEach(() => {
    cleanup_vault(tmp_dir)
    fs.rmSync(work_dir, { recursive: true, force: true })
})

describe('CLI: env', () => {
    it('generates .env from env.template', () => {
        fs.writeFileSync(
            path.join(work_dir, 'env.template'),
            'myapp:dev:DB_HOST\nmyapp:dev:DB_PASS\n',
        )

        const result = run_command([
            'env',
        ], { vault_dir: tmp_dir, cwd: work_dir })

        expect(result.exit_code).toBe(0)
        expect(result.stdout).toContain('DB_HOST')
        expect(result.stdout).toContain('DB_PASS')

        const env_file = fs.readFileSync(
            path.join(work_dir, '.env'), 'utf-8',
        )
        expect(env_file).toContain('DB_HOST="localhost"')
        expect(env_file).toContain('DB_PASS="s3cret"')
    })

    it('supports rename syntax', () => {
        fs.writeFileSync(
            path.join(work_dir, 'env.template'),
            'MY_DB_HOST=myapp:dev:DB_HOST\n',
        )

        const result = run_command([
            'env',
        ], { vault_dir: tmp_dir, cwd: work_dir })

        expect(result.exit_code).toBe(0)

        const env_file = fs.readFileSync(
            path.join(work_dir, '.env'), 'utf-8',
        )
        expect(env_file).toContain('MY_DB_HOST="localhost"')
    })

    it('supports constant values', () => {
        fs.writeFileSync(
            path.join(work_dir, 'env.template'),
            'NODE_ENV=production\nmyapp:dev:DB_HOST\n',
        )

        const result = run_command([
            'env',
        ], { vault_dir: tmp_dir, cwd: work_dir })

        expect(result.exit_code).toBe(0)

        const env_file = fs.readFileSync(
            path.join(work_dir, '.env'), 'utf-8',
        )
        expect(env_file).toContain('NODE_ENV="production"')
        expect(env_file).toContain('DB_HOST="localhost"')
    })

    it('treats quoted values with colons as constants', () => {
        fs.writeFileSync(
            path.join(work_dir, 'env.template'),
            'BETTER_AUTH_URL="http://localhost:5176"\n' +
            "SINGLE_QUOTED='https://example.com:8080/path'\n" +
            'MY_DB_HOST=myapp:dev:DB_HOST\n',
        )

        const result = run_command([
            'env',
        ], { vault_dir: tmp_dir, cwd: work_dir })

        expect(result.exit_code).toBe(0)

        const env_file = fs.readFileSync(
            path.join(work_dir, '.env'), 'utf-8',
        )
        expect(env_file).toContain('BETTER_AUTH_URL="http://localhost:5176"')
        expect(env_file).toContain('SINGLE_QUOTED="https://example.com:8080/path"')
        // Unquoted rhs with colons is still rename-filter syntax
        expect(env_file).toContain('MY_DB_HOST="localhost"')
    })

    it('rejects duplicate constant keys', () => {
        fs.writeFileSync(
            path.join(work_dir, 'env.template'),
            'DB_HOST=constant\nmyapp:dev:DB_HOST\n',
        )

        const result = run_command([
            'env',
        ], { vault_dir: tmp_dir, cwd: work_dir })

        expect(result.exit_code).not.toBe(0)
        expect(result.stderr).toContain('Duplicate key')
    })

    it('fails without env.template', () => {
        const result = run_command([
            'env',
        ], { vault_dir: tmp_dir, cwd: work_dir })

        expect(result.exit_code).not.toBe(0)
        expect(result.stderr).toContain('env.template')
    })
})

describe('CLI: importenv', () => {
    it('imports secrets from .env file', () => {
        const env_path = path.join(work_dir, 'test.env')
        fs.writeFileSync(env_path, 'NEW_KEY="new_value"\n')

        const result = run_command([
            'importenv', env_path,
        ], { vault_dir: tmp_dir })

        expect(result.exit_code).toBe(0)
        expect(result.stdout).toContain('Added: NEW_KEY')
        expect(result.stdout).toContain('1 added')

        const get_result = run_command([
            'get', 'NEW_KEY',
        ], { vault_dir: tmp_dir })
        expect(get_result.stdout.trim()).toBe('new_value')
    })

    it('skips existing secrets', () => {
        const env_path = path.join(work_dir, 'test.env')
        fs.writeFileSync(env_path, 'NEW_KEY="v1"\n')

        run_command(['importenv', env_path], { vault_dir: tmp_dir })

        // Import again
        const result = run_command([
            'importenv', env_path,
        ], { vault_dir: tmp_dir })

        expect(result.exit_code).toBe(0)
        expect(result.stdout).toContain('Skipped')
    })

    it('updates existing secrets with --update', () => {
        const env_path = path.join(work_dir, 'test.env')
        fs.writeFileSync(env_path, 'UPD_KEY="original"\n')
        run_command(['importenv', env_path], { vault_dir: tmp_dir })

        fs.writeFileSync(env_path, 'UPD_KEY="updated"\n')
        const result = run_command([
            'importenv', env_path, '--update',
        ], { vault_dir: tmp_dir })

        expect(result.exit_code).toBe(0)
        expect(result.stdout).toContain('Updated')

        const get_result = run_command([
            'get', 'UPD_KEY',
        ], { vault_dir: tmp_dir })
        expect(get_result.stdout.trim()).toBe('updated')
    })

    it('supports --dry-run', () => {
        const env_path = path.join(work_dir, 'test.env')
        fs.writeFileSync(env_path, 'DRY_KEY="value"\n')

        const result = run_command([
            'importenv', env_path, '--dry-run',
        ], { vault_dir: tmp_dir })

        expect(result.exit_code).toBe(0)
        expect(result.stdout).toContain('Dry run')

        // Verify nothing was actually imported
        const get_result = run_command([
            'get', 'DRY_KEY',
        ], { vault_dir: tmp_dir })
        expect(get_result.exit_code).not.toBe(0)
    })

    it('fails for nonexistent file', () => {
        const result = run_command([
            'importenv', '/nonexistent/file.env',
        ], { vault_dir: tmp_dir })

        expect(result.exit_code).not.toBe(0)
        expect(result.stderr).toContain('not found')
    })

    it('imports with --app and --env', () => {
        const env_path = path.join(work_dir, 'test.env')
        fs.writeFileSync(env_path, 'APP_KEY="v"\n')

        const result = run_command([
            'importenv', env_path,
            '--app', 'webapp', '--env', 'staging',
        ], { vault_dir: tmp_dir })

        expect(result.exit_code).toBe(0)

        const get_result = run_command([
            'get', 'webapp:staging:APP_KEY',
        ], { vault_dir: tmp_dir })
        expect(get_result.stdout.trim()).toBe('v')
    })
})
