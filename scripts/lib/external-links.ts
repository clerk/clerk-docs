export type ExternalLink = `https://${string}` | `http://${string}`
export type ExternalLinks = Set<ExternalLink>

export const isExternalLink = (link: string): link is ExternalLink => {
  return link.startsWith('https://') || link.startsWith('http://')
}
