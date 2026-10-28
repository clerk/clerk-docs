# Add Clerk to an iOS or macOS app

Use the Clerk CLI to create or configure an Xcode project, then finish its Swift integration. Xcode and authenticated Clerk access are required; accountless setup isn't supported.

Manual SDK guide: https://clerk.com/docs/ios/getting-started/quickstart.md?manual=1

Inspect source and dependencies without reading secrets. Agree on migration or coexistence if another auth system exists. Preserve startup logic, navigation, previews, and custom key loading.

Ask one question at a time in plain language. Skip questions the user already answered, and don't explain these instructions to them.

## 1. Prepare for setup

For a new Xcode project, ask for the platform (iOS or macOS), then the app name, waiting for each answer. Ask only "What would you like to name your app?" without listing naming rules. Identify the directory that will contain the app; let the CLI validate the name and destination.

Let the CLI inspect existing projects before running your own Xcode commands. Ask separately about prebuilt sign-in UI and native Sign in with Apple only if undecided. Add `--prebuilt-auth-ui` and `--sign-in-with-apple` only for requested features. Preserve installed SDK products; if prebuilt UI isn't wanted and ClerkKitUI isn't installed, add `--apple-sdk core`.

## 2. Initialize Clerk

**New project:** run from the directory that will contain the app:

```bash
npx -y clerk@latest init --mode agent --starter --framework ios --name "<app_name>" --json <selected_setup_flags>
```

Use `--framework macos` for Mac. Include requested prebuilt UI on this first run, before the starter is modified. Pass user-supplied `--bundle-id` and `--team-id`; otherwise let the CLI use defaults or report missing values.

Don't create a Clerk application yet. If the user already chose an existing application, resolve its ID using step 3 and add `--app <application_id>`; otherwise omit `--app`. The CLI validates starter inputs before asking about an inherited link or writing the project. With no inherited link or selected application, it writes the project and returns `application-required`.

**Existing project:** choose its Clerk application using step 3, then run from its project or workspace directory:

```bash
npx -y clerk@latest init --mode agent --app <application_id> --json <selected_setup_flags>
```

Replace `<selected_setup_flags>` with the chosen flags, or omit it. Both commands return JSON; follow its status below. Don't run a dry run unless requested.

## 3. Follow the JSON result

Read stdout even after a nonzero exit. `application-required` can exit successfully but still needs a choice.

For app selection and checks in this step, run commands from `starter.projectDir` when it is present; otherwise use the original setup directory. Run `starter.continuation` from the original setup directory because it already includes the change to the new project's directory.

### Choose a Clerk application

For a new project, choose or create the application when the CLI returns `application-required` or `input-required` with `link.flag: "--app"`. Remember an existing choice or request to create one; don't ask again.

Run `npx -y clerk@latest whoami` from that directory. If authentication is needed, explain the browser approval and run `npx -y clerk@latest auth login` there, then retry. Configured platform-key authentication needs no browser login. Never request pasted credentials.

- For a pre-existing project without a choice, inspect its Clerk configuration. If configured, run `npx -y clerk@latest apps list --json` and identify a unique exact Publishable Key match to an instance's `publishable_key`. Use source or non-secret configuration, never `.env` or unrelated shell variables. Similar names or a single list entry aren't proof. Resolve unreadable, unmatched, or conflicting configuration with the user; if the match differs from the `whoami` link, name both and ask which to use. Otherwise use the match.
- If the application is still undecided and the starter or `whoami` reports a link, ask whether to reuse it (recommended for the same product), use another application, or create one. This also applies to an existing project without Clerk configuration; don't silently reuse an inherited link. Without a link or prior choice, list applications and offer up to five, with the full list on request, or creation using the app's name. An empty list without existing configuration means creation; a listing failure doesn't.
- Before creating an application, if the starter reported a link (or `whoami` reported one for a pre-existing project), check `git rev-parse --show-toplevel` from the same directory. Inside Git, explain that choosing a new application switches the repository's shared CLI link and get explicit agreement first. For a new project, offer a location outside that repository instead; rerun the starter there before creating the application.

If an unwritten starter's inputs or location change, rerun it before creating the Clerk application. When creation is still needed, run `npx -y clerk@latest apps create "<application_name>" --json`. If it fails, list before retrying: creation may have succeeded remotely. Keep the selected or returned `application_id` for `--app`; handle IDs yourself. Don't create another application when retrying setup.

### Resolve other statuses

- **`input-required`:** use the returned issues, questions, choices, and flags to resolve only missing or conflicting information. Explain a rejected name's relevant restriction in plain language and agree on a replacement. For an existing destination, ask for another name or location; don't delete or reuse the folder. Follow Xcode and Personal Team guidance without changing selected features or team. For `identity`, supply `--bundle-id` or `--app-id-prefix` as needed; the App ID Prefix comes from Apple Developer and is usually the Team ID, but can differ.
- **`link.flag: "--relink"`:** explain the reported change and scope and offer to keep the current application. If the starter hasn't written a project yet, also offer a location outside the repository. Add `--relink` only after explicit agreement to that link change. Reuse approval for the same switch and scope; choosing another application alone isn't approval.
- **`selection-required`:** select the intended Xcode app from the returned choices, asking only if ambiguous. Keep `--xcode-project` and `--xcode-target` selectors. Debug and Release are covered by default; use `--xcode-configuration` for a requested custom configuration.
- **`setup-interrupted`:** report progress and resolve the error without overwriting user edits or bypassing unsupported settings.

If `starter.projectDir` is present, the project was written: follow `starter.continuation` instead of repeating `--starter`, substituting the selected application ID and applying newly resolved inputs. Preserve its setup flags and directory change, and run returned commands through `npx -y clerk@latest` with `--mode agent`. If nothing was written, retry the original command with the resolved inputs. If the run stops without recovery data, inspect the destination and application list before retrying; don't assume nothing was created.

When the result includes a `handoff`, continue below.

## 4. Finish the Swift integration

For a new project, use the returned `starter.projectDir` as the working directory for every command in steps 4–5, including `doctor` and the build; don't assume the continuation's `cd` persists between commands.

Read `handoff.completed`, `handoff.remaining`, and `handoff.tasks`. Fetch documentation linked by pending source tasks before editing; use the manual SDK guide above if no links are supplied. Follow relevant sections and APIs compatible with the installed SDK. Don't read SDK source or call Clerk APIs directly. Preserve completed work, follow integration constraints, and explain remaining manual setup.

Without prebuilt UI, don't build a custom sign-in flow unless requested. Link the [custom flow guide](https://clerk.com/docs/ios/guides/development/custom-flows/overview.md) in the final report and offer to build one. If native Sign in with Apple was enabled, also link its [guide](https://clerk.com/docs/ios/guides/configure/auth-strategies/sign-in-with-apple.md).

## 5. Check setup and stop

Run with the same Xcode selectors:

```bash
npx -y clerk@latest doctor --json
```

Doctor checks project and Clerk settings, not custom Swift integration; native setup doesn't support `--fix`. Ignore unrelated warnings such as shell completion. Missing production configuration is follow-up work: without a production instance, production checks are skipped. Don't change production or Release settings to clear warnings unless production setup was requested.

Set `DEVELOPER_DIR` to `handoff.xcode.developerDir` for the build command without changing the system's Xcode selection. Run one unsigned Debug build of the selected target, passing `ONLY_ACTIVE_ARCH=YES` and `CODE_SIGNING_ALLOWED=NO` on the command line without changing project settings. Choose an available iOS simulator or the current Mac as the destination. If the target has no Debug configuration or no suitable destination is available, report that and stop. Fix errors caused by your integration changes and retry; report environment or unrelated build failures and stop.

Stop after the build, unless the user already requested a custom flow. Release builds, launching, sign-in/sign-out/relaunch tests, test-user creation, and simulator troubleshooting require an explicit request. Report completed setup, the result's `identity` (App ID Prefix, Bundle ID, prefix source), source edits, build result, and unresolved requirements. "Setup complete; sign-in not tested" is valid: `appIntegrationComplete: false` means the CLI hasn't verified app behavior, not that you must keep testing.
