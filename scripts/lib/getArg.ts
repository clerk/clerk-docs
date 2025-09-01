export function getArg(name: string, takesInput: true): string | null
export function getArg(name: string, takesInput: false): boolean
export function getArg(name: string, takesInput: boolean): string | null | boolean {
  const args = process.argv.slice(2)

  const flag = `--${name}`

  if (!args.includes(flag)) {
    if (takesInput) {
      return null
    }
    return false
  }

  const index = args.indexOf(flag)

  if (takesInput) {
    const nextItem = args[index + 1]

    if (nextItem === undefined) {
      throw new Error(`Flag ${flag} requires an input, but got no input`)
    }

    if (nextItem.startsWith('-')) {
      throw new Error(`Flag ${flag} requires an input, but got ${nextItem}`)
    }

    return nextItem
  }

  return true
}
