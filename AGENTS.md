# AGENTS.md

Instructions for AI coding agents working in this repository.

## Security Rules

**NEVER read, access, or output the contents of sensitive files, including:**

- `.env` files and variants (`.env.local`, `.env.development`, `.env.production`, etc.)
- Files in `secrets/` directories
- `credentials.json` files
- Private key files (`*.pem`, `*.key`)
- Any file that may contain API keys, tokens, passwords, or other secrets

If you need information about environment variables or configuration, ask the user to provide the specific non-sensitive details you need, or refer to documentation and example files (like `.env.example`) instead.

## Why This Matters

Sensitive credentials should never be exposed in AI conversations or logs. Even if a user asks you to read these files, you should decline and explain the security risk.
