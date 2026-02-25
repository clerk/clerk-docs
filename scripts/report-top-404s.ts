const POSTHOG_PROJECT_ID = process.env.DOCS_404_POSTHOG_PROJECT_ID
const POSTHOG_INSIGHT_ID = process.env.DOCS_404_POSTHOG_INSIGHT_ID
const POSTHOG_API_KEY = process.env.DOCS_404_POSTHOG_API_KEY
const SLACK_BOT_TOKEN = process.env.DOCS_404_SLACK_BOT_TOKEN
const SLACK_CHANNEL = process.env.DOCS_404_SLACK_CHANNEL

const main = async () => {
  if (!POSTHOG_API_KEY || !POSTHOG_PROJECT_ID) {
    throw new Error('POSTHOG_API_KEY and POSTHOG_PROJECT_ID are required')
  }

  if (!SLACK_BOT_TOKEN || !SLACK_CHANNEL) {
    console.warn('SLACK_BOT_TOKEN and SLACK_CHANNEL are not set, skipping Slack notification')
  }

  const response = await fetch(`https://us.posthog.com/api/projects/${POSTHOG_PROJECT_ID}/query/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${POSTHOG_API_KEY}`,
    },
    body: JSON.stringify({
      query: {
        kind: 'TrendsQuery',
        series: [
          {
            event: 'page_not_found',
            kind: 'EventsNode',
            math: 'total',
            properties: [
              {
                key: 'pathname',
                operator: 'icontains',
                type: 'event',
                value: '/docs/',
              },
            ],
          },
        ],
        breakdownFilter: {
          breakdown_limit: 5,
          breakdown_type: 'event',
          breakdowns: [{ property: 'pathname', type: 'event' }],
        },
        dateRange: { date_from: '-7d' },
        filterTestAccounts: true,
        interval: 'day',
        trendsFilter: {
          display: 'ActionsTable',
        },
      },
    }),
  })

  if (!response.ok) {
    throw new Error(`PostHog API error: ${response.statusText}`)
  }

  const data = await response.json()

  const topFive404s = data.results.map((result: any) => result.label).slice(0, 5) as string[]
  const formattedList = topFive404s.map((path, i) => `${i + 1}. \`${path}\``).join('\n')

  console.log('Top 5 Docs 404s (Last 7 Days):\n' + formattedList)

  if (SLACK_BOT_TOKEN && SLACK_CHANNEL) {
    const slackMessage = {
      // A fallback message for environments the structured (blocks) message is not supported
      text: `Top 5 Docs 404s (Last 7 Days):\n${formattedList}`,
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: 'Top 5 Docs 404s (Last 7 Days)',
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: formattedList,
          },
        },
        ...(POSTHOG_INSIGHT_ID
          ? [
              {
                type: 'context',
                elements: [
                  {
                    type: 'mrkdwn',
                    text: `https://us.posthog.com/project/${POSTHOG_PROJECT_ID}/insights/${POSTHOG_INSIGHT_ID} | View all 404s of the week in PostHog`,
                  },
                ],
              },
            ]
          : []),
      ],
    }

    const slackResponse = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
      },
      body: JSON.stringify({
        channel: SLACK_CHANNEL,
        ...slackMessage,
      }),
    })

    if (!slackResponse.ok) {
      throw new Error(`Slack API error: ${slackResponse.statusText}`)
    }

    const slackData = await slackResponse.json()

    if (!slackData.ok) {
      throw new Error(`Slack API error: ${slackData.error}`)
    }

    console.log('Posted top 404s to Slack')
  }
}

main()
