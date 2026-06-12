import slugify from '@sindresorhus/slugify'

const slugifyMemo = new Map<string, string>()

const memoizedSlugify = (string: string) => {
  let result = slugifyMemo.get(string)
  if (result === undefined) {
    result = slugify(string)
    slugifyMemo.set(string, result)
  }
  return result
}

export function slugifyWithCounter() {
  const occurrences = new Map<string, number>()

  const countable = (string: string) => {
    string = memoizedSlugify(string)

    if (!string) {
      return ''
    }

    const stringLower = string.toLowerCase()
    const numberless = occurrences.get(stringLower.replace(/(?:-\d+?)+?$/, '')) || 0
    const counter = occurrences.get(stringLower)
    occurrences.set(stringLower, typeof counter === 'number' ? counter + 1 : 1)
    const newCounter = occurrences.get(stringLower) || 2
    if (newCounter >= 2 || numberless > 2) {
      string = `${string}-${newCounter}`
    }

    return string
  }

  countable.reset = () => {
    occurrences.clear()
  }

  return countable
}
