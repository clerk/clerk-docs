// defining most of the error messages that may be thrown by the build script
// with some helper functions that check if the warning should be ignored

import type { VFile } from 'vfile'
import type { ValidationError } from 'zod-validation-error'
import type { BuildConfig } from './config'
import type { Position } from 'unist'
import type { SDK } from './schemas'

export const errorMessages = {
  // Manifest errors
  'manifest-parse-error': (error: ValidationError | Error): string => `Failed to parse manifest: ${error}`,

  // Component errors
  'component-no-props': (componentName: string): string => `<${componentName} /> component has no props`,
  'component-attributes-not-array': (componentName: string): string =>
    `<${componentName} /> node attributes is not an array (this is a bug with the build script, please report)`,
  'component-missing-attribute': (componentName: string, propName: string): string =>
    `<${componentName} /> component has no "${propName}" attribute`,
  'component-attribute-no-value': (componentName: string, propName: string): string =>
    `<${componentName} /> attribute "${propName}" has no value (this is a bug with the build script, please report)`,
  'component-attribute-unsupported-type': (componentName: string, propName: string): string =>
    `<${componentName} /> attribute "${propName}" has an unsupported value type`,

  // SDK errors
  'invalid-sdks-in-if': (invalidSDKs: string[]): string =>
    `sdks "${invalidSDKs.join('", "')}" in <If /> are not valid SDKs`,
  'invalid-sdk-in-if': (sdk: string): string => `sdk "${sdk}" in <If /> is not a valid SDK`,
  'invalid-sdk-in-frontmatter': (invalidSDKs: string[], validSdks: SDK[]): string =>
    `Invalid SDK ${JSON.stringify(invalidSDKs)}, the valid SDKs are ${JSON.stringify(validSdks)}`,
  'if-component-sdk-not-in-frontmatter': (sdk: SDK, docSdk: SDK[]): string =>
    `<If /> component is attempting to filter to sdk "${sdk}" but it is not available in the docs frontmatter ["${docSdk.join('", "')}"], if this is a mistake please remove it from the <If /> otherwise update the frontmatter to include "${sdk}"`,
  'if-component-sdk-not-in-manifest': (sdk: SDK, href: string): string =>
    `<If /> component is attempting to filter to sdk "${sdk}" but it is not available in the manifest.json for ${href}, if this is a mistake please remove it from the <If /> otherwise update the manifest.json to include "${sdk}"`,
  'if-component-sdk-and-not-sdk-props-cannot-be-used-together': (): string =>
    `Cannot pass both "sdk" and "notSdk" props to <If /> component, you must choose one or the other.`,
  'doc-sdk-filtered-by-parent': (title: string, docSDK: SDK[], parentSDK: SDK[]): string =>
    `Doc "${title}" is attempting to use ${JSON.stringify(docSDK)} But its being filtered down to ${JSON.stringify(parentSDK)} in the manifest.json`,
  'group-sdk-filtered-by-parent': (title: string, groupSDK: SDK[], parentSDK: SDK[]): string =>
    `Group "${title}" is attempting to use ${JSON.stringify(groupSDK)} But its being filtered down to ${JSON.stringify(parentSDK)} in the manifest.json`,

  // Document structure errors
  'doc-not-in-manifest': (): string =>
    'This doc is not in the manifest.json, but will still be publicly accessible and other docs can link to it',
  'invalid-href-encoding': (href: string): string =>
    `Href "${href}" contains characters that will be encoded by the browser, please remove them`,
  'frontmatter-missing-title': (): string => 'Frontmatter must have a "title" property',
  'frontmatter-missing-description': (): string => 'Frontmatter should have a "description" property',
  'frontmatter-parse-failed': (href: string): string => `Frontmatter parsing failed for ${href}`,
  'doc-not-found': (title: string, href: string): string =>
    `Doc "${title}" in manifest.json not found in the docs folder at ${href}.mdx`,
  'doc-parse-failed': (href: string): string => `Doc "${href}" failed to parse`,
  'sdk-path-conflict': (href: string, path: string): string =>
    `Doc "${href}" is attempting to write out a doc to ${path} but the first part of the path is a valid SDK, this causes a file path conflict.`,
  'duplicate-heading-id': (href: string, id: string): string =>
    `Doc "${href}" contains a duplicate heading id "${id}", please ensure all heading ids are unique`,

  // Include component errors
  'include-src-not-partials': (): string =>
    `<Include /> prop "src" must start with "_partials/" (global) or "./_partials/" or "../_partials/" (relative)`,
  'partial-not-found': (src: string): string => `Partial /docs/${src}.mdx not found`,
  'partials-inside-partials': (): string =>
    'Partials inside of partials is not yet supported (this is a bug with the build script, please report)',

  // LLMPrompt component errors
  'src-not-in-prompts': (src: string): string => `<LLMPrompt /> prop "src" must start with "prompts/"`,
  'prompt-not-found': (src: string): string => `Prompt ${src} not found`,

  // Link validation errors
  'link-doc-not-found': (url: string, file: string): string =>
    `Matching file not found for path: ${url}. Expected file to exist at ${file}`,
  'link-hash-not-found': (hash: string, url: string): string => `Hash "${hash}" not found in ${url}`,
  'doc-link-must-start-with-a-slash': (url: string): string =>
    `Doc link must start with a slash (/docs/...). Fix url: ${url}`,

  // File reading errors
  'file-read-error': (filePath: string): string => `Failed to read in ${filePath}`,
  'partial-read-error': (path: string): string => `Failed to read in ${path} from partials file`,
  'markdown-read-error': (href: string): string => `Attempting to read in ${href}.mdx failed`,
  'partial-parse-error': (path: string): string => `Failed to parse the content of ${path}`,

  // Tooltip errors
  'tooltip-read-error': (path: string): string => `Failed to read in ${path} from tooltips file`,
  'tooltip-parse-error': (path: string): string => `Failed to parse the content of ${path}`,
  'tooltip-not-found': (src: string): string => `Tooltip ${src} not found`,

  // Typedoc errors
  'typedoc-folder-not-found': (path: string): string =>
    `Typedoc folder ${path} not found, run "npm run typedoc:download"`,
  'typedoc-read-error': (filePath: string): string => `Failed to read in ${filePath} from typedoc file`,
  'typedoc-parse-error': (filePath: string): string => `Failed to parse ${filePath} from typedoc file`,
  'typedoc-not-found': (filePath: string): string => `Typedoc ${filePath} not found`,
} as const

type WarningCode = keyof typeof errorMessages
export type WarningsSection = keyof BuildConfig['ignoreWarnings']

// Helper function to check if a warning should be ignored
export const shouldIgnoreWarning = (
  config: BuildConfig,
  filePath: string,
  section: WarningsSection,
  warningCode: WarningCode,
): boolean => {
  const replacements = {
    docs: (filePath: string) => filePath.replace(config.baseDocsLink, ''),
    typedoc: (filePath: string) => filePath.replace(config.typedocRelativePath + '/', ''),
    partials: (filePath: string) => filePath,
    tooltips: (filePath: string) =>
      config.tooltips ? filePath.replace(config.tooltips.inputPathRelative + '/', '') : filePath,
  }

  const relativeFilePath = replacements[section](filePath)
  const ignoreList = config.ignoreWarnings[section][relativeFilePath]

  if (!ignoreList) {
    return false
  }

  return ignoreList.includes(warningCode)
}

export const safeMessage = <TCode extends WarningCode, TArgs extends Parameters<(typeof errorMessages)[TCode]>>(
  config: BuildConfig,
  vfile: VFile,
  filePath: string,
  section: WarningsSection,
  warningCode: TCode,
  args: TArgs,
  position?: Position,
) => {
  if (!shouldIgnoreWarning(config, filePath, section, warningCode)) {
    // @ts-expect-error - TypeScript has trouble with spreading args into the function
    const message = errorMessages[warningCode](...args)
    vfile.message(message, position)
  }
}

export const safeFail = <TCode extends WarningCode, TArgs extends Parameters<(typeof errorMessages)[TCode]>>(
  config: BuildConfig,
  vfile: VFile,
  filePath: string,
  section: WarningsSection,
  warningCode: TCode,
  args: TArgs,
  position?: Position,
) => {
  if (!shouldIgnoreWarning(config, filePath, section, warningCode)) {
    // @ts-expect-error - TypeScript has trouble with spreading args into the function
    const message = errorMessages[warningCode](...args)
    vfile.fail(message, position)
  }
}
