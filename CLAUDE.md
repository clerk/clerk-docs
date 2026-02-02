# Clerk Documentation Style Guide

## Writing Style

### Avoid "click" - Use "select" instead
Instead of "click the button" or "click sign in", use "select" which is device-agnostic:
- Good: `When a user selects "Sign in" on the satellite domain...`
- Bad: `When a user clicks sign in on the satellite domain...`

### Quotation marks for UI elements
When referring to buttons, menu items, or other UI elements, put them in quotes:
- Good: `Select "Sign in" to continue`
- Bad: `Select Sign in to continue`

### Link text for internal references
When linking to sections within the same page, include "section" in the link text:
- Good: `For details, see the [How it works](#how-it-works) section.`
- Bad: `For details, see [How it works](#how-it-works).`

### Avoid stacking callouts
Don't place multiple callouts (NOTE, WARNING, CAUTION, etc.) back-to-back at the start of a page. Move secondary callouts to more contextually appropriate locations within the content.

### Reduce repetition across sections
Avoid duplicating the same content in multiple places. If a concept is explained in one section, link to it from other places rather than repeating it. Consider whether you can consolidate related content.

### Use "matches" instead of "legacy"
When describing behavior from a previous version, use neutral phrasing:
- Good: `This matches the original Core 2 behavior`
- Bad: `This is the legacy behavior from Core 2`

### Numbered lists for sequential steps
Use numbered lists when describing a sequence of actions. Start each step with an action verb:
1. Visit the satellite domain
1. Select "Sign in"
1. Complete the sign-in flow

### Code comments
Keep code comments helpful but not preachy:
- Good: `// Uncomment to automatically sync auth state on first load.`
- Bad: `// Set to true to automatically sync auth state on first load (not recommended for performance)`

## MDX Conventions

### Partials
- Can be nested (partials within partials work fine)
- Use partials for repeated content like option descriptions
- Create new partials when the same text appears in 3+ places

### Properties documentation
- Mark optional properties with `?` suffix: `satelliteAutoSync?`
- Always include the type and default value
- Link to relevant documentation pages

## Formatting

### Tables
- Use for comparing behaviors or features across versions
- Keep cell content concise
- Use consistent formatting within columns

### Code blocks
- Always include a filename when showing file contents
- Use the `prettier: false` option when formatting would break the example
