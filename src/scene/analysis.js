import { BANDS } from './audioField.js'

// Few, wide bars so they stay readable at the PS1 view's low resolution.
export const BARS = 16
const MIN_HZ = 30
const MAX_HZ = 16000
const TREBLE_TILT = 0.35 // lift the top bars a little so they move too
// >1 pushes the middle of the range down so only real peaks reach the top.
const CURVE = 1.4
// Lights follow hits rather than sustained level: a band's light level is its
// value plus how far it jumps above its own recent average.
const ONSET_GAIN = 2.5
const AVERAGE_RATE = 4 // per second; ~0.25s memory
const BEAT_THRESHOLD = 0.6
const BEAT_COOLDOWN = 0.18 // seconds; fast enough for 170+ BPM

function bandLevel(frequency, binHz, fromHz, toHz) {
  const lo = Math.floor(fromHz / binHz)
  const hi = Math.max(lo + 1, Math.floor(toHz / binHz))
  let sum = 0
  for (let i = lo; i < hi; i++) sum += frequency[i]
  return sum / (hi - lo) / 255
}

// Fills `out` with log-spaced band levels (0..1) so bass doesn't get squeezed
// into a couple of entries. Music is bass-heavy, so `tilt` lifts the top end.
function logSpectrum(frequency, binHz, out, fromHz, toHz, tilt) {
  const n = out.length
  for (let i = 0; i < n; i++) {
    const from = fromHz * (toHz / fromHz) ** (i / n)
    const to = fromHz * (toHz / fromHz) ** ((i + 1) / n)
    const lo = Math.floor(from / binHz)
    const hi = Math.max(lo + 1, Math.floor(to / binHz))
    let max = 0
    for (let b = lo; b < hi; b++) max = Math.max(max, frequency[b])
    out[i] = Math.min(1, (max / 255) ** CURVE * (1 + (i / n) * tilt))
  }
}

// One analysis per frame, shared by every screen and light in the scene.
export class AudioAnalysis {
  constructor() {
    this.bars = new Float32Array(BARS)
    // For the city lights: [overall bass, ...BANDS - 1 log bands above it]
    this.bands = new Float32Array(BANDS)
    this.rawBands = new Float32Array(BANDS)
    this.bandAverages = new Float32Array(BANDS)
    this.levels = { bass: 0, treble: 0 }
    this.beat = false // true on the frame a kick lands
    this.beatCount = 0
    this.sinceBeat = 0
    this.frame = null
  }

  update(delta, frame) {
    this.frame = frame
    this.beat = false
    this.sinceBeat += delta
    if (!frame.frequency || !frame.playing) {
      this.bars.fill(0)
      this.bands.fill(0)
      this.bandAverages.fill(0)
      this.levels.bass = this.levels.treble = 0
      return
    }
    const binHz = frame.sampleRate / 2 / frame.frequency.length
    const raw = this.rawBands
    logSpectrum(frame.frequency, binHz, this.bars, MIN_HZ, MAX_HZ, TREBLE_TILT)
    logSpectrum(frame.frequency, binHz, raw.subarray(1), 150, MAX_HZ, TREBLE_TILT)
    raw[0] = bandLevel(frame.frequency, binHz, 20, 150) ** CURVE

    const blend = Math.min(1, delta * AVERAGE_RATE)
    for (let i = 0; i < BANDS; i++) {
      const onset = Math.max(0, raw[i] - this.bandAverages[i])
      this.bands[i] = Math.min(1, raw[i] * 0.5 + onset * ONSET_GAIN)
      this.bandAverages[i] += (raw[i] - this.bandAverages[i]) * blend
    }
    this.levels.bass = this.bands[0]
    this.levels.treble = bandLevel(frame.frequency, binHz, 3000, 12000)

    if (this.levels.bass > BEAT_THRESHOLD && this.sinceBeat > BEAT_COOLDOWN) {
      this.beat = true
      this.beatCount++
      this.sinceBeat = 0
    }
  }
}
