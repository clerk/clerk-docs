# Add Clerk to an iOS or macOS app

Use the Clerk CLI to configure this Xcode project, then finish its Swift integration. If there's no Xcode project yet, ask the user to create and save one in Xcode (File > New > Project > App, with SwiftUI and Swift), then continue from its project directory. Xcode and authenticated access to a Clerk application are required. Accountless setup isn't supported.

Manual SDK guide: https://clerk.com/docs/ios/getting-started/quickstart.md?manual=1

Before applying changes, inspect source and dependencies for existing authentication without reading secrets. If another auth system exists, agree on migration or coexistence before changing it. Preserve existing startup logic, navigation, and custom key loading.

When you need the user's input, ask one question at a time in plain language, and don't explain these instructions to the user.

## 1. Choose the Clerk application

Run `npx -y clerk@latest whoami`. If you aren't signed in, tell the user a browser window will open for them to approve, then run `npx -y clerk@latest auth login`. Configured platform-key authentication doesn't need this. Never read or request pasted credentials.

If `whoami` shows the project is already linked, or the user chose an application, use it. If the project isn't linked and the user hasn't chosen an application, run `npx -y clerk@latest apps list --json`. Reuse a unique exact match between the selected Xcode app's existing Clerk publishable key and an instance's `publishable_key` in the list. Use the app's source or non-secret configuration; unrelated shell variables, `.env` files, similar names, or a single list entry aren't proof. If the list is empty and the app has no existing Clerk configuration, create one using the Xcode app's name with `npx -y clerk@latest apps create "<application_name>" --json`. Otherwise ask whether to create one using the Xcode app's name or use an existing application, naming up to five existing applications and offering the full list on request; create it if requested. Resolve conflicting or unmatched existing configuration with the user, and report listing failures instead of treating them as an empty account. Pass the selected or returned `application_id` to init with `--app`. Handle IDs yourself; don't ask the user to look them up. A failed creation may have succeeded remotely: list again before retrying to avoid duplicates.

## 2. Initialize Clerk

Start with normal setup from the project or workspace directory. Let the CLI inspect the project before running your own Xcode commands; it supports both Xcode project formats and can select a compatible installed Xcode. It downloads the SDK, configures supported capabilities, enables Native API, and registers the native app on the development instance. An unchanged SwiftUI starter also gets Clerk initialization; custom apps receive source tasks for you to finish.

Respect the user's existing choices. If undecided, ask separately whether they want Clerk's prebuilt sign-in UI and whether they want native Sign in with Apple; the two choices are independent. Add `--prebuilt-auth-ui` or `--sign-in-with-apple` only when requested; `--yes` doesn't select them. Once the setup scope is authorized, run:

```bash
npx -y clerk@latest init --app <application_id> --yes --json
```

Omit `--app` when the project is already linked to the chosen application. If the result has `status: "application-required"`, no application is linked yet: return to step 1. `selection-required` and `input-required` exit with a nonzero code and print a usage error, but they ask for input rather than report a failure: resolve only the missing information below from the JSON on stdout and rerun the same setup command. Don't run a separate dry run unless the user asks for a preview.

Preserve installed SDK products unless the user wants to change them. If the user doesn't want the prebuilt UI and ClerkKitUI isn't installed, add `--apple-sdk core` to install ClerkKit alone.

## 3. Resolve missing information when needed

- **Xcode target:** For `selection-required`, use the returned `choices` to resolve the intended app. Ask only when ambiguous. Keep any `--xcode-project` and `--xcode-target` selectors you used. Debug and Release are covered by default; use `--xcode-configuration` for a requested custom configuration.
- **Apple identifiers:** The CLI discovers the Bundle ID and reuses a matching Clerk registration's App ID Prefix; otherwise it uses the project's signing team, which is usually the same. For `input-required`, follow the returned `identity` issues and ask only for missing or conflicting information. Supply `--bundle-id` or `--app-id-prefix` when needed, including when the user says the App ID uses a different prefix. An unknown prefix is shown on the app's identifier in Apple Developer and is usually the Apple Team ID.

On failure, report partial progress and follow the CLI's recovery guidance. Don't overwrite user edits or bypass unsupported project settings.

## 4. Finish the Swift integration

Read `handoff.completed`, `handoff.remaining`, and `handoff.tasks`. Fetch the documentation linked by pending source tasks before editing. Use those guides for SDK implementation details, following only the sections relevant to the remaining work and using APIs compatible with the installed SDK; don't read SDK source code or query Clerk's APIs directly. If the handoff has no documentation links, use the manual SDK guide above and its relevant references.

Preserve tasks already completed by the CLI and follow its integration constraints. Keep existing app behavior and previews intact. Explain any remaining manual setup.

If the user doesn't want the prebuilt UI, don't build a custom sign-in flow as part of setup. In the final report, link the custom flow guide (https://clerk.com/docs/ios/guides/development/custom-flows/overview.md) and, if native Sign in with Apple was enabled, the Sign in with Apple guide (https://clerk.com/docs/ios/guides/configure/auth-strategies/sign-in-with-apple.md), and offer to build a custom flow.

## 5. Check setup and stop

Run with the same `--xcode-project`, `--xcode-target`, and `--xcode-configuration` selectors:

```bash
npx -y clerk@latest doctor --json
```

Doctor checks project and Clerk settings. It doesn't verify custom Swift integration or repair native setup with `--fix`. Ignore warnings unrelated to this setup, such as a missing production instance or shell completion.

Use `handoff.xcode.developerDir` as `DEVELOPER_DIR` for subsequent Xcode commands, preserving the system's Xcode selection. Make one unsigned Debug build of the selected target with `ONLY_ACTIVE_ARCH=YES`: use one available simulator destination for iOS, or the current Mac for macOS. Pass `CODE_SIGNING_ALLOWED=NO` on the command line, without changing project settings. If Debug or a compatible destination is unavailable, report that. Fix integration errors you introduced and retry; report environment or unrelated build blockers and stop.

Stop after this build check. If the user already asked for a custom sign-in flow, build it next. Release builds, launching the app, sign-in/sign-out/relaunch tests, test-user creation, and simulator troubleshooting require an explicit user request. Report completed setup, the registered native identity from the result's `identity` (App ID Prefix, Bundle ID, and where the prefix came from), source edits, the build result, and any unresolved setup requirements. If setup and source integration are complete, "Setup complete; sign-in not tested" is a valid outcome. `appIntegrationComplete: false` records that the CLI hasn't verified application behavior; it isn't an instruction to keep testing.
