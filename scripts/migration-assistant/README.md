# Migration Assistant

The Migration Assistant is a set of tools designed to help manage the documentation migration for Clerk Docs. It helps convert markdown-based proposals into structured manifests and validates content mappings between the legacy and new documentation structures.

## Overview

The migration assistant consists of two main scripts that work together to:

1. **Generate navigation manifests** from markdown proposals
2. **Validate content mappings** between legacy and new documentation structures
3. **Identify gaps** in content migration planning

## Scripts

### 1. `generate-manifest.ts`

Converts a markdown-based proposal into a structured JSON manifest.

**What it does:**

- Reads `proposal.md` (markdown file with the new IA structure)
- Parses markdown headers (`##`, `###`) and list items (`-`) into a hierarchical navigation structure
- Supports custom URL slugs using bracket notation: `Title [custom-slug]`
- Generates `public/manifest.proposal.json` with the navigation structure
- Validates the generated manifest against a Zod schema

**Input:** `proposal.md`
**Output:** `public/manifest.proposal.json`

### 2. `map-content.ts`

Analyzes the relationship between legacy content and the proposed new structure.

**What it does:**

- Reads `proposal-mapping.json` (mapping of legacy files to new locations)
- Scans all existing `.mdx` files in the `docs/` directory
- Compares mappings against the proposed manifest structure
- Identifies issues and provides detailed reports

**Reports on:**

- **Unhandled legacy files** - Files that exist but aren't mapped anywhere
- **Invalid mappings** - Mappings pointing to destinations that don't exist in the manifest
- **Pages needing new content** - Manifest paths that don't have content sources
- **Summary statistics** - Counts of different mapping actions

**Input:** `proposal-mapping.json`, `public/manifest.proposal.json`, existing `.mdx` files
**Output:** Console reports and warnings

## Key Files

### Configuration Files

- **`proposal.md`** - Markdown file defining the new structure
- **`proposal-mapping.json`** - JSON file mapping legacy content to new locations
- **`flags.json`** - Feature flags (contains `use-proposal-manifest` flag)

### Generated Files

- **`public/manifest.proposal.json`** - Generated navigation manifest from the proposal

## Mapping Actions

The `proposal-mapping.json` file supports several action types:

- **`move`** - Move content to a new location as-is
- **`consolidate`** - Combine multiple files into a single new location
- **`generate`** - Create new content (placeholder for content that needs to be written)
- **`convert-to-example`** - Convert documentation into github example
- **`drop`** - Remove content entirely

### Mapping Format

```json
{
  "path/to/legacy/file.mdx": {
    "newPath": "/docs/new/location",
    "action": "move"
  },
  "glob/pattern/**": {
    "newPath": "/docs/new/section/**",
    "action": "generate"
  }
}
```

**Glob Pattern Support:**

- `**` - Matches any number of directories and files
- `*` - Matches any characters except `/` within a single path segment
- Patterns are expanded to match actual files automatically

## Usage

### Running the Scripts

```bash
# Generate manifest from proposal.md
npm run migration:generate-manifest

# Generate manifest with file watching (auto-regenerate on changes)
npm run migration:generate-manifest:watch

# Analyze content mappings
npm run migration:map-content
```

### Environment Variables

- **`DOCS_WARNINGS_ONLY=true`** - Show detailed grouped warnings instead of simplified output

```bash
# Detailed warnings mode
DOCS_WARNINGS_ONLY=true npm run migration:map-content
```

## Workflow

### 1. Define New Information Architecture

Edit `proposal.md` to define your new documentation structure:

```markdown
## Section Name [custom-slug]

### Subsection

- Page Title [custom-page-slug]
- Another Page
  - Nested Page
```

### 2. Generate Manifest

```bash
npm run migration:generate-manifest
```

This creates `public/manifest.proposal.json` with the navigation structure.

### 3. Map Legacy Content

Edit `proposal-mapping.json` to map existing content to new locations:

```json
{
  "old/path/file.mdx": {
    "newPath": "/docs/new/location",
    "action": "move"
  }
}
```

### 4. Validate Mappings

```bash
npm run migration:map-content
```

Review the output for:

- Unhandled files that need mapping
- Invalid mappings pointing to non-existent destinations
- Missing content for manifest pages

### 5. Iterate

Repeat steps 1-4 until all content is properly mapped and validated.

## Output Examples

### Standard Output

```
📋 UNHANDLED LEGACY FILES:
   • path/to/unmapped/file.mdx

❌ INVALID MAPPINGS:
   • source.mdx → /docs/nonexistent/path (move)

📝 MANIFEST PATHS:
   • /docs/section/page

📊 SUMMARY:
   • Legacy files: 150
   • Manifest paths: 120
   • Handled files: 140
   • Unhandled files: 10
```

### Detailed Warnings Mode

With `DOCS_WARNINGS_ONLY=true`:

```
⚠️  Found 5 unhandled legacy files:

📁 authentication/ (3 files)
   • authentication/legacy-page.mdx
   • authentication/old-guide.mdx

📁 guides/ (2 files)
   • guides/deprecated.mdx
```

## Tips

1. **Start broad** - Use glob patterns in mappings to handle multiple files at once
2. **Use the watch mode** while iterating on the proposal structure
3. **Run validation frequently** to catch mapping issues early
4. **Group related consolidations** to make the migration easier to manage
5. **Document custom slugs** clearly in your proposal for better URL structure

## Troubleshooting

- **Validation errors**: Check that your `proposal.md` follows the expected markdown structure
- **Glob patterns not working**: Ensure patterns use `**` for recursive matching and avoid shell glob syntax
- **Missing files in output**: Check that files aren't excluded by the `**/_*/**` ignore pattern
- **Invalid manifest structure**: Run the generate script to see detailed Zod validation errors
