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

import { slugifyWithCounter } from '@sindresorhus/slugify'
import { toString } from 'mdast-util-to-string'
import { remark } from 'remark'
import remarkFrontmatter from 'remark-frontmatter'
import remarkMdx from 'remark-mdx'
import { Node } from 'unist'
import { visit as mdastVisit } from 'unist-util-visit'
import { type BuildConfig } from './config'
import { errorMessages, safeFail, safeMessage, type WarningsSection } from './error-messages'
import { type DocsFile, readMarkdownFile } from './io'
import { checkPartials } from './plugins/checkPartials'
import { checkTypedoc } from './plugins/checkTypedoc'
import { extractFrontmatter, type Frontmatter } from './plugins/extractFrontmatter'
import { documentHasIfComponents } from './utils/documentHasIfComponents'
import { extractHeadingFromHeadingNode } from './utils/extractHeadingFromHeadingNode'
import { Prompt, checkPrompts } from './prompts'

export const parseInMarkdownFile =
  (config: BuildConfig) =>
  async (
    file: DocsFile & { content?: string },
    partials: { path: string; content: string; node: Node }[],
    typedocs: { path: string; content: string; node: Node }[],
    prompts: Prompt[],
    inManifest: boolean,
    section: WarningsSection,
  ) => {
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

    const vfile = await remark()
      .use(remarkFrontmatter)
      .use(remarkMdx)
      .use(() => (tree, vfile) => {
        node = tree

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
      .use(checkPartials(config, partials, file, { reportWarnings: true, embed: false }))
      .use(checkTypedoc(config, typedocs, file.filePath, { reportWarnings: true, embed: false }))
      .use(checkPrompts(config, prompts, file, { reportWarnings: true, update: false }))
      .process({
        path: file.relativeFilePath,
        value: fileContent,
      })

    // This needs to be done separately as some further validation expects the partials to not be embedded
    // but we need to embed it to get all the headings to check
    await remark()
      .use(remarkFrontmatter)
      .use(remarkMdx)
      .use(checkPartials(config, partials, file, { reportWarnings: false, embed: true }))
      .use(checkTypedoc(config, typedocs, file.filePath, { reportWarnings: false, embed: true }))
      // extract out the headings to check hashes in links
      .use(() => (tree, vfile) => {
        const documentContainsIfComponent = documentHasIfComponents(tree)

        mdastVisit(
          tree,
          (node) => node.type === 'heading',
          (node) => {
            const id = extractHeadingFromHeadingNode(node)

            if (id !== undefined) {
              if (documentContainsIfComponent === false && headingsHashes.has(id)) {
                safeFail(config, vfile, file.filePath, section, 'duplicate-heading-id', [file.href, id])
              }

              headingsHashes.add(id)
            } else {
              const slug = slugify(toString(node).trim())

              if (documentContainsIfComponent === false && headingsHashes.has(slug)) {
                safeFail(config, vfile, file.filePath, section, 'duplicate-heading-id', [file.href, slug])
              }

              headingsHashes.add(slug)
            }
          },
        )
      })
      .process({
        path: file.relativeFilePath,
        value: fileContent,
      })

    if (node === undefined) {
      throw new Error(errorMessages['doc-parse-failed'](file.href))
    }

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
    }
  }
