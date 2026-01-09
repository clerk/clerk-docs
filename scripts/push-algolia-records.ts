import type { PushTaskRecords } from 'algoliasearch'
import fs from 'node:fs'

import { algoliasearch } from 'algoliasearch'

const MAX_CHUNK_SIZE = 4.5 * 1024 * 1024 // 4.9MB in bytes

function chunkRecords(records: PushTaskRecords[]): PushTaskRecords[][] {
  const chunks: PushTaskRecords[][] = []
  let currentChunk: PushTaskRecords[] = []
  let currentSize = 0

  for (const record of records) {
    const recordSize = Buffer.byteLength(JSON.stringify(record), 'utf8')

    if (currentSize + recordSize > MAX_CHUNK_SIZE && currentChunk.length > 0) {
      chunks.push(currentChunk)
      currentChunk = []
      currentSize = 0
    }

    currentChunk.push(record)
    currentSize += recordSize
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk)
  }

  return chunks
}

// use the region matching your applicationID
// const client = algoliasearch('P5U1EX6QM6', 'fa5f6039577ae27d97558fb3499cce45').initIngestion({ region: 'us' })
const client = algoliasearch('P5U1EX6QM6', 'fa5f6039577ae27d97558fb3499cce45').initIngestion({ region: 'eu' })

try {
  //   const authentication = await client.createAuthentication({
  //     name: 'Test Authentication',
  //     type: 'algolia',
  //     input: {
  //       appID: 'P5U1EX6QM6',
  //       apiKey: 'fa5f6039577ae27d97558fb3499cce45',
  //     },
  //   })

  //   const source = await client.createSource({
  //     name: 'Test Source',
  //     type: 'push',
  //     authenticationID: authentication.authenticationID,
  //   })
  //   console.log('Source created:', source)

  //   const destination = await client.createDestination({
  //     name: 'Test Destination',
  //     type: 'search',
  //     authenticationID: authentication.authenticationID,
  //     input: {
  //       indexName: 'test-docs-2',
  //     },
  //   })
  //   console.log('Destination created:', destination)

  //   const task = await client.createTask({
  //     action: 'replace',
  //     sourceID: source.sourceID,
  //     destinationID: destination.destinationID,
  //   })
  //   console.log('Task created:', task)

  const records = JSON.parse(fs.readFileSync('./dist/_search/records.json', 'utf8')) as PushTaskRecords[]
  const chunks = chunkRecords(records)

  console.log(`Pushing ${records.length} records in ${chunks.length} chunks...`)

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]
    const chunkSize = Buffer.byteLength(JSON.stringify(chunk), 'utf8')
    console.log(
      `Pushing chunk ${i + 1}/${chunks.length} (${chunk.length} records, ${(chunkSize / 1024 / 1024).toFixed(2)}MB)...`,
    )

    const resp = await client.pushTask({
      //   taskID: task.taskID,
      taskID: 'ed95ccce-8fd0-4166-b858-14adc853ba16',
      pushTaskPayload: { action: 'updateObject', records: chunk },
      watch: true,
    })

    console.log(`Chunk ${i + 1} complete:`, resp)
  }

  console.log('All chunks pushed successfully!')
} catch (err) {
  console.error(JSON.stringify(err, null, 2))
}
