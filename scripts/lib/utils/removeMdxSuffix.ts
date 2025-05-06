// removes the .mdx suffix from a file path if it exists

export const removeMdxSuffix = (filePath: string) => {
  if (filePath.includes('#')) {
    const [url, hash] = filePath.split('#')

    if (url.endsWith('.mdx')) {
      return url.slice(0, -4) + `#${hash}`
    }

    return url + `#${hash}`
  }

  if (filePath.endsWith('.mdx')) {
    return filePath.slice(0, -4)
  }

  return filePath
}
