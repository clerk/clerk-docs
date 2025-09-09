import fs from 'node:fs/promises'
import path from 'node:path'
import readdirp from 'readdirp'
import yaml from 'yaml'

type Operation = {
  pathKey: string
  method: string
  summary?: string
  description?: string
  tags?: string[]
  operationId: string
}

type Spec = Operation[]

const kebabCase = (str: string) => {
  return str.toLowerCase().replace(/^-/, '').replace(/\s+/g, '-')
}

const parseSpec = (specText: string): Spec => {
  const parsed = yaml.parse(specText) as {
    paths: Record<
      string,
      Record<string, { operationId: string; summary?: string; description?: string; tags?: string[] }>
    >
  }

  const operations: Spec = Object.keys(parsed.paths).flatMap((pathKey) => {
    const pathItem = parsed.paths[pathKey]
    return Object.keys(pathItem).map((method) => ({
      pathKey,
      method,
      ...pathItem[method],
    }))
  })

  return operations
}

const redirectFromRedoclyToScalar = (spec: Spec | null, basePath: string, currentUrl: string): string | null => {
  const url = new URL(currentUrl, 'http://example.com')
  const pathSplits = url.pathname.split('/')

  if (pathSplits[4] === undefined) return null

  const tagName = kebabCase(pathSplits[5])
  if (tagName === undefined) return null

  const isOperation = url.hash.startsWith('#operation/')
  if (!isOperation) return null

  const operationName = url.hash.split('#operation/')[1]?.split('!')[0]
  if (!operationName) return `${basePath}/tag/${tagName}`

  const operation = spec?.find((op) => op.operationId === operationName)
  if (!operation) {
    return `${basePath}/tag/${tagName}`
  }

  return `${basePath}/tag/${tagName}/${operation.method}${operation.pathKey}`
}

type CliOptions = {
  backendSpecPath?: string
  frontendSpecPath?: string
  specVersion?: `${number}-${number}-${number}`
  write: boolean
}

const parseArgs = (argv: string[]): CliOptions => {
  const opts: CliOptions = { write: true, specVersion: '2025-04-10' }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dry-run') opts.write = false
    else if (a.startsWith('--backend-spec=')) opts.backendSpecPath = a.split('=')[1]
    else if (a.startsWith('--frontend-spec=')) opts.frontendSpecPath = a.split('=')[1]
    else if (a.startsWith('--spec-version=')) opts.specVersion = a.split('=')[1] as CliOptions['specVersion']
  }
  return opts
}

const REFERENCE_URL_REGEX = /(\/docs\/reference\/(?:frontend|backend)-api\/tag\/[^\s)#\]}"']+)(#[^\s)\]}"']*)?/g

async function main() {
  const cwd = process.cwd()
  const docsDir = path.join(cwd, 'docs')
  const options = parseArgs(process.argv)

  async function loadOpenapiSpec(api: 'fapi' | 'bapi', version: `${number}-${number}-${number}`) {
    const response = await fetch(
      `https://raw.githubusercontent.com/clerk/openapi-specs/refs/heads/main/${api}/${version}.yml`,
      { cache: 'force-cache' as any },
    )

    if (!response.ok) {
      throw new Error('Failed to fetch OpenAPI spec from GitHub')
    }

    return await response.text()
  }

  let backendSpec: Spec | null = null
  let frontendSpec: Spec | null = null

  if (options.backendSpecPath || options.frontendSpecPath) {
    if (options.backendSpecPath) {
      backendSpec = parseSpec(await fs.readFile(path.resolve(options.backendSpecPath), 'utf8'))
    }
    if (options.frontendSpecPath) {
      frontendSpec = parseSpec(await fs.readFile(path.resolve(options.frontendSpecPath), 'utf8'))
    }
  } else if (options.specVersion) {
    const [fapiText, bapiText] = await Promise.all([
      loadOpenapiSpec('fapi', options.specVersion),
      loadOpenapiSpec('bapi', options.specVersion),
    ])
    frontendSpec = parseSpec(fapiText)
    backendSpec = parseSpec(bapiText)
  }

  const entries = await readdirp.promise(docsDir, { type: 'files', fileFilter: '*.mdx' })

  let totalFilesChanged = 0
  let totalLinksChanged = 0
  const manualReview: Array<{ file: string; line: number; url: string }> = []

  for (const entry of entries) {
    const absPath = path.join(docsDir, entry.path)
    const relPath = path.join('docs', entry.path)
    const original = await fs.readFile(absPath, 'utf8')

    let changed = original
    let fileLinksChanged = 0

    changed = changed.replace(
      REFERENCE_URL_REGEX,
      (match, baseAndPath, hashPart, offset: number, originalStr: string) => {
        try {
          // If there are extra parameters appended after the operation (e.g. !path=...&t=...), skip and report
          if (hashPart && hashPart.includes('!')) {
            const preceding = originalStr.slice(0, offset)
            const lineNumber = preceding.split(/\r?\n/).length
            manualReview.push({ file: relPath, line: lineNumber, url: match })
            return match
          }

          // Build a full currentUrl for the redirect logic
          const currentUrl = `${baseAndPath}${hashPart ?? ''}`

          // Determine basePath from the first 4 segments: /docs/reference/(frontend|backend)-api
          const url = new URL(currentUrl, 'http://example.com')
          const segments = url.pathname.split('/')
          const basePath = `/${segments.slice(1, 4).join('/')}`

          const which = segments[3] // frontend-api or backend-api
          const spec = which === 'backend-api' ? backendSpec : frontendSpec

          const redirectUrl = redirectFromRedoclyToScalar(spec, basePath, currentUrl)
          if (redirectUrl && redirectUrl !== match) {
            fileLinksChanged++
            return redirectUrl
          }
          return match
        } catch {
          return match
        }
      },
    )

    if (fileLinksChanged > 0) {
      totalFilesChanged++
      totalLinksChanged += fileLinksChanged
      if (options.write) {
        await fs.writeFile(absPath, changed, 'utf8')
      }
      console.log(`${relPath}: ${fileLinksChanged} link(s) ${options.write ? 'updated' : 'would update'}`)
    }
  }

  console.log(
    `\n${options.write ? 'Updated' : 'Would update'} ${totalLinksChanged} link(s) across ${totalFilesChanged} file(s).`,
  )
  if (!options.write) {
    console.log('Run again without --dry-run (and optionally --backend-spec=... --frontend-spec=...) to apply changes.')
  }

  if (manualReview.length > 0) {
    console.log(`\n${manualReview.length} link(s) require manual review (skipped due to special parameters):`)
    for (const item of manualReview) {
      console.log(`${item.file}:${item.line}: ${item.url}`)
    }
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
