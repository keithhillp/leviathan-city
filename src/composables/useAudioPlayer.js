import { computed, onBeforeUnmount, ref } from 'vue'

// Plays a track list through a Web Audio analyser. The audio graph is only
// created on the first play, because browsers block AudioContext until the
// user interacts with the page.
export function useAudioPlayer(loadTracks) {
  const audio = new Audio()
  audio.crossOrigin = 'anonymous'
  audio.preload = 'auto'

  const tracks = ref([])
  const index = ref(0)
  const playing = ref(false)
  const current = computed(() => tracks.value[index.value] ?? null)

  let context = null
  let analyser = null

  // Reused every frame so the render loop doesn't allocate.
  const frame = {
    frequency: null,
    waveform: null,
    sampleRate: 44100,
    title: '',
    started: false,
    playing: false,
    currentTime: 0,
    duration: 0,
  }

  function ensureGraph() {
    if (context) return
    context = new AudioContext()
    analyser = context.createAnalyser()
    analyser.fftSize = 2048
    // Tuned for loud, heavily compressed masters like drum and bass: the
    // default -30 dB ceiling pins most bands at full, and 0.8 smoothing
    // smears 170+ BPM drums together.
    analyser.minDecibels = -85
    analyser.maxDecibels = -20
    analyser.smoothingTimeConstant = 0.6
    context.createMediaElementSource(audio).connect(analyser)
    analyser.connect(context.destination)
    frame.frequency = new Uint8Array(analyser.frequencyBinCount)
    frame.waveform = new Uint8Array(analyser.fftSize)
    frame.sampleRate = context.sampleRate
    frame.started = true
  }

  async function play() {
    if (!current.value) return
    ensureGraph()
    await context.resume()
    await audio.play().catch(() => {})
  }

  function load(i, autoplay) {
    if (!tracks.value.length) return
    index.value = (i + tracks.value.length) % tracks.value.length
    audio.src = current.value.url
    if (autoplay) play()
  }

  function togglePlay() {
    if (audio.paused) play()
    else audio.pause()
  }

  function previous() {
    // Like most players: restart the song unless we're near its start.
    if (audio.currentTime > 3) audio.currentTime = 0
    else load(index.value - 1, playing.value)
  }

  function next() {
    load(index.value + 1, playing.value)
  }

  function sample() {
    if (analyser) {
      analyser.getByteFrequencyData(frame.frequency)
      analyser.getByteTimeDomainData(frame.waveform)
    }
    frame.title = current.value?.title ?? ''
    frame.playing = !audio.paused
    frame.currentTime = audio.currentTime
    frame.duration = audio.duration || 0
    return frame
  }

  const onPlay = () => (playing.value = true)
  const onPause = () => (playing.value = false)
  const onEnded = () => load(index.value + 1, true)
  audio.addEventListener('play', onPlay)
  audio.addEventListener('pause', onPause)
  audio.addEventListener('ended', onEnded)

  loadTracks().then((list) => {
    tracks.value = list
    load(0, false)
  })

  onBeforeUnmount(() => {
    audio.pause()
    audio.removeEventListener('play', onPlay)
    audio.removeEventListener('pause', onPause)
    audio.removeEventListener('ended', onEnded)
    context?.close()
  })

  return { tracks, index, current, playing, togglePlay, previous, next, sample }
}
