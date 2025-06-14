export const config = {
  runtime: 'edge',
}

export default function handler(request: Request): Response {
  const branchUrl = process.env.VERCEL_BRANCH_URL

  if (!branchUrl) {
    return new Response('Not found', { status: 404 })
  }

  const slug = branchUrl.replace('clerk-docs-git-', '').replace('.clerkstage.dev', '')

  return Response.redirect(`https://clerk.com/docs/pr/${slug}`, 308)
}
