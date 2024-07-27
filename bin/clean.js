#!/usr/bin/env node

import { readFileSync, readdirSync, unlinkSync, existsSync } from 'fs'
import { dirname } from 'path'

/**
 * Detect arguments given during purge.
 *
 * @param {string} name
 *
 * @return {undefined|string}
 */
const argument = (name) => {
    const index = process.argv.findIndex(argument => argument.startsWith(`--${name}=`))

    return index === -1
        ? undefined
        : process.argv[index].substring(`--${name}=`.length)
}

// Console : Argument (Custom)
const option = (name) => process.argv.includes(`--${name}`)

// Console : Information Message
const info = option(`quiet`) ? (() => undefined) : console.log

// Console : Error Message
const error = option(`quiet`) ? (() => undefined) : console.error

/**
 * Task to clear all assets from manifest files.
 *
 * @return {void}
 */
const main = () => {
    // Default output manifest file paths for Vite.
    const manifestPaths = argument(`manifest`) ? [argument(`manifest`)] : (option(`ssr`)
        ? [`./bootstrap/ssr/ssr-manifest.json`, `./bootstrap/ssr/manifest.json`]
        : [`./public/bundle/manifest.json`])

    // Determine which manifest files are there and retrieve them.
    const foundManifestPath = manifestPaths.find(existsSync)

    // If manifest file not found, report this.
    if (! foundManifestPath) {
        // Report status to console screen.
        error(`Unable to find manifest file.`)

        // Log out from the console.
        process.exit(1)
    }

    // Write a message saying that the manifest file is being read for server-side rendering.
    info(`Reading manifest [${foundManifestPath}].`)

    // Found manifest file.
    const manifest = JSON.parse(readFileSync(foundManifestPath).toString())

    // Assets found in the manifest file.
    const manifestFiles = Object.keys(manifest)

    // Check for server-side rendering.
    const isSsr = Array.isArray(manifest[manifestFiles[0]])

    // Notify if the manifest file is found, whether it is a server-side compilation or not.
    isSsr
        ? info(`SSR manifest found.`)
        : info(`Non-SSR manifest found.`)

    // Make the entities in the manifest file processable.
    const manifestAssets = isSsr
        ? manifestFiles.flatMap(key => manifest[key])
        : manifestFiles.flatMap(key => [
            ...manifest[key].css ?? [],
            manifest[key].file,
        ])

    // If no asset directory is specifically specified, retrieve the asset directory from the manifest file.
    const assetsPath = argument('assets') ?? dirname(foundManifestPath)+'/assets'

    info(`Verify assets in [${assetsPath}].`)

    // Retrieve all assets in the asset directory.
    const existingAssets = readdirSync(assetsPath, { withFileTypes: true })

    // Get all orphaned assets in the asset directory.
    const orphanedAssets = existingAssets.filter(file => file.isFile())
        .filter(file => manifestAssets.findIndex(asset => asset.endsWith(`/${file.name}`)) === -1)

    // If the orphan is not found, report it.
    if (orphanedAssets.length === 0) {
        info(`No ophaned assets found.`)
    } else {
        // If an orphaned entity is found, notify the console screen according to singular or plural case.
        orphanedAssets.length === 1
            ? info(`[${orphanedAssets.length}] orphaned asset found.`)
            : info(`[${orphanedAssets.length}] orphaned assets found.`)

        // Repeat the process for all orphaned assets.
        orphanedAssets.forEach(asset => {
            // Define the index of the orphan entity.
            const path = `${assetsPath}/${asset.name}`

            // Check if `dry-run` option is given.
            option(`dry-run`)
                // Write a notification to the console screen that the orphaned entity has been deleted.
                ? info(`Orphaned asset [${path}] would be removed.`)
                : info(`Removing orphaned asset [${path}].`)

            // Check if `dry-run` option is given.
            if (! option(`dry-run`)) {
                // If `dry-run` parameter is not given, remove symbols.
                unlinkSync(path)
            }
        })
    }
}

// Run the task.
main()
