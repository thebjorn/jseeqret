---
name: gen-test
description: Generate Vitest tests for a module following project conventions
disable-model-invocation: true
---

Generate tests for: $ARGUMENTS

Reference existing tests in `tests/` for patterns (describe/it structure, temp vault setup, snake_case naming).

1. Read the source module and existing test files
2. Identify functions/exports to test
3. Generate tests using Vitest (import { describe, it, expect } from 'vitest')
4. Follow STYLEGUIDE.md conventions (snake_case, single quotes, no semicolons, 4-space indent)
5. Place in `tests/` directory with naming pattern `<module>.test.js`
6. Run `npx vitest run` to verify