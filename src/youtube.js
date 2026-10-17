// Turns a pasted YouTube link into a track like the others ({ title, url }).
// The local dev/preview server downloads the audio with yt-dlp (see
// vite-plugins/youtubeAudio.js), so it plays and analyses like a local file.
export async function fetchYouTubeTrack(link) {
  const response = await fetch(`${import.meta.env.BASE_URL}api/youtube`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: link.trim() }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error ?? `Request failed (${response.status})`)
  return data
}
