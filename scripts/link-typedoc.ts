// eg npm run typedoc:link ../javascript/.typedoc/docs

import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import symlinkDir from 'symlink-dir'

const TYPEDOC_DIR = './local-clerk-typedoc'

const main = async () => {
  const typedocFolderLocation = process.argv[2]

  if (!typedocFolderLocation) {
    throw new Error('No typedoc folder location provided')
  }

  if (existsSync(TYPEDOC_DIR)) {
    await rm(TYPEDOC_DIR, { recursive: true })
  }

  await symlinkDir(typedocFolderLocation, TYPEDOC_DIR)
}

main()
