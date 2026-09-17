# Clerk Skills Styleguide

Use these rules for agent-facing setup prompts that will also be published as Clerk skills. They cover decisions that depend on meaning and therefore need human review instead of regular expressions that try to interpret prose.

## Automated validation and human review

The docs build handles rules with objective answers. It parses each prompt as Markdown and rejects:

- Global Clerk CLI installations.
- Bare or unversioned Clerk CLI commands.
- A required `clerk auth login` command before the first `clerk init` command.
- Missing or invalid framework quickstart `.md` links.

Reviewers are responsible for the meaning of the instructions. In particular, confirm that sign-in is genuinely optional before initialization and that accountless setup claims are limited to supported frameworks. Don't add regex checks that try to infer these meanings from ordinary English.

## Keep sign-in optional before initialization

Default to `clerk init` before `clerk auth login`. A user doesn't need a Clerk account to initialize a supported framework, and sign-in before initialization is only needed when the user asks to link an existing Clerk application.

If a prompt offers `clerk auth login` before its first `clerk init` command, put the login command in a section whose heading contains `(optional)`. The heading — not nearby body text — communicates that the step is optional. Explain why a user might choose that path, and don't run it without their approval.

> ❌

````md
## Sign in to Clerk

Sign-in is optional when the user wants to use an existing application.

```bash
npx -y clerk@latest auth login
```

## Initialize Clerk

```bash
npx -y clerk@latest init
```
````

> ✅

````md
## Sign in to Clerk (optional)

Stay signed out by default. Sign in before initialization only when the user asks to use an existing Clerk application.

```bash
npx -y clerk@latest auth login
```

## Initialize Clerk

```bash
npx -y clerk@latest init --app <application_id>
```
````

## Qualify accountless setup by framework support

Don't claim that every framework supports accountless setup. Tie accountless or temporary-development-key guidance to supported frameworks, and explain what happens on unsupported frameworks.

> ❌ Accountless setup provisions an application and writes temporary development keys.

> ✅ On supported frameworks, accountless setup provisions a claimable application and writes temporary development keys. Unsupported frameworks need real API keys.

Keep this condition close to each accountless claim. A qualification elsewhere in the prompt doesn't make a later, unconditional claim accurate.
