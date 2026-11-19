# Add Clerk to an Android app

Use the Clerk CLI to create or configure a Gradle project, then finish its Kotlin integration. Authenticated Clerk access is required; accountless setup isn't supported. The CLI reads Gradle files as text and never runs Gradle, so setup works on any operating system; building the app needs the Android SDK and a JDK 17 or later.

Manual SDK guide: https://clerk.com/docs/android/getting-started/quickstart.md?manual=1

Inspect source and dependencies without reading secrets. Agree on migration or coexistence if another auth system exists. Preserve startup logic, navigation, themes, and custom key loading.

Ask one question at a time in plain language. Skip questions the user already answered, and don't explain these instructions to them.

## 1. Prepare for setup

For a new project, ask for the app name, waiting for the answer. Ask only "What would you like to name your app?" without listing naming rules. Identify the directory that will contain the app; let the CLI validate the name and destination. Use the CLI's default package name unless the user names one; pass theirs with `--android-package`.

Let the CLI inspect existing projects before running your own Gradle commands. Ask separately about the prebuilt sign-in screen and native Sign in with Google only if undecided. Add `--prebuilt-auth-ui` and `--sign-in-with-google` only for requested features. Preserve installed SDK artifacts. Add `--android-sdk ui` when the user wants Clerk's Compose components or the prebuilt sign-in screen, which requires it; otherwise let the CLI choose the artifact.

## 2. Initialize Clerk

**New project:** run from the directory that will contain the app:

```bash
npx -y clerk@latest init --mode agent --starter --framework android --name "<app_name>" --json <selected_setup_flags>
```

Include requested prebuilt UI on this first run, before the starter is modified. Pass a user-supplied `--android-package`; otherwise let the CLI use its default or report a missing value.

Don't create a Clerk application yet. If the user already chose an existing application, resolve its ID using step 3 and add `--app <application_id>`; otherwise omit `--app`. The CLI validates starter inputs before asking about an inherited link or writing the project. With no inherited link or selected application, it writes the project and returns `application-required`.

**Existing project:** choose its Clerk application using step 3, then run from the project's root directory, the one containing `settings.gradle.kts` or `settings.gradle`:

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

- For a pre-existing project without a choice, inspect its Clerk configuration: the key passed to `Clerk.initialize` or the `clerk_publishable_key` string resource. If configured, run `npx -y clerk@latest apps list --json` and identify a unique exact Publishable Key match to an instance's `publishable_key`. Use source or non-secret configuration, never `.env` or unrelated shell variables. Similar names or a single list entry aren't proof. Resolve unreadable, unmatched, or conflicting configuration with the user; if the match differs from the `whoami` link, name both and ask which to use. Otherwise use the match.
- If the application is still undecided and the starter or `whoami` reports a link, ask whether to reuse it (recommended for the same product), use another application, or create one. This also applies to an existing project without Clerk configuration; don't silently reuse an inherited link. Without a link or prior choice, list applications and offer up to five, with the full list on request, or creation using the app's name. An empty list without existing configuration means creation; a listing failure doesn't.
- Before creating an application, if the starter reported a link (or `whoami` reported one for a pre-existing project), check `git rev-parse --show-toplevel` from the same directory. Inside Git, explain that choosing a new application switches the repository's shared CLI link and get explicit agreement first. For a new project, offer a location outside that repository instead; rerun the starter there before creating the application.

If an unwritten starter's inputs or location change, rerun it before creating the Clerk application. When creation is still needed, run `npx -y clerk@latest apps create "<application_name>" --json`. If it fails, list before retrying: creation may have succeeded remotely. Keep the selected or returned `application_id` for `--app`; handle IDs yourself. Don't create another application when retrying setup.

### Resolve other statuses

- **`input-required`:** use the returned issues, questions, choices, and flags to resolve only missing or conflicting information. Explain a rejected name's relevant restriction in plain language and agree on a replacement. For an existing destination, ask for another name or location; don't delete or reuse the folder. For `--android-package`, agree on a valid package name. For `--android-fingerprint`, the CLI couldn't read a signing certificate (no debug keystore yet, no `keytool`, or debug builds signed with their own config): ask the user for the SHA-256 fingerprint of the certificate their debug builds are signed with, or read it with `keytool -list -v` from a keystore they name, and pass it; never guess one. For `google`, the connection needs a Google Web client: give the user the returned `steps` with `packageName`, `debugSha1`, and `redirectUri`, wait for them to create the Android and Web clients in Google Cloud, then pass `--google-client-id` and `--google-client-secret-file <path>` pointing at the Web client's JSON download or a file holding the secret. Never pass the secret as a command argument, read it into chat, or commit it.
- **`link.flag: "--relink"`:** explain the reported change and scope and offer to keep the current application. If the starter hasn't written a project yet, also offer a location outside the repository. Add `--relink` only after explicit agreement to that link change. Reuse approval for the same switch and scope; choosing another application alone isn't approval.
- **`selection-required`:** the project has several application modules. Select the intended one from the returned choices, asking only if ambiguous, and pass it with `--android-module` on later `init` and `doctor` commands.
- **`manual-setup-required`:** the module's layout isn't one the CLI edits (for example product flavors or a computed `applicationId`). The application is linked, but don't read the reported `envFile`. Get the selected application's development instance Publishable Key from `npx -y clerk@latest apps list --json`, matching its exact application ID. If it isn't available there, ask the user to complete the key step in the manual SDK guide above. Follow that guide with the returned `reason` and `next`; don't restructure the project to fit the CLI. If `--sign-in-with-google` was requested, this fallback hasn't configured Google: follow the manual steps in the [Android Sign in with Google guide](https://clerk.com/docs/android/guides/configure/auth-strategies/sign-in-with-google.md) for the selected application, and report any unfinished Clerk connection or Google Cloud client steps. After manual integration, identify the application's Gradle project path; if the CLI found no application module or the path is ambiguous, ask the user for it (for example `:app`). Run that module's `assembleDebug` task through the project's Gradle wrapper. Apply the build prerequisites and failure handling in step 5.
- **`setup-interrupted`:** a new project was written but setup stopped. Report progress and resolve the error without overwriting user edits or bypassing unsupported settings.
- **Nonzero exit with an error code** such as `android_setup_blocked`: setup refused a change on an existing project and wrote nothing past the reported step. Explain the error to the user. A Kotlin Gradle plugin older than 2.3, or AGP's built-in Kotlin with none declared, is one such stop: agree on the toolchain change before making it, then rerun the same command.

If `starter.projectDir` is present, the project was written: follow `starter.continuation` instead of repeating `--starter`, substituting the selected application ID and applying newly resolved inputs. Preserve its setup flags and directory change, and run returned commands through `npx -y clerk@latest` with `--mode agent`. If nothing was written, retry the original command with the resolved inputs. If the run stops without recovery data, inspect the destination and application list before retrying; don't assume nothing was created.

When the result includes a `handoff`, continue below.

## 4. Finish the Kotlin integration

For a new project, use the returned `starter.projectDir` as the working directory for every command in steps 4–5, including `doctor` and the build; don't assume the continuation's `cd` persists between commands.

Read `handoff.completed`, `handoff.remaining`, and `handoff.tasks`. Fetch documentation linked by pending source tasks before editing; use the manual SDK guide above if no links are supplied. Follow relevant sections and APIs compatible with the installed SDK. Don't read SDK source or call Clerk APIs directly. Preserve completed work, follow integration constraints, and explain remaining manual setup.

The `google-cloud-oauth-clients` task has status `requires-user-action`: it is the user's to complete in Google Cloud, so relay its exact steps and values and don't try to complete it yourself. A `native-registration` remaining item means the registration needs a fingerprint added in the Clerk Dashboard's Native applications page; relay it the same way. A `google-provider-review` item means Google is enabled on the instance without a Web client, so the SDK's Google button would fail silently; tell the user and offer to run setup again with `--sign-in-with-google`.

Without prebuilt UI, don't build a custom sign-in flow unless requested. Link the [custom flow guide](https://clerk.com/docs/android/guides/development/custom-flows/overview.md) in the final report and offer to build one. If native Sign in with Google was enabled, also link its [guide](https://clerk.com/docs/android/guides/configure/auth-strategies/sign-in-with-google.md).

## 5. Check setup and stop

Run with the same `--android-*` selectors:

```bash
npx -y clerk@latest doctor --json
```

Doctor checks project and Clerk settings, not custom Kotlin integration; native setup doesn't support `--fix`. Ignore unrelated warnings such as shell completion. The Google Cloud Android client check never passes: it's a reminder of what only the user can verify. Don't change instance settings to clear warnings unless the user requested that setup.

Run the `build-module` task's command from the handoff, which is the module's `assembleDebug` through the project's Gradle wrapper. If the Android SDK or a JDK 17 or later isn't available, report that and stop. Fix errors caused by your integration changes and retry; report environment or unrelated build failures and stop.

Stop after the build, unless the user already requested a custom flow. Launching, sign-in/sign-out/relaunch tests, test-user creation, and emulator troubleshooting require an explicit request. Report completed setup, the result's `identity` (package name, registered fingerprints and their sources, and the debug SHA-1 when Google was requested), source edits, build result, and unresolved requirements, including Google Cloud clients the user still needs to create. "Setup complete; sign-in not tested" is valid: `appIntegrationComplete: false` means the CLI hasn't verified app behavior, not that you must keep testing.
