// Where the playlist comes from. Swap the body for a fetch from the CMS later;
// it only needs to resolve to [{ title, url }]. Remote audio must be served
// with CORS headers, otherwise the analyser only reads silence.
export async function loadTracks() {
  return [{ title: ' DoomSayer', url: `${import.meta.env.BASE_URL}music/ DoomSayer.mp3` }]
}
