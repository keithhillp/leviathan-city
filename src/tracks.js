import localFiles from 'virtual:music-library'

// Where the playlist comes from. For now it's every audio file in
// public/music (listed by the music-library Vite plugin). Later, swap the
// body for a fetch from the CMS; it only needs to resolve to [{ title, url }],
// e.g.
//   const response = await fetch('https://cms.example.com/api/tracks')
//   return (await response.json()).map((track) => ({ title: track.title, url: track.audioUrl }))
// Remote audio must be served with CORS headers, otherwise the analyser only
// reads silence.
export async function loadTracks() {
  return localFiles.map((file) => ({
    title: titleFromFile(file),
    url: `${import.meta.env.BASE_URL}music/${encodeURIComponent(file)}`,
  }))
}

// "Project_92m.mp3" -> "Project 92m"
function titleFromFile(file) {
  return file
    .replace(/\.[^.]+$/, '')
    .replace(/_+/g, ' ')
    .trim()
}
