// responsible for reading in the markdown files and parsing them
// This is only for parsing in the main docs files, not the partials or typedocs
// - throws a warning if the doc is not in the manifest.json
// - throws a warning if the filename contains characters that will be encoded by the browser
// - extracts the frontmatter and validates it
//    - title is required, will fail
//    - description is required, will warn if missing
//    - sdk is optional, but if present must be a valid sdk
// - validates (but does not embed) the partials and typedocs
// - extracts the headings and validates that they are unique

import { isDeepStrictEqual } from 'node:util'
import { slugifyWithCounter } from './utils/slugify'
import { toString } from 'mdast-util-to-string'
import { remark } from 'remark'
import remarkFrontmatter from 'remark-frontmatter'
import remarkGfm from 'remark-gfm'
import remarkMdx from 'remark-mdx'
import type { Root } from 'mdast'
import { Node } from 'unist'
import { visit as mdastVisit } from 'unist-util-visit'
import { VFile } from 'vfile'
import { type BuildConfig } from './config'
import { errorMessages, safeFail, safeMessage, type WarningsSection } from './error-messages'
import { readMarkdownFile, type DocsFile } from './io'
import { checkPartials } from './plugins/checkPartials'
import { checkTypedoc } from './plugins/checkTypedoc'
import { extractFrontmatter, type Frontmatter } from './plugins/extractFrontmatter'
import { Prompt, checkPrompts } from './prompts'
import type { SDK } from './schemas'
import { markDocumentDirty, type Store } from './store'
import { documentHasIfComponents } from './utils/documentHasIfComponents'
import { extractHeadingFromHeadingNode } from './utils/extractHeadingFromHeadingNode'
import { checkTooltips } from './plugins/checkTooltips'

const calloutRegex = new RegExp(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION|QUIZ)(\s+[0-9a-z-]+)?\]$/)

export const parseInMarkdownFile =
  (config: BuildConfig, store: Store) =>
  async (
    file: DocsFile & { content?: string },
    partials: { path: string; content: string; node: Node }[],
    tooltips: { path: string; content: string; node: Node }[],
    typedocs: { path: string; content: string; node: Node }[],
    prompts: Prompt[],
    inManifest: boolean,
    section: WarningsSection,
  ) => {
    const markDirty = markDocumentDirty(store)
    const [error, fileContent] = file.content ? [null, file.content] : await readMarkdownFile(file.fullFilePath)

    if (error !== null) {
      throw new Error(errorMessages['markdown-read-error'](file.href), {
        cause: error,
      })
    }

    let frontmatter: Frontmatter | undefined = undefined

    const slugify = slugifyWithCounter()
    const headingsHashes = new Set<string>()
    let node: Node | undefined = undefined
    let nodeSnapshot: Node | undefined = undefined
    let finalNode: Node | undefined = undefined

    const vfile = await remark()
      .use(remarkFrontmatter)
      .use(remarkMdx)
      .use(remarkGfm)
      .use(() => (tree, vfile) => {
        node = tree
        // Snapshot the freshly-parsed tree before any validation plugin runs so
        // we can assert below that the embed:false plugins leave it untouched.
        nodeSnapshot = structuredClone(tree)

        if (inManifest === false) {
          safeMessage(config, vfile, file.filePath, section, 'doc-not-in-manifest', [])
        }

        if (file.href !== encodeURI(file.href)) {
          safeFail(config, vfile, file.filePath, section, 'invalid-href-encoding', [file.href])
        }
      })
      .use(
        extractFrontmatter(config, file.href, file.filePath, section, (fm) => {
          frontmatter = fm
        }),
      )
      .use(
        checkPartials(config, partials, file, { reportWarnings: true, embed: false }, (partial) => {
          markDirty(file.filePath, partial)
        }),
      )
      .use(
        checkTooltips(config, tooltips, file, { reportWarnings: true, embed: false }, (tooltip) => {
          markDirty(file.filePath, tooltip)
        }),
      )
      .use(
        checkTypedoc(config, typedocs, file.filePath, { reportWarnings: true, embed: false }, (typedoc) => {
          markDirty(file.filePath, typedoc)
        }),
      )
      .use(checkPrompts(config, prompts, file, { reportWarnings: true, update: false, embed: false }))
      // Capture the tree the pipeline ends with. A transformer can change the
      // tree two ways: mutate the original in place (caught via `node` below) or
      // return a new root that unified swaps in for later plugins (caught via
      // `finalNode` here). `node` still points at the original in the latter
      // case, so without this we'd miss a plugin that diverges the validated
      // tree from what `doc.node` reuses.
      .use(() => (tree) => {
        finalNode = tree
      })
      .process({
        path: file.relativeFilePath,
        value: fileContent,
      })

    if (node === undefined) {
      throw new Error(errorMessages['doc-parse-failed'](file.href))
    }

    // `node` (exposed as doc.node) is reused downstream via structuredClone(...)
    // instead of re-parsing fileContent — in build-docs.ts at the pass-1 SDK
    // output run and the pass-2 heading run, and in the embedProcessor below.
    // That substitution is only equivalent while the embed:false validation
    // plugins above leave the parsed tree structurally identical to a fresh
    // parse. They do today (read-only visits / non-mutating mdastMap), but guard
    // the invariant so a future tree-mutating plugin fails loudly here rather
    // than silently diverging the generated output.
    //
    // A plugin can diverge the tree two ways, so check both:
    //   1. `node` — the original reference we expose as doc.node. Catches a
    //      plugin that mutates the parsed tree in place.
    //   2. `finalNode` — the tree the pipeline actually ended with. Catches a
    //      plugin that returns a new root (e.g. mdastMap); unified hands that to
    //      later plugins, but `node` still points at the untouched original, so
    //      it would otherwise pass while doc.node is stale vs what was validated.
    //
    // Compare structuredClone(...) against the snapshot (also a structuredClone)
    // rather than the nodes directly: structuredClone drops class prototypes (e.g.
    // the acorn `Node` instances MDX attaches as data.estree on expression
    // attributes), so normalizing both sides the same way makes the check
    // sensitive to value mutations instead of flagging those benign prototype
    // differences.
    const treeMutationError = () =>
      new Error(
        `A validation plugin mutated the parsed tree for ${file.href}. ` +
          `doc.node is reused (via structuredClone) instead of being re-parsed, so the build now ` +
          `assumes the embed:false validation pass is non-mutating. Either make the offending plugin ` +
          `non-mutating, or re-parse fileContent at the reuse sites instead of cloning doc.node.`,
      )

    if (!isDeepStrictEqual(structuredClone(node), nodeSnapshot)) {
      throw treeMutationError()
    }

    if (!isDeepStrictEqual(structuredClone(finalNode), nodeSnapshot)) {
      throw treeMutationError()
    }

    // This needs to be done separately as some further validation expects the partials to not be embedded
    // but we need to embed it to get all the headings to check
    const embedProcessor = remark()
      .use(remarkFrontmatter)
      .use(remarkMdx)
      .use(remarkGfm)
      .use(checkPartials(config, partials, file, { reportWarnings: false, embed: true }))
      .use(checkTypedoc(config, typedocs, file.filePath, { reportWarnings: false, embed: true }))
      .use(checkTooltips(config, tooltips, file, { reportWarnings: false, embed: true }))
      // extract out the headings to check hashes in links
      .use(() => (tree) => {
        const documentContainsIfComponent = documentHasIfComponents(tree)

        mdastVisit(
          tree,
          (node) => {
            if (node.type !== 'text') return false
            if (!('value' in node)) return false
            if (typeof node.value !== 'string') return false
            const lines = node.value.split('\n')
            const callout = lines[0]
            return calloutRegex.test(callout)
          },
          (node) => {
            const callout = calloutRegex.exec((node as any).value.split('\n')[0].trim())

            if (callout === null) {
              throw new Error(`Invalid callout: ${node}`)
            }

            const id = callout[2]?.trim()

            if (id !== undefined) {
              if (documentContainsIfComponent === false && headingsHashes.has(id)) {
                safeMessage(config, vfile, file.filePath, section, 'duplicate-heading-id', [file.href, id])
              }

              headingsHashes.add(id)
            }
          },
        )

        mdastVisit(
          tree,
          (node) => node.type === 'heading',
          (node) => {
            const id = extractHeadingFromHeadingNode(node)

            if (id !== undefined) {
              if (documentContainsIfComponent === false && headingsHashes.has(id)) {
                safeMessage(config, vfile, file.filePath, section, 'duplicate-heading-id', [file.href, id])
              }

              headingsHashes.add(id)
            } else {
              const slug = slugify(toString(node).trim())

              if (documentContainsIfComponent === false && headingsHashes.has(slug)) {
                safeMessage(config, vfile, file.filePath, section, 'duplicate-heading-id', [file.href, slug])
              }

              headingsHashes.add(slug)
            }
          },
        )
      })

    await embedProcessor.run(
      structuredClone(node) as Root,
      new VFile({ path: file.relativeFilePath, value: fileContent }),
    )

    if (frontmatter === undefined) {
      throw new Error(errorMessages['frontmatter-parse-failed'](file.href))
    }

    return {
      file,
      sdk: (frontmatter as Frontmatter).sdk,
      vfile,
      headingsHashes,
      frontmatter: frontmatter as Frontmatter,
      node: node as Node,
      fileContent,
      distinctSDKVariants: null as SDK[] | null,
    }
  }
