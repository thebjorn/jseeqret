---
name: project-conventions
description: Code style and patterns for jseeqret. Apply when writing or reviewing code.
user-invocable: false
---

Follow STYLEGUIDE.md strictly:
- snake_case for variables/functions, PascalCase for classes, UPPER_SNAKE_CASE for constants
- 4-space indent, line length 79-100 chars
- Single quotes, no semicolons (except return statements)
- Condensed repeated patterns, condensed inline SVG
- HTML void elements without closing solidus (<br> not <br/>)
- Imports grouped: standard, third-party, local
- Blank lines between logical blocks inside functions
- kebab-case for filenames and directories