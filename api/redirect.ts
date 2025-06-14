import type { VercelRequest, VercelResponse } from '@vercel/node'

export const config = {
  runtime: 'edge',
}

export default function handler(request: VercelRequest, response: VercelResponse) {
  const branchUrl = process.env.VERCEL_BRANCH_URL

  if (!branchUrl) {
    return response.status(404).json({ error: 'Not found' })
  }

  const slug = branchUrl.replace('clerk-docs-git-', '').replace('.clerkstage.dev', '')

  return response.redirect(308, `https://clerk.com/docs/pr/${slug}`)
}
