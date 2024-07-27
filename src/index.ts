import fs from 'fs'

/**
 * Indexes to keep live for Srylius and Levdwire ecosystem.
 *
 * @type {string[]}
 */
export const refreshPaths: string[] = [
    'app/View/Levdwire/**',
    'app/View/Components/**',
    'resources/languages/**',
    'resources/themes/**',
    'resources/plugins/**',
    'resources/views/**',
    'routes/**',
    'system/**',
].filter(path => fs.existsSync(path.replace(/\*\*$/, '')))
