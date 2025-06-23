
// eg npm run typedoc:link ../javascript/.typedoc/docs

import symlinkDir from 'symlink-dir'

const TYPEDOC_DIR = './clerk-typedoc'

const typedocFolderLocation = process.argv[2]

if (!typedocFolderLocation) {
  console.error('No typedoc folder location provided')
  process.exit(1)
}

await symlinkDir(typedocFolderLocation, TYPEDOC_DIR)
