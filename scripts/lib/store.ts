import type { parseInMarkdownFile } from './markdown'
import type { readPartial } from './partials'
import type { readTypedoc } from './typedoc'

type MarkdownFile = Awaited<ReturnType<ReturnType<typeof parseInMarkdownFile>>>
type PartialsFile = Awaited<ReturnType<ReturnType<typeof readPartial>>>
type TypedocsFile = Awaited<ReturnType<ReturnType<typeof readTypedoc>>>

export type DocsMap = Map<string, MarkdownFile>
export type PartialsMap = Map<string, PartialsFile>
export type TypedocsMap = Map<string, TypedocsFile>
