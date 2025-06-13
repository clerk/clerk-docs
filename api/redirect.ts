// import type { VercelRequest, VercelResponse } from '@vercel/node'

export default function handler(request: Request) {
  const branchUrl = process.env.VERCEL_BRANCH_URL

  if (!branchUrl) {
    // return response.status(404).json({ error: 'Not found' })
    return new Response('Not found', { status: 404 })
  }

  const slug = branchUrl.replace('clerk-docs-git-', '').replace('.clerkstage.dev', '')

  // return response.redirect(308, `https://clerk.com/docs/pr/${slug}`)
  return new Response(null, {
    status: 308,
    headers: {
      Location: `https://clerk.com/docs/pr/${slug}`,
    },
  })
}
