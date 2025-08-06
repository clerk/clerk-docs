module.exports = async ({ github, context, core }) => {
  const { owner, repo, number } = context.issue

  if (number === undefined) {
    core.setFailed('No issue number found')
    return
  }

  // Check if we've already commented on this PR
  const comments = await github.rest.issues.listComments({
    owner,
    repo,
    issue_number: number,
  })

  const botComment = comments.data.find(
    (comment) => comment.user.type === 'Bot' && comment.body.includes('TypeDoc files detected in this PR'),
  )

  if (botComment) {
    console.log('Comment already exists')
    return
  }

  await github.rest.issues.createComment({
    owner,
    repo,
    issue_number: number,
    body: `⚠️ **TypeDoc files detected in this PR**
  
  This PR modifies files in the 'clerk-typedoc/' folder. These files are **auto-generated** from the [clerk/javascript](https://github.com/clerk/javascript) repository and should not be edited directly.
  
  **To make changes to TypeDoc documentation:**
  
  1. 🔄 Make your changes in the appropriate files in the [clerk/javascript](https://github.com/clerk/javascript/blob/main/docs/CONTRIBUTING.md#authoring-typedoc-information) repository.
  2. 🚀 The TypeDoc documentation will be pulled through to this repository via a CI action.
  
  Thanks for contributing! 🙏`,
  })
}
