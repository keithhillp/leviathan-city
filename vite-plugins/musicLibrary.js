import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const ID = 'virtual:music-library'
const RESOLVED_ID = '\0' + ID
const AUDIO = /\.(mp3|ogg|oga|wav|flac|m4a|aac|opus|webm)$/i

// Exposes the audio files in a folder as `import files from 'virtual:music-library'`
// (an array of file names, sorted). Browsers can't list a directory, so the
// list is read at build time; in dev, adding or removing a file reloads the page.
export function musicLibrary({ dir = 'public/music' } = {}) {
  let folder

  const list = () =>
    existsSync(folder)
      ? readdirSync(folder)
          .filter((file) => AUDIO.test(file))
          .sort((a, b) => a.localeCompare(b))
      : []

  return {
    name: 'music-library',
    configResolved(config) {
      folder = join(config.root, dir)
    },
    resolveId(id) {
      if (id === ID) return RESOLVED_ID
    },
    load(id) {
      if (id === RESOLVED_ID) return `export default ${JSON.stringify(list())}`
    },
    configureServer(server) {
      server.watcher.add(folder)
      const refresh = (file) => {
        if (!file.startsWith(folder)) return
        const module = server.moduleGraph.getModuleById(RESOLVED_ID)
        if (module) server.moduleGraph.invalidateModule(module)
        server.ws.send({ type: 'full-reload' })
      }
      server.watcher.on('add', refresh)
      server.watcher.on('unlink', refresh)
    },
  }
}
