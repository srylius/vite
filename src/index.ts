import fs from 'fs'
import { AddressInfo } from 'net'
import { fileURLToPath } from 'url'
import path from 'path'
import colors from 'picocolors'
import { Plugin, loadEnv, UserConfig, ConfigEnv, ResolvedConfig, SSROptions, PluginOption } from 'vite'
import fullReload, { Config as FullReloadConfig } from 'vite-plugin-full-reload'
import { InputOption } from "rollup"

interface PluginConfig {
    /**
     * The path or paths of the entry points to compile.
     *
     * @type {InputOption}
     */
    input: InputOption

    /**
     * Publish directory for the Srylius framework.
     *
     * @type {string}
     */
    publicDirectory?: string

    /**
     * The public subdirectory where compiled assets should be written.
     *
     * @type {string}
     */
    buildDirectory?: string

    /**
     * The path to the "srylius.hot" file.
     *
     * @type {string}
     */
    hotFile?: string

    /**
     * The path of the SSR entry point.
     *
     * @type {InputOption}
     */
    ssr?: InputOption

    /**
     * The directory where the SSR bundle should be written.
     *
     * @type {string}
     */
    ssrOutputDirectory?: string

    /**
     * Configuration for performing full page refresh on levd (or other) file changes.
     *
     * @type {boolean|string|string[]|RefreshConfig|RefreshConfig[]}
     */
    refresh?: boolean|string|string[]|RefreshConfig|RefreshConfig[]

    /**
     * Detect tls certificates for local development server.
     *
     * @type {string|boolean|null}
     */
    detectTls?: string|boolean|null,

    /**
     * Transform the code while serving.
     *
     * @param {string} code
     * @param {DevServerUrl} url
     *
     * @return {string}
     */
    transformOnServe?: (code: string, url: DevServerUrl) => string,
}

interface RefreshConfig {
    /**
     * Directories where continuous changes will be monitored by vite.
     *
     * @type {string[]}
     */
    paths: string[],

    /**
     * Configuration for the watched paths.
     *
     * @type {FullReloadConfig}
     */
    config?: FullReloadConfig,
}

interface SryliusPlugin extends Plugin {
    /**
     * Modify vite config before it's resolved. The hook can either mutate
     * the passed-in config directly, or return a partial config object
     * that will be deeply merged into existing config.
     *
     * @param {UserConfig} config
     * @param {ConfigEnv} env
     *
     * @return {UserConfig}
     */
    config: (config: UserConfig, env: ConfigEnv) => UserConfig
}

/**
 * Development server url address.
 */
type DevServerUrl = `${'http'|'https'}://${string}:${number}`

/**
 * Development server exit handlers status.
 */
let exitHandlersBound = false

/**
 * Indexes to keep live for Srylius and Levdwire ecosystem.
 *
 * @type {string[]}
 */
export const refreshPaths: string[] = [
    'app/View/Pages/**',
    'app/View/Layouts/**',
    'app/View/Levdwire/**',
    'app/View/Components/**',
    'resources/languages/**',
    'resources/themes/**',
    'resources/plugins/**',
    'resources/views/**',
    'routes/**',
    'system/**',
].filter(path => fs.existsSync(path.replace(/\*\*$/, '')))

/**
 * Leverage the power of vite more easily when developing your web applications.
 *
 * @param {string|string[]|PluginConfig} config - A config object or relative path(s) of the scripts to be compiled.
 *
 * @return {[SryliusPlugin, ...Plugin[]]}
 */
export default function srylius(config: string|string[]|PluginConfig): [SryliusPlugin, ...Plugin[]]  {
    // Resolve plugin configuration settings.
    const pluginConfig = resolvePluginConfig(config)

    // Resolve the configuration options provided by the plugin.
    return [
        // Resolve vite srylius plugin settings without configuring them.
        resolveSryliusPlugin(pluginConfig),

        // Resolve vite refresh settings without configuring them.
        ...resolveReloadConfig(pluginConfig) as Plugin[],
    ];
}

/**
 * Resolve vite srylius plugin settings without configuring them.
 *
 * @param {Required<PluginConfig>} pluginConfig
 *
 * @return {SryliusPlugin}
 */
function resolveSryliusPlugin(pluginConfig: Required<PluginConfig>): SryliusPlugin {
    let viteDevServerUrl: DevServerUrl
    let resolvedConfig: ResolvedConfig
    let userConfig: UserConfig

    /**
     * Aliases that will be provided by default for Vite.
     *
     * @type {Record<string, string>}
     */
    const defaultAliases: Record<string, string> = {
        // Basically always include the alias as the assets are also located in the "resources/assets" directory.
        '@' : '/resources/assets',
    };

    return {
        // Define a name for the plugin.
        name    : 'srylius',

        // Enforce plugin invocation tier similar to webpack loaders.
        enforce : 'post',

        //
        config  : (config, { command, mode }) => {
            userConfig = config

            // Get server-side rendering options.
            const ssr = !! userConfig.build?.ssr

            // Check the application environment.
            const env = loadEnv(mode, userConfig.envDir || process.cwd(), '')

            // Get the asset url if an asset link address is set for the assets.
            const assetUrl = env.SRYLIUS_APP_ASSET_URL ?? ''

            //
            return {
                base        : userConfig.base ?? (command === 'build' ? resolveBase(pluginConfig, assetUrl) : ''),
                publicDir   : userConfig.publicDir ?? false,
                build       : {
                    manifest            : userConfig.build?.manifest ?? (ssr ? false : 'manifest.json'),
                    ssrManifest         : userConfig.build?.ssrManifest ?? (ssr ? 'ssr-manifest.json' : false),
                    outDir              : userConfig.build?.outDir ?? resolveOutputDirectory(pluginConfig, ssr),
                    rollupOptions       : {
                        input   : userConfig.build?.rollupOptions?.input ?? resolveInput(pluginConfig, ssr)
                    },
                    assetsInlineLimit   : userConfig.build?.assetsInlineLimit ?? 0,
                },
                server      : {
                    origin: userConfig.server?.origin,
                },
                resolve     : {
                    alias   : Array.isArray(userConfig.resolve?.alias)
                        ? [
                            ...userConfig.resolve?.alias ?? [],
                            ...Object.keys(defaultAliases).map(alias => ({
                                find: alias,
                                replacement: defaultAliases[alias]
                            }))
                        ]
                        : {
                            ...defaultAliases,
                            ...userConfig.resolve?.alias,
                        }
                },
                ssr         : {
                    noExternal  : resolveNoExternal(userConfig),
                },
            }
        },

        // Configuration options of the decoupled vite plugin for Srylius.
        configResolved(config) {
            resolvedConfig = config
        },

        // Transform placeholders found in configuration.
        transform(code) {
            // Check if the command is `serve`.
            if (resolvedConfig.command === 'serve') {
                // Replace the development server connection url with the placeholder used.
                code = code.replace(/__srylius_vite_placeholder__/g, viteDevServerUrl)

                // Transform the code while serving.
                return pluginConfig.transformOnServe(code, viteDevServerUrl)
            }
        },

        // Configuring the development server.
        configureServer(server) {
            // Get the environment directory path from the configuration.
            const envDir = resolvedConfig.envDir || process.cwd()

            // Get the base url address of the active application in the Srylius framework.
            const appUrl = loadEnv(resolvedConfig.mode, envDir, 'SRYLIUS_APP_BASE_URL').SRYLIUS_APP_BASE_URL ?? 'undefined'

            // Register an event listener for the development server.
            server.httpServer?.once('listening', () => {
                // Get the connection address of the development server.
                const address = server.httpServer?.address()

                // Check the connection address of the development server.
                const isAddressInfo = (x: string|AddressInfo|null|undefined): x is AddressInfo => typeof x === 'object'

                // Check if the development server connection address is valid.
                if (isAddressInfo(address)) {
                    // Parse development server url.
                    viteDevServerUrl = userConfig.server?.origin ? userConfig.server.origin as DevServerUrl : resolveDevServerUrl(address, server.config)

                    // Update the development server in the hot module file.
                    fs.writeFileSync(pluginConfig.hotFile, `${viteDevServerUrl}${server.config.base.replace(/\/$/, '')}`)

                    setTimeout(() => {
                        // Print the version of the srylius framework to the console screen.
                        server.config.logger.info(`\n  ${colors.red(`${colors.bold('SRYLIUS')} ${versionSrylius()}`)}  ${colors.dim('plugin')} ${colors.bold(`v${version()}`)}`)

                        // Skip a line in the console screen.
                        server.config.logger.info('')

                        // Print the base url of the srylius application to the console screen.
                        server.config.logger.info(`  ${colors.green('➜')}  ${colors.bold('SRYLIUS_APP_BASE_URL')}: ${colors.cyan(appUrl.replace(/:(\d+)/, (_, port) => `:${colors.bold(port)}`))}`)
                    }, 100)
                }
            })

            // What to do when the development server is terminated.
            if (! exitHandlersBound) {
                /**
                 * Define a callback for development server artifacts.
                 *
                 * @return {void}
                 */
                const clean = (): void => {
                    // Check hot module file for development server.
                    if (fs.existsSync(pluginConfig.hotFile)) {
                        // Remove hot module refresh file for development server.
                        fs.rmSync(pluginConfig.hotFile)
                    }
                }

                // Clean up debris when exiting development server.
                process.on('exit', clean)

                // Terminate the development server.
                process.on('SIGINT', () => process.exit())
                process.on('SIGTERM', () => process.exit())
                process.on('SIGHUP', () => process.exit())

                // Set the state of development server exit handlers.
                exitHandlersBound = true
            }

            return () => server.middlewares.use((req, res, next) => {
                if (req.url === '/index.html') {
                    res.statusCode = 404

                    res.end(
                        fs.readFileSync(path.join(dirname(), 'vite.html')).toString().replace(/{{ SRYLIUS_APP_BASE_URL }}/g, appUrl)
                    )
                }

                next()
            })
        }
    }
}

/**
 * Convert the users configuration into a standard structure with defaults.
 *
 * @param {string|string[]|PluginConfig} config
 *
 * @return {Required<PluginConfig>}
 */
function resolvePluginConfig(config: string|string[]|PluginConfig): Required<PluginConfig> {
    // Make sure that the configuration for the plugin is provided.
    if (typeof config === 'undefined') {
        // Notify the developer of the exception.
        throw new Error('@srylius/vite : Missing configuration.')
    }

    // Make sure the configuration is array.
    if (typeof config === 'string' || Array.isArray(config)) {
        // Set input and server-side compilation configurations.
        config = { input : config, ssr : config }
    }

    // Make sure that the input configuration for the plugin exists.
    if (typeof config.input === 'undefined') {
        // Notify the developer of the exception.
        throw new Error('@srylius/vite : Missing configuration for "input".')
    }

    // Make sure you have the publish directory configuration for the plugin.
    if (typeof config.publicDirectory === 'string') {
        // Format the publishing directory so that it is usable.
        config.publicDirectory = config.publicDirectory.trim().replace(/^\/+/, '')

        // Make sure your publish directory is not an empty string.
        if (config.publicDirectory === '') {
            // Notify the developer of the exception.
            throw new Error('@srylius/vite : publicDirectory must be a subdirectory. Ex. : \'public\'.')
        }
    }

    // Make sure you have the build directory configuration for the plugin.
    if (typeof config.buildDirectory === 'string') {
        // Format the build directory so that it is usable.
        config.buildDirectory = config.buildDirectory.trim().replace(/^\/+/, '').replace(/\/+$/, '')

        // Make sure your build directory is not an empty string.
        if (config.buildDirectory === '') {
            // Notify the developer of the exception.
            throw new Error('srylius-vite-plugin: buildDirectory must be a subdirectory. E.g. \'build\'.')
        }
    }

    // Make sure that you have a server-side build directory configuration for the plugin.
    if (typeof config.ssrOutputDirectory === 'string') {
        // Format the server-side rendering directory so that it is usable.
        config.ssrOutputDirectory = config.ssrOutputDirectory.trim().replace(/^\/+/, '').replace(/\/+$/, '')
    }

    // Make sure you have a keepalive configuration for the plugin.
    if (config.refresh === true) {
        // Set refresh feature for vite.
        config.refresh = [{ paths: refreshPaths }]
    }

    // Return the parsed and all-checked configuration with default options.
    return {
        input              : config.input,
        publicDirectory    : config.publicDirectory ?? 'public',
        buildDirectory     : config.buildDirectory ?? 'bundle',
        ssr                : config.ssr ?? config.input,
        ssrOutputDirectory : config.ssrOutputDirectory ?? 'bootstrap/ssr',
        refresh            : config.refresh ?? false,
        hotFile            : config.hotFile ?? path.join((config.publicDirectory ?? 'public'), 'srylius.hot'),
        detectTls          : config.detectTls ?? null,
        transformOnServe   : config.transformOnServe ?? ((code) => code),
    }
}

/**
 * Resolve the vite base option from the configuration.
 *
 * @param {Required<PluginConfig>} config
 * @param {string} assetUrl
 *
 * @return {string}
 */
function resolveBase(config: Required<PluginConfig>, assetUrl: string): string {
    // Get the base path via the build directory path.
    return assetUrl + (! assetUrl.endsWith('/') ? '/' : '') + config.buildDirectory + '/'
}

/**
 * Resolve the vite input path from the configuration.
 *
 * @param {Required<PluginConfig>} config
 * @param {boolean} ssr
 *
 * @return {InputOption|undefined}
 */
function resolveInput(config: Required<PluginConfig>, ssr: boolean): InputOption|undefined {
    // Check for server-side rendering.
    if (ssr) {
        // Return current configuration options for server-side compilation.
        return config.ssr
    }

    // Resolve input directories for Vite.
    return config.input
}

/**
 * Resolve the vite output directory path from the configuration.
 *
 * @param {Required<PluginConfig>} config
 * @param {boolean} ssr
 *
 * @return {string|undefined}
 */
function resolveOutputDirectory(config: Required<PluginConfig>, ssr: boolean): string|undefined {
    // Check for server-side rendering.
    if (ssr) {
        // Return the current output directory for server-side compilation.
        return config.ssrOutputDirectory
    }

    // Parse output directory from configuration options.
    return path.join(config.publicDirectory, config.buildDirectory)
}

/**
 * Resolve vite refresh settings without configuring them.
 *
 * @param {Required<PluginConfig>} {refresh: config}
 *
 * @return {PluginOption[]}
 */
function resolveReloadConfig({ refresh: config }: Required<PluginConfig>): PluginOption[]{
    // Check if configuration is of boolean type.
    if (typeof config === 'boolean') {
        // If the configuration type is boolean, return it as an empty array.
        return [];
    }

    // Check if configuration is of string type.
    if (typeof config === 'string') {
        // If the configuration is a string, wrap it in an array.
        config = [{ paths: [config]}]
    }

    // Check if configuration is of array type.
    if (! Array.isArray(config)) {
        // If the configuration is not an array, wrap it in an array.
        config = [config]
    }

    // Check if the values in the configuration pass the required test.
    if (config.some(c => typeof c === 'string')) {
        // Specify the configuration string as a `RefreshConfig` instance.
        config = [{ paths: config }] as RefreshConfig[]
    }

    // Add all directories provided in the configuration to the refresh directories.
    return (config as RefreshConfig[]).flatMap(rConfig => {
        const plugin = fullReload(rConfig.paths, rConfig.config)

        /* eslint-disable-next-line @typescript-eslint/ban-ts-comment */
        /** @ts-ignore */
        plugin.__srylius_plugin_config = c

        return plugin
    })
}

/**
 * Resolve the dev server URL from the server address and configuration.
 *
 * @param {AddressInfo} address
 * @param {ResolvedConfig} config
 *
 * @return {DevServerUrl}
 */
function resolveDevServerUrl(address: AddressInfo, config: ResolvedConfig): DevServerUrl {
    // Hot module reload protocol.
    const configHmrProtocol = typeof config.server.hmr === 'object' ? config.server.hmr.protocol : null

    // Client protocol of the development server.
    const clientProtocol = configHmrProtocol ? (configHmrProtocol === 'wss' ? 'https' : 'http') : null

    // Server protocol of the development server.
    const serverProtocol = config.server.https ? 'https' : 'http'

    // Development server protocol
    const protocol = clientProtocol ?? serverProtocol

    // Hot module reload host.
    const configHmrHost = typeof config.server.hmr === 'object' ? config.server.hmr.host : null

    // Development server host.
    const configHost = typeof config.server.host === 'string' ? config.server.host : null

    // Development server address.
    const serverAddress = isIpv6(address) ? `[${address.address}]` : address.address

    // Development server host.
    const host = configHmrHost ?? configHost ?? serverAddress

    // Client port of the development server.
    const configHmrClientPort = typeof config.server.hmr === 'object' ? config.server.hmr.clientPort : null

    // Port of the development server.
    const port = configHmrClientPort ?? address.port

    // Return the parsed development server connection address.
    return `${protocol}://${host}:${port}`
}

/**
 * Check if the development server's address family is ipv6.
 *
 * @param {AddressInfo} address
 *
 * @return {boolean}
 */
function isIpv6(address: AddressInfo): boolean {
    // Return true or false depending on the development server's binding address family status.
    return address.family === 'IPv6';
}

/**
 * Add the srylius helpers to the list of SSR dependencies that aren't externalized.
 *
 * @param {UserConfig} config
 *
 * @return {boolean|Array<string|RegExp>}
 */
function resolveNoExternal(config: UserConfig): true|Array<string|RegExp> {
    const userNoExternal = (config.ssr as SSROptions|undefined)?.noExternal
    const pluginNoExternal = ['srylius-vite-plugin']

    //
    if (userNoExternal === true) {
        return true
    }

    if (typeof userNoExternal === 'undefined') {
        return pluginNoExternal
    }

    return [
        ...(Array.isArray(userNoExternal) ? userNoExternal : [userNoExternal]),
        ...pluginNoExternal,
    ]
}

/**
 * Runtime version of the Srylius vite plugin.
 *
 * @return {string}
 */
function version(): string {
    try {
        // Get the current version of the plugin from the package manager file.
        return JSON.parse(fs.readFileSync(path.join(dirname(), '../package.json')).toString())?.version
    } catch {
        // If not available, pass an empty string.
        return ''
    }
}

/**
 * Runtime version of the Srylius framework.
 *
 * @return {string}
 */
function versionSrylius(): string {
    try {
        // Get all available packages from the package manager.
        const composer = JSON.parse(fs.readFileSync('composer.lock').toString())

        // Check if the Srylius framework is available in your package manager.
        return composer.packages?.find((composerPackage: { name: string }) => composerPackage.name === 'srylius/framework')?.version ?? ''
    } catch {
        // If not available, pass an empty string.
        return ''
    }
}

/**
 * The directory of the current file.
 *
 * @return {string}
 */
function dirname(): string {
    // This URL.fileURLToPath function decodes the file URL to a path string and
    // ensures that the URL control characters (/, %) are correctly appended/adjusted
    // when converting the given file URL into a path.
    return fileURLToPath(new URL('.', import.meta.url))
}
