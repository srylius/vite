import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'

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
 * Runtime version of the Srylius vite plugin.
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
