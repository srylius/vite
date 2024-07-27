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
