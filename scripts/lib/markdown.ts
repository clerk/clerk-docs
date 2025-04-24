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
import yaml from 'yaml'
import { type BuildConfig } from './config'
import { errorMessages, safeFail, safeMessage, type WarningsSection } from './error-messages'
import { readMarkdownFile } from './io'
import { isValidSdk, isValidSdks, type SDK } from './schemas'
import { documentHasIfComponents } from './utils/documentHasIfComponents'
import { extractHeadingFromHeadingNode } from './utils/extractHeadingFromHeadingNode'
import { checkPartials } from './validators/checkPartials'
import { checkTypedoc } from './validators/checkTypedoc'

export const parseInMarkdownFile =
  (config: BuildConfig) =>
  async (
    href: string,
    partials: { path: string; content: string; node: Node }[],
    typedocs: { path: string; content: string; node: Node }[],
    inManifest: boolean,
    section: WarningsSection,
  ) => {
    const readFile = readMarkdownFile(config)
    const validateSDKs = isValidSdks(config)
    const [error, fileContent] = await readFile(`${href}.mdx`.replace(config.baseDocsLink, ''))

    if (error !== null) {
      throw new Error(errorMessages['markdown-read-error'](href), {
        cause: error,
      })
    }

    type Frontmatter = {
      title: string
      description?: string
      sdk?: SDK[]
    }

    let frontmatter: Frontmatter | undefined = undefined

    const slugify = slugifyWithCounter()
    const headingsHashes = new Set<string>()
    const filePath = `${href}.mdx`
    let node: Node | undefined = undefined

    const vfile = await remark()
      .use(remarkFrontmatter)
      .use(remarkMdx)
      .use(() => (tree, vfile) => {
        node = tree

        if (inManifest === false) {
          safeMessage(config, vfile, filePath, section, 'doc-not-in-manifest', [])
        }

        if (href !== encodeURI(href)) {
          safeFail(config, vfile, filePath, section, 'invalid-href-encoding', [href])
        }
      })
      // validate and extract out the frontmatter
      .use(() => (tree, vfile) => {
        mdastVisit(
          tree,
          (node) => node.type === 'yaml' && 'value' in node,
          (node) => {
            if (!('value' in node)) return
            if (typeof node.value !== 'string') return

            const frontmatterYaml: Record<'title' | 'description' | 'sdk', string | undefined> = yaml.parse(node.value)

            const frontmatterSDKs = frontmatterYaml.sdk?.split(', ')

            if (frontmatterSDKs !== undefined && validateSDKs(frontmatterSDKs) === false) {
              const invalidSDKs = frontmatterSDKs.filter((sdk) => isValidSdk(config)(sdk) === false)
              safeFail(
                config,
                vfile,
                filePath,
                section,
                'invalid-sdk-in-frontmatter',
                [invalidSDKs, config.validSdks as SDK[]],
                node.position,
              )
              return
            }

            if (frontmatterYaml.title === undefined) {
              safeFail(config, vfile, filePath, section, 'frontmatter-missing-title', [], node.position)
              return
            }

            if (frontmatterYaml.description === undefined) {
              safeMessage(config, vfile, filePath, section, 'frontmatter-missing-description', [], node.position)
            }

            frontmatter = {
              title: frontmatterYaml.title,
              description: frontmatterYaml.description,
              sdk: frontmatterSDKs,
            }
          },
        )

        if (frontmatter === undefined) {
          safeFail(config, vfile, filePath, section, 'frontmatter-parse-failed', [href])
          return
        }
      })
      .use(checkPartials(config, partials, filePath, { reportWarnings: true, embed: false }))
      .use(checkTypedoc(config, typedocs, filePath, { reportWarnings: true, embed: false }))
      .process({
        path: `${href.substring(1)}.mdx`,
        value: fileContent,
      })

    // This needs to be done separately as some further validation expects the partials to not be embedded
    // but we need to embed it to get all the headings to check
    await remark()
      .use(remarkFrontmatter)
      .use(remarkMdx)
      .use(checkPartials(config, partials, filePath, { reportWarnings: true, embed: true }))
      .use(checkTypedoc(config, typedocs, filePath, { reportWarnings: true, embed: true }))
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
                safeFail(config, vfile, filePath, section, 'duplicate-heading-id', [href, id])
              }

              headingsHashes.add(id)
            } else {
              const slug = slugify(toString(node).trim())

              if (documentContainsIfComponent === false && headingsHashes.has(slug)) {
                safeFail(config, vfile, filePath, section, 'duplicate-heading-id', [href, slug])
              }

              headingsHashes.add(slug)
            }
          },
        )
      })
      .process({
        path: `${href.substring(1)}.mdx`,
        value: fileContent,
      })

    if (node === undefined) {
      throw new Error(errorMessages['doc-parse-failed'](href))
    }

    if (frontmatter === undefined) {
      throw new Error(errorMessages['frontmatter-parse-failed'](href))
    }

    return {
      href,
      sdk: (frontmatter as Frontmatter).sdk,
      vfile,
      headingsHashes,
      frontmatter: frontmatter as Frontmatter,
      node: node as Node,
    }
  }
