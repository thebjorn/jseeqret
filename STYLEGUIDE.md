# Style guide
(original version: dktools/data/STYLEGUIDE.md)

This style guide outlines the conventions and best practices for writing code in this project. Adhering to these guidelines will help maintain consistency, readability, and quality across the codebase.

This package uses

- [ ] python
- [x] svelte
- [x] typescript
- [x] javascript
- [x] html
- [x] css
- [x] scss
- [ ] less

Use the relevant MCP servers and/or LSP servers when available.

## General Principles

- Write clear and descriptive comments.
- Use meaningful variable and function names (use i,j,k only for loop indices).
- Keep functions and methods short and focused on a single task.
- Avoid deep nesting of code blocks.
- Use docstrings (python) or JSDoc (JavaScript/TypeScript) for documenting functions, classes, and modules.
- Follow language-specific best practices and conventions, except where overridden by this style guide.

## Formatting

- Use 4 spaces for indentation (no tabs).
- Limit lines to a maximum of 79 characters (preferably, up to 100 if needed). HTML can use longer lines if it improves readability.
- use blank lines to separate thoughts inside functions (e.g., between logical blocks of code).
- Prefer single quotes for strings unless the string contains a single quote character.
- Place imports at the top of the file, grouped by standard library, third-party, and local imports.

## Naming Conventions
Follow these naming conventions even in languages that normally use different conventions:

- Use `snake_case` for variable and function names.
- Use `PascalCase` for class names.
- Use `UPPER_SNAKE_CASE` for constants.
- Use kebab-case for file, directory, and url names.
- use required casing where dictated by frameworks or libraries (e.g., React components, Svelte components, etc.).
  (e.g. use toString() in JavaScript, not to_string())

## Quotes

Use single quotes for strings unless the string contains a single quote character.
Don't change existing quotes.

## Data Structures Formatting
### List of values
Lists of values should be formatted like this:

    variable = [
        value1,
        value2,
        value3,
    ]

except for short lists that fit on one line:

    variable = [value1, value2, value3]

### List of objects/dicsts

Lists of objects should be formatted like this:

    variable = [{
        property: value,
        property2: value2,
    }, {
        property: value,
        property2: value2,
    }]

### Dict of lists

Dicts of lists should be formatted like this:

    variable = {
        key1: [value1, value2],
        key2: [value1, value2],
    }

### Dict of dicts

Dicts of dicts should be formatted like this:

    variable = {
        key1: {
            property: value,
            property2: value2,
        },
        key2: {
            property: value,
            property2: value2,
        },
    }

# TypeScript/JavaScript/Svelte Specific Guidelines

## Semicolon Usage
- Omit semicolons at the end of statements, except where necessary to avoid ambiguity.
- Do not add semicolons to existing code that omits them.
- Do use semicolons for return statements.

    // Correct
    const value = 42

    function getValue() {
        return value
    }

    // Incorrect
    const value = 42;

    function getValue() {
        return value;
    }

## Imports

Imports should be grouped by standard library, third-party, and local imports and use single quotes. Formatting should be

    import { ClientSyllabus, ClientCustomer } from '@norsktest/models/client-models'

use multiple lines if the import statement is too long:

    import { 
        ClientSyllabus,
        ClientCustomer,
    } from '@norsktest/models/client-models'

## $props

    const { data } = $props();

or if multiple values:

    const { 
        data, 
        user 
    } = $props();

### repeated patterns

Keep repeated code patterns similar, even if it breaks line length.
E.g.

WRONG:

    <TableDetails
        bordered
        cols={[
            table_column({ colname: "title", field: "name", header: "Tittel", }),
            table_column({ colname: "description", header: "Beskrivelse", }),
            table_column({
                colname: "action",
                header: "",
                align: "center",
            }),
        ]}
    />

RIGHT:

    <TableDetails
        bordered
        cols={[
            table_column({ colname: "title", field: "name", header: "Tittel", }),
            table_column({ colname: "description", header: "Beskrivelse", }),
            table_column({ colname: "action", header: "", align: "center", }),
        ]}
    />

#### Prefer condenced code when there are repetitions

WRONG:

    <form id="add-syllabus" data-help="add-syllabus" data-layout="inline" class="p1 border-top">
        <input 
            type="text" 
            disabled={add_syllabus_busy} 
            required 
            placeholder="Tittel" 
            bind:value={new_syllabus_name}
        >
        <input 
            type="text" 
            disabled={add_syllabus_busy} 
            placeholder="Beskrivelse" 
            bind:value={new_syllabus_description}
        >
        
        <button disabled={add_syllabus_busy} onclick={add_syllabus}>
            Opprett
        </button>
    </form>

RIGHT:

    <form id="add-syllabus" data-help="add-syllabus" data-layout="inline" class="p1 border-top">
        <input type="text" disabled={add_syllabus_busy} required placeholder="Tittel" bind:value={new_syllabus_name}>
        <input type="text" disabled={add_syllabus_busy} placeholder="Beskrivelse" bind:value={new_syllabus_description}>
        
        <button disabled={add_syllabus_busy} onclick={add_syllabus}>
            Opprett
        </button>
    </form>
            
### html void (self-closing) elements

HTML elements without a closing tag (e.g. meta, br, input hr, img, etc.) should not have a closing solidus.

WRONG:

    <br/>
    <img src="image.png"/>

RIGHT:

    <br>
    <img src="image.png">

# SVG Specific Guidelines

## inline svg

Keep inline svg condensed:

WRONG

    <svg 
        id="fi_3729762" 
        viewBox="0 0 24 24" 
        xmlns="http://www.w3.org/2000/svg" 
        style="fill:white;stroke:white"
    >
        <path 
            d="m16 10c-1.431 0-2.861-.424-4.283-1.271-.442-.264-.717-.756-.717-1.286v-2.943c0-.276.224-.5.5-.5s.5.224.5.5v2.943c0 .176.09.343.229.426 2.538 1.514 5.004 1.514 7.541 0 .14-.083.23-.25.23-.426v-2.943c0-.276.224-.5.5-.5s.5.224.5.5v2.943c0 .529-.275 1.021-.718 1.285-1.421.848-2.851 1.272-4.282 1.272z"
        ></path><path 
            d="m16 10c-1.431 0-2.861-.424-4.283-1.271-.442-.264-.717-.756-.717-1.286v-2.943c0-.276.224-.5.5-.5s.5.224.5.5v2.943c0 .176.09.343.229.426 2.538 1.514 5.004 1.514 7.541 0 .14-.083.23-.25.23-.426v-2.943c0-.276.224-.5.5-.5s.5.224.5.5v2.943c0 .529-.275 1.021-.718 1.285-1.421.848-2.851 1.272-4.282 1.272z"
        ></path>
    </svg>

RIGHT

    <svg id="fi_3729762" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style="fill:white;stroke:white">
        <path d="m16 10c-1.431 0-2.861-.424-4.283-1.271-.442-.264-.717-.756-.717-1.286v-2.943c0-.276.224-.5.5-.5s.5.224.5.5v2.943c0 .176.09.343.229.426 2.538 1.514 5.004 1.514 7.541 0 .14-.083.23-.25.23-.426v-2.943c0-.276.224-.5.5-.5s.5.224.5.5v2.943c0 .529-.275 1.021-.718 1.285-1.421.848-2.851 1.272-4.282 1.272z"></path><path d="m16 10c-1.431 0-2.861-.424-4.283-1.271-.442-.264-.717-.756-.717-1.286v-2.943c0-.276.224-.5.5-.5s.5.224.5.5v2.943c0 .176.09.343.229.426 2.538 1.514 5.004 1.514 7.541 0 .14-.083.23-.25.23-.426v-2.943c0-.276.224-.5.5-.5s.5.224.5.5v2.943c0 .529-.275 1.021-.718 1.285-1.421.848-2.851 1.272-4.282 1.272z"></path>
    </svg>

unless the svg is already manually formatted

CORRECT (already formatted)

    <svg version="1.1" preserveAspectRatio="xMidYMid meet"
        width="100%" height="100%" viewBox="0 0 400 400"
        xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">

            <defs>
                    <style type="text/css"><![CDATA[
                            *{fill:#FDB827}
                            circle{r:12px}
                    ]]></style>
            </defs>

            <g id="dots" transform="scale(1.5) translate(-17 -9)">
                    <circle cx="95.3" cy="239"/>
                    <circle cx="55.6" cy="199"/>
                    <circle cx="41" cy="143.8"/>
                    <circle cx="55.6" cy="88"/>
                    <circle cx="95.3" cy="48"/>
                    <circle cx="149.7" cy="33"/>
                    <circle cx="204.2" cy="47"/>
                    <circle cx="244.5" cy="88"/>
                    <circle cx="259" cy="143"/>
                    <circle cx="244.4" cy="199"/>
                    <circle cx="204.2" cy="239"/>
            </g>

            <ellipse id="head" cx="200" cy="112.4" rx="37.2" ry="29.5"/>

            <path id="body" d="
                    M 252 225
                    A 37 75 0 0 1 230 287
                    A 30 99 0 0 1 170 287
                    A 37 75 0 0 1 148 225
                    V 190
                    A 36 35 0 0 1 185 155
                    H 220
                    A 36 35 0 0 1 252 190
                    z"/>
    </svg>
