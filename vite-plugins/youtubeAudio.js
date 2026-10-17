import { spawn } from 'node:child_process'
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs'
import { basename, extname, join } from 'node:path'

// Local-only YouTube audio: POST /api/youtube { url } downloads a video's
// audio with yt-dlp into a cache folder and returns { title, url }, where url
// is served by GET /api/youtube/audio/<file> (with range support, so seeking
// works). Needs yt-dlp on the PATH. Runs on the dev and preview servers only;
// a static deploy has no server to do this.
const API = '/api/youtube'
const AUDIO = `${API}/audio/`
const YOUTUBE_HOST = /(^|\.)youtube\.com$|^youtu\.be$/
const MIME = { m4a: 'audio/mp4', mp4: 'audio/mp4', webm: 'audio/webm', opus: 'audio/ogg', ogg: 'audio/ogg', mp3: 'audio/mpeg' }

function isYouTube(link) {
  try {
    const { protocol, hostname } = new URL(link)
    return (protocol === 'https:' || protocol === 'http:') && YOUTUBE_HOST.test(hostname)
  } catch {
    return false
  }
}

function download(link, cacheDir) {
  return new Promise((resolve, reject) => {
    const args = [
      ['-f', 'bestaudio[ext=m4a]/bestaudio'],
      ['--no-playlist', '--no-simulate'],
      ['--print', 'title', '--print', 'after_move:filepath'],
      ['-o', join(cacheDir, '%(id)s.%(ext)s')],
      ['--', link],
    ].flat()
    const child = spawn('yt-dlp', args)
    let out = ''
    let err = ''
    child.stdout.on('data', (chunk) => (out += chunk))
    child.stderr.on('data', (chunk) => (err += chunk))
    child.on('error', (error) =>
      reject(error.code === 'ENOENT' ? new Error('yt-dlp is not installed on this machine') : error),
    )
    child.on('close', (code) => {
      const lines = out.trim().split('\n')
      if (code !== 0 || lines.length < 2) {
        reject(new Error(err.trim().split('\n').pop() || 'yt-dlp failed'))
      } else {
        resolve({ title: lines[0], file: lines[lines.length - 1] })
      }
    })
  })
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

function sendFile(req, res, file) {
  const { size } = statSync(file)
  const type = MIME[extname(file).slice(1)] ?? 'application/octet-stream'
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '')
  if (!range) {
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes' })
    createReadStream(file).pipe(res)
    return
  }
  // "bytes=start-end", "bytes=start-" or the last N bytes "bytes=-N".
  let start = range[1] ? Number(range[1]) : size - Number(range[2])
  let end = range[1] && range[2] ? Number(range[2]) : size - 1
  start = Math.max(0, start)
  end = Math.min(end, size - 1)
  res.writeHead(206, {
    'Content-Type': type,
    'Content-Length': end - start + 1,
    'Content-Range': `bytes ${start}-${end}/${size}`,
    'Accept-Ranges': 'bytes',
  })
  createReadStream(file, { start, end }).pipe(res)
}

export function youtubeAudio({ cacheDir = 'node_modules/.cache/youtube-audio' } = {}) {
  let folder

  const middleware = async (req, res, next) => {
    const path = (req.url ?? '').split('?')[0]
    try {
      if (path === API && req.method === 'POST') {
        const { url } = JSON.parse((await readBody(req)) || '{}')
        if (!isYouTube(url)) return sendJson(res, 400, { error: 'Not a YouTube link' })
        mkdirSync(folder, { recursive: true })
        const { title, file } = await download(url, folder)
        return sendJson(res, 200, { title, url: AUDIO + encodeURIComponent(basename(file)) })
      }
      if (path.startsWith(AUDIO) && req.method === 'GET') {
        // basename() keeps requests inside the cache folder.
        const file = join(folder, basename(decodeURIComponent(path.slice(AUDIO.length))))
        if (!existsSync(file)) return sendJson(res, 404, { error: 'Not found' })
        return sendFile(req, res, file)
      }
    } catch (error) {
      return sendJson(res, 500, { error: error.message })
    }
    next()
  }

  return {
    name: 'youtube-audio',
    configResolved(config) {
      folder = join(config.root, cacheDir)
    },
    configureServer(server) {
      server.middlewares.use(middleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware)
    },
  }
}
