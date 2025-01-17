import chalk from 'chalk'
import gzipSize from 'gzip-size'
import textTable from 'next/dist/compiled/text-table'
import path from 'path'
import { isValidElementType } from 'react-is'
import stripAnsi from 'strip-ansi'
import { Redirect, Rewrite } from '../lib/check-custom-routes'
import { SPR_GET_INITIAL_PROPS_CONFLICT } from '../lib/constants'
import prettyBytes from '../lib/pretty-bytes'
import { recursiveReadDir } from '../lib/recursive-readdir'
import { DEFAULT_REDIRECT_STATUS } from '../next-server/lib/constants'
import { getRouteMatcher, getRouteRegex } from '../next-server/lib/router/utils'
import { isDynamicRoute } from '../next-server/lib/router/utils/is-dynamic'
import { findPageFile } from '../server/lib/find-page-file'

const fileGzipStats: { [k: string]: Promise<number> } = {}
const fsStatGzip = (file: string) => {
  if (fileGzipStats[file]) return fileGzipStats[file]
  fileGzipStats[file] = gzipSize.file(file)
  return fileGzipStats[file]
}

export function collectPages(
  directory: string,
  pageExtensions: string[]
): Promise<string[]> {
  return recursiveReadDir(
    directory,
    new RegExp(`\\.(?:${pageExtensions.join('|')})$`)
  )
}

export interface PageInfo {
  isAmp?: boolean
  size: number
  static: boolean
  isSsg: boolean
  ssgPageRoutes: string[] | null
  serverBundle: string
}

export async function printTreeView(
  list: readonly string[],
  pageInfos: Map<string, PageInfo>,
  serverless: boolean,
  {
    distPath,
    pagesDir,
    pageExtensions,
    buildManifest,
    isModern,
  }: {
    distPath: string
    pagesDir: string
    pageExtensions: string[]
    buildManifest: BuildManifestShape
    isModern: boolean
  }
) {
  const getPrettySize = (_size: number): string => {
    const size = prettyBytes(_size)
    // green for 0-130kb
    if (_size < 130 * 1000) return chalk.green(size)
    // yellow for 130-170kb
    if (_size < 170 * 1000) return chalk.yellow(size)
    // red for >= 170kb
    return chalk.red.bold(size)
  }

  const messages: [string, string][] = [
    ['Page', 'Size'].map(entry => chalk.underline(entry)) as [string, string],
  ]

  const hasCustomApp = await findPageFile(pagesDir, '/_app', pageExtensions)
  const hasCustomError = await findPageFile(pagesDir, '/_error', pageExtensions)

  const pageList = list
    .slice()
    .filter(
      e =>
        !(
          e === '/_document' ||
          (!hasCustomApp && e === '/_app') ||
          (!hasCustomError && e === '/_error')
        )
    )
    .sort((a, b) => a.localeCompare(b))

  pageList.forEach((item, i, arr) => {
    const symbol =
      i === 0
        ? arr.length === 1
          ? '─'
          : '┌'
        : i === arr.length - 1
        ? '└'
        : '├'

    const pageInfo = pageInfos.get(item)

    messages.push([
      `${symbol} ${
        item === '/_app'
          ? ' '
          : pageInfo && pageInfo.static
          ? '○'
          : pageInfo && pageInfo.isSsg
          ? '●'
          : 'λ'
      } ${item}`,
      pageInfo
        ? pageInfo.isAmp
          ? chalk.cyan('AMP')
          : pageInfo.size >= 0
          ? getPrettySize(pageInfo.size)
          : ''
        : '',
    ])

    if (pageInfo && pageInfo.ssgPageRoutes && pageInfo.ssgPageRoutes.length) {
      const totalRoutes = pageInfo.ssgPageRoutes.length
      const previewPages = totalRoutes === 4 ? 4 : 3
      const contSymbol = i === arr.length - 1 ? ' ' : '├'

      const routes = pageInfo.ssgPageRoutes.slice(0, previewPages)
      if (totalRoutes > previewPages) {
        const remaining = totalRoutes - previewPages
        routes.push(`[+${remaining} more paths]`)
      }

      routes.forEach((slug, index, { length }) => {
        const innerSymbol = index === length - 1 ? '└' : '├'
        messages.push([`${contSymbol}   ${innerSymbol} ${slug}`, ''])
      })
    }
  })

  const sharedData = await getSharedSizes(distPath, buildManifest, isModern)

  messages.push(['+ shared by all', getPrettySize(sharedData.total)])
  Object.keys(sharedData.files)
    .sort()
    .forEach((fileName, index, { length }) => {
      const innerSymbol = index === length - 1 ? '└' : '├'
      messages.push([
        `  ${innerSymbol} ${fileName
          .replace(/^static\//, '')
          .replace(/[.-][0-9a-z]{20}(?=\.)/, '')}`,
        getPrettySize(sharedData.files[fileName]),
      ])
    })

  console.log(
    textTable(messages, {
      align: ['l', 'l'],
      stringLength: str => stripAnsi(str).length,
    })
  )

  console.log()
  console.log(
    textTable(
      [
        [
          'λ',
          serverless ? '(Lambda)' : '(Server)',
          `server-side renders at runtime (uses ${chalk.cyan(
            'getInitialProps'
          )} or ${chalk.cyan('getServerProps')})`,
        ],
        [
          '○',
          '(Static)',
          'automatically rendered as static HTML (uses no initial props)',
        ],
        [
          '●',
          '(SSG)',
          `automatically generated as static HTML + JSON (uses ${chalk.cyan(
            'getStaticProps'
          )})`,
        ],
      ] as [string, string, string][],
      {
        align: ['l', 'l', 'l'],
        stringLength: str => stripAnsi(str).length,
      }
    )
  )

  console.log()
}

export function printCustomRoutes({
  redirects,
  rewrites,
}: {
  redirects: Redirect[]
  rewrites: Rewrite[]
}) {
  const printRoutes = (
    routes: Redirect[] | Rewrite[],
    type: 'Redirects' | 'Rewrites'
  ) => {
    const isRedirects = type === 'Redirects'
    console.log(chalk.underline(type))
    console.log()

    console.log(
      textTable(
        [
          [
            'Source',
            'Destination',
            ...(isRedirects ? ['statusCode'] : []),
          ].map(str => chalk.bold(str)),
          ...Object.entries(routes).map(([key, route]) => {
            return [
              route.source,
              route.destination,
              ...(isRedirects
                ? [
                    ((route as Redirect).statusCode ||
                      DEFAULT_REDIRECT_STATUS) + '',
                  ]
                : []),
            ]
          }),
        ],
        {
          align: ['l', 'l', 'l'],
          stringLength: str => stripAnsi(str).length,
        }
      )
    )
    console.log()
  }

  if (redirects.length) {
    printRoutes(redirects, 'Redirects')
  }
  if (rewrites.length) {
    printRoutes(rewrites, 'Rewrites')
  }
}

type BuildManifestShape = { pages: { [k: string]: string[] } }
type ComputeManifestShape = {
  commonFiles: string[]
  sizeCommonFile: { [file: string]: number }
  sizeCommonFiles: number
}

let cachedBuildManifest: BuildManifestShape | undefined

let lastCompute: ComputeManifestShape | undefined
let lastComputeModern: boolean | undefined

async function computeFromManifest(
  manifest: BuildManifestShape,
  distPath: string,
  isModern: boolean
): Promise<ComputeManifestShape> {
  if (
    Object.is(cachedBuildManifest, manifest) &&
    lastComputeModern === isModern
  ) {
    return lastCompute!
  }

  let expected = 0
  const files = new Map<string, number>()
  Object.keys(manifest.pages).forEach(key => {
    if (key === '/_polyfills') {
      return
    }

    ++expected
    manifest.pages[key].forEach(file => {
      if (
        // Filter out CSS
        !file.endsWith('.js') ||
        // Select Modern or Legacy scripts
        file.endsWith('.module.js') !== isModern
      ) {
        return
      }

      if (files.has(file)) {
        files.set(file, files.get(file)! + 1)
      } else {
        files.set(file, 1)
      }
    })
  })

  const commonFiles = [...files.entries()]
    .filter(([, len]) => len === expected)
    .map(([f]) => f)

  let stats: [string, number][]
  try {
    stats = await Promise.all(
      commonFiles.map(
        async f =>
          [f, await fsStatGzip(path.join(distPath, f))] as [string, number]
      )
    )
  } catch (_) {
    stats = []
  }

  lastCompute = {
    commonFiles,
    sizeCommonFile: stats.reduce(
      (obj, n) => Object.assign(obj, { [n[0]]: n[1] }),
      {}
    ),
    sizeCommonFiles: stats.reduce((size, [, stat]) => size + stat, 0),
  }

  cachedBuildManifest = manifest
  lastComputeModern = isModern
  return lastCompute!
}

function difference<T>(main: T[], sub: T[]): T[] {
  const a = new Set(main)
  const b = new Set(sub)
  return [...a].filter(x => !b.has(x))
}

export async function getSharedSizes(
  distPath: string,
  buildManifest: BuildManifestShape,
  isModern: boolean
): Promise<{ total: number; files: { [page: string]: number } }> {
  const data = await computeFromManifest(buildManifest, distPath, isModern)
  return { total: data.sizeCommonFiles, files: data.sizeCommonFile }
}

export async function getPageSizeInKb(
  page: string,
  distPath: string,
  buildId: string,
  buildManifest: BuildManifestShape,
  isModern: boolean
): Promise<number> {
  const data = await computeFromManifest(buildManifest, distPath, isModern)
  const deps = difference(buildManifest.pages[page] || [], data.commonFiles)
    .filter(
      entry =>
        entry.endsWith('.js') && entry.endsWith('.module.js') === isModern
    )
    .map(dep => `${distPath}/${dep}`)

  const clientBundle = path.join(
    distPath,
    `static/${buildId}/pages/`,
    `${page}${isModern ? '.module' : ''}.js`
  )
  deps.push(clientBundle)

  try {
    let depStats = await Promise.all(deps.map(fsStatGzip))
    return depStats.reduce((size, stat) => size + stat, 0)
  } catch (_) {}
  return -1
}

export async function isPageStatic(
  page: string,
  serverBundle: string,
  runtimeEnvConfig: any
): Promise<{
  static?: boolean
  prerender?: boolean
  isHybridAmp?: boolean
  prerenderRoutes?: string[] | undefined
}> {
  try {
    require('../next-server/lib/runtime-config').setConfig(runtimeEnvConfig)
    const mod = require(serverBundle)
    const Comp = mod.default || mod

    if (!Comp || !isValidElementType(Comp) || typeof Comp === 'string') {
      throw new Error('INVALID_DEFAULT_EXPORT')
    }

    const hasGetInitialProps = !!(Comp as any).getInitialProps
    const hasStaticProps = !!mod.unstable_getStaticProps
    const hasStaticPaths = !!mod.unstable_getStaticPaths
    const hasLegacyStaticParams = !!mod.unstable_getStaticParams

    if (hasLegacyStaticParams) {
      throw new Error(
        `unstable_getStaticParams was replaced with unstable_getStaticPaths. Please update your code.`
      )
    }

    // A page cannot be prerendered _and_ define a data requirement. That's
    // contradictory!
    if (hasGetInitialProps && hasStaticProps) {
      throw new Error(SPR_GET_INITIAL_PROPS_CONFLICT)
    }

    // A page cannot have static parameters if it is not a dynamic page.
    if (hasStaticProps && hasStaticPaths && !isDynamicRoute(page)) {
      throw new Error(
        `unstable_getStaticPaths can only be used with dynamic pages. https://nextjs.org/docs#dynamic-routing`
      )
    }

    let prerenderPaths: string[] | undefined
    if (hasStaticProps && hasStaticPaths) {
      prerenderPaths = [] as string[]

      const _routeMatcher = getRouteMatcher(getRouteRegex(page))

      // Get the default list of allowed params.
      const _validParamKeys = Object.keys(_routeMatcher(page))

      const toPrerender: Array<
        { params?: { [key: string]: string } } | string
      > = await mod.unstable_getStaticPaths()
      toPrerender.forEach(entry => {
        // For a string-provided path, we must make sure it matches the dynamic
        // route.
        if (typeof entry === 'string') {
          const result = _routeMatcher(entry)
          if (!result) {
            throw new Error(
              `The provided path \`${entry}\` does not match the page: \`${page}\`.`
            )
          }

          prerenderPaths!.push(entry)
        }
        // For the object-provided path, we must make sure it specifies all
        // required keys.
        else {
          const invalidKeys = Object.keys(entry).filter(key => key !== 'params')
          if (invalidKeys.length) {
            throw new Error(
              `Additional keys were returned from \`unstable_getStaticPaths\` in page "${page}". ` +
                `URL Parameters intended for this dynamic route must be nested under the \`params\` key, i.e.:` +
                `\n\n\treturn { params: { ${_validParamKeys
                  .map(k => `${k}: ...`)
                  .join(', ')} } }` +
                `\n\nKeys that need moved: ${invalidKeys.join(', ')}.\n`
            )
          }

          const { params = {} } = entry
          let builtPage = page
          _validParamKeys.forEach(validParamKey => {
            if (typeof params[validParamKey] !== 'string') {
              throw new Error(
                `A required parameter (${validParamKey}) was not provided as a string.`
              )
            }

            builtPage = builtPage.replace(
              `[${validParamKey}]`,
              encodeURIComponent(params[validParamKey])
            )
          })

          prerenderPaths!.push(builtPage)
        }
      })
    }

    const config = mod.config || {}
    return {
      static: !hasStaticProps && !hasGetInitialProps,
      isHybridAmp: config.amp === 'hybrid',
      prerenderRoutes: prerenderPaths,
      prerender: hasStaticProps,
    }
  } catch (err) {
    if (err.code === 'MODULE_NOT_FOUND') return {}
    throw err
  }
}

export function hasCustomAppGetInitialProps(
  _appBundle: string,
  runtimeEnvConfig: any
): boolean {
  require('../next-server/lib/runtime-config').setConfig(runtimeEnvConfig)
  let mod = require(_appBundle)

  if (_appBundle.endsWith('_app.js')) {
    mod = mod.default || mod
  } else {
    // since we don't output _app in serverless mode get it from a page
    mod = mod._app
  }
  return mod.getInitialProps !== mod.origGetInitialProps
}
