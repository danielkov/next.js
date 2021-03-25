import { promises } from 'fs'
import { join } from 'path'

const readdirs = async (dirs: string[], ignore?: RegExp) => {
  const results = await Promise.all(
    dirs.map((dir) =>
      promises.readdir(dir).then((contents) => {
        return {
          base: dir,
          contents: contents.filter(
            (content) => !ignore || ignore.test(content)
          ),
        }
      })
    )
  )
  const unique = new Set<string>()
  results.forEach((result) => {
    result.contents = result.contents.filter((content) => {
      if (unique.has(content)) {
        return false
      }
      unique.add(content)
      return true
    })
  })
  return results
}

/**
 * Recursively read directory
 * @param  {string} dir Directory to read
 * @param  {RegExp} filter Filter for the file name, only the name part is considered, not the full path
 * @param  {string[]=[]} arr This doesn't have to be provided, it's used for the recursion
 * @param  {string=dir`} rootDir Used to replace the initial path, only the relative path is left, it's faster than path.relative.
 * @returns Promise array holding all relative paths
 */
export async function recursiveReadDir(
  dirs: string[],
  filter: RegExp,
  ignore?: RegExp,
  arr: string[] = [],
  rootDir: string = dirs[0]
): Promise<string[]> {
  const result = await readdirs(dirs, ignore)

  await Promise.all(
    result.map(async ({ base, contents }) => {
      await Promise.all(
        contents.map(async (content) => {
          const absolutePath = join(base, content)

          const pathStat = await promises.stat(absolutePath)

          if (pathStat.isDirectory()) {
            await recursiveReadDir([absolutePath], filter, ignore, arr, rootDir)
            return
          }

          if (!filter.test(content)) {
            return
          }

          arr.push(absolutePath.replace(base, ''))
        })
      )
    })
  )

  return arr.sort()
}
