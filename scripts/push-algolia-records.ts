import "dotenv/config";
import type { PushTaskRecords } from "algoliasearch";
import fs from "node:fs";

import { algoliasearch } from "algoliasearch";

const MAX_CHUNK_SIZE = 4.5 * 1024 * 1024; // 4.9MB in bytes

function chunkRecords(records: PushTaskRecords[]): PushTaskRecords[][] {
  const chunks: PushTaskRecords[][] = [];
  let currentChunk: PushTaskRecords[] = [];
  let currentSize = 0;

  for (const record of records) {
    const recordSize = Buffer.byteLength(JSON.stringify(record), "utf8");

    if (currentSize + recordSize > MAX_CHUNK_SIZE && currentChunk.length > 0) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentSize = 0;
    }

    currentChunk.push(record);
    currentSize += recordSize;
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  return chunks;
}

// use the region matching your applicationID
const client = algoliasearch(
  process.env.ALGOLIA_APP_ID!,
  process.env.ALGOLIA_API_KEY!
).initIngestion({ region: "eu" });

try {
  const records = JSON.parse(
    fs.readFileSync("./.output/search-records.json", "utf8")
  ) as PushTaskRecords[];
  const chunks = chunkRecords(records);

  console.log(
    `Pushing ${records.length} records in ${chunks.length} chunks...`
  );

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const chunkSize = Buffer.byteLength(JSON.stringify(chunk), "utf8");
    console.log(
      `Pushing chunk ${i + 1}/${chunks.length} (${chunk.length} records, ${(chunkSize / 1024 / 1024).toFixed(2)}MB)...`
    );

    const resp = await client.pushTask({
      taskID: "ed95ccce-8fd0-4166-b858-14adc853ba16",
      pushTaskPayload: { action: "updateObject", records: chunk },
      watch: true,
    });

    console.log(`Chunk ${i + 1} complete:`, resp);
  }

  console.log("All chunks pushed successfully!");
} catch (err) {
  console.error(JSON.stringify(err, null, 2));
}
