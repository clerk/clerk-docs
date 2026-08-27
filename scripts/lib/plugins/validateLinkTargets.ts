// Enforces where markdown links may carry the `{{ target: '_blank' }}` MDX
// annotation. The site's MDXLink component automatically opens external http(s)
// links in a new tab (with the external-link icon) when no target is provided,
// and never auto-opens internal links. So:
//
//   1. Internal links (/docs/..., other root-relative paths, in-page #hashes,
//      !tooltips) must NOT carry an explicit target — it wrongly forces a new tab.
//   2. The one exception: API reference links
//      (/docs/reference/{frontend,backend,platform}-api...) are internal but
//      should open in a new tab, so they MUST carry the explicit annotation.
//   3. External http(s) links must NOT carry it — MDXLink already applies it.
//
// A trailing `{{ ... }}` annotation is not part of the mdast link node: remark-mdx
// parses it as an `mdxTextExpression` sibling immediately after the link, and the
// site's mdx-annotations plugin later merges it into the preceding sibling's props.
// Only the no-space form binds to the link (a space-separated trailing expression
// attaches to the whole paragraph instead), so this plugin checks each link node
// together with its immediate next sibling.

import { toString } from 'mdast-util-to-string'
import { Node } from 'unist'
import { visit as mdastVisit } from 'unist-util-visit'
import type { VFile } from 'vfile'
import { type BuildConfig } from '../config'
import { safeError, type WarningsSection } from '../error-messages'

// API reference links live under /docs/reference/{frontend,backend,platform}-api,
// either exactly or followed by a sub-path, hash, or query.
const API_REFERENCE_REGEX = /^\/docs\/reference\/(frontend|backend|platform)-api(?=[/#?]|$)/

const EXTERNAL_REGEX = /^https?:\/\//

// Matches a `target: '_blank'` property in an annotation's source text, in any
// quote style. Fallback only, for expressions remark-mdx attached no estree to —
// the parsed check below is authoritative.
const TARGET_BLANK_REGEX = /\btarget\s*:\s*(['"`])_blank\1/

// Whether an annotation expression sets `target: '_blank'`. Inspects the estree
// remark-mdx attaches to the expression (the same way update-algolia-records'
// extractHeadingId reads `id`), so target-like text inside another property's
// string value (eg `{{ id: "target: '_blank'" }}`) can't sway the check either
// way. Annotation values are static literals (enforced by check-annotations.mjs).
const annotationSetsTargetBlank = (annotation: Node): boolean => {
  const estreeBody = (annotation as any).data?.estree?.body
  if (Array.isArray(estreeBody)) {
    const expressionStatement = estreeBody.find((child: any) => child?.type === 'ExpressionStatement')
    const targetProp = expressionStatement?.expression?.properties?.find(
      (prop: any) => prop?.type === 'Property' && !prop.computed && (prop.key?.name ?? prop.key?.value) === 'target',
    )

    if (targetProp === undefined) return false
    if (targetProp.value?.type === 'Literal') return targetProp.value.value === '_blank'
    if (targetProp.value?.type === 'TemplateLiteral' && targetProp.value.expressions?.length === 0) {
      return targetProp.value.quasis?.[0]?.value?.cooked === '_blank'
    }
    return false
  }

  return 'value' in annotation && typeof annotation.value === 'string' && TARGET_BLANK_REGEX.test(annotation.value)
}

export const validateLinkTargets =
  (config: BuildConfig, filePath: string, section: WarningsSection) => () => (tree: Node, vfile: VFile) => {
    // Reference-style links carry only an identifier, so map each definition's
    // identifier to its URL up front to resolve those links' real destination.
    const definitionUrls = new Map<string, string>()
    mdastVisit(
      tree,
      (node) => node.type === 'definition',
      (node) => {
        if (
          'identifier' in node &&
          typeof node.identifier === 'string' &&
          'url' in node &&
          typeof node.url === 'string'
        ) {
          definitionUrls.set(node.identifier, node.url)
        }
      },
    )

    const resolveUrl = (node: Node): string => {
      if ('url' in node && typeof node.url === 'string') return node.url
      if ('identifier' in node && typeof node.identifier === 'string') return definitionUrls.get(node.identifier) ?? ''
      return ''
    }

    mdastVisit(
      tree,
      // Both inline links ([text](url)) and reference-style links ([text][ref])
      // can carry a trailing annotation, so check both node types.
      (node) => node.type === 'link' || node.type === 'linkReference',
      (node, index, parent) => {
        const url = resolveUrl(node)

        if (url === '') return

        // The link's annotation, if any, is the mdxTextExpression immediately
        // following it — mdx-annotations merges that expression into the link's
        // props at render time.
        const nextSibling =
          parent !== undefined && 'children' in parent && typeof index === 'number'
            ? (parent.children as Node[])[index + 1]
            : undefined
        const hasTargetBlank =
          nextSibling !== undefined &&
          nextSibling.type === 'mdxTextExpression' &&
          annotationSetsTargetBlank(nextSibling)

        const anchorText = toString(node)

        if (EXTERNAL_REGEX.test(url)) {
          if (hasTargetBlank) {
            safeError(
              config,
              vfile,
              filePath,
              section,
              'link-external-explicit-target',
              [anchorText, url],
              node.position,
            )
          }
        } else if (API_REFERENCE_REGEX.test(url)) {
          if (!hasTargetBlank) {
            safeError(
              config,
              vfile,
              filePath,
              section,
              'link-api-reference-missing-target',
              [anchorText, url],
              node.position,
            )
          }
        } else if (hasTargetBlank) {
          safeError(config, vfile, filePath, section, 'link-internal-explicit-target', [anchorText, url], node.position)
        }
      },
    )
  }
