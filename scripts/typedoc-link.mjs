import symlinkDir from 'symlink-dir'

await symlinkDir(process.argv[2], './clerk-typedoc')
