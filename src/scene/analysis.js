import * as THREE from 'three'
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
// Quiet passages (build-ups) boost how strongly hits register, so a sudden
// peak still sends a full pulse through the city.
const LOUDNESS_RATE = 0.4 // per second; ~2.5s memory
const AGC_TARGET = 0.3 // loudness at which no boost is applied
const AGC_MAX = 2.5
// Stereo placement only kicks in near the track's own peak loudness, and only
// once it's genuinely loud (so quiet intros don't count as a "peak").
const PEAK_DECAY = 0.02 // per second, how fast the remembered peak falls
const PEAK_FROM = 0.7 // fraction of the peak where stereo starts...
const PEAK_FULL = 0.9 // ...and where it's at full strength
const LOUD_FROM = 0.12 // absolute loudness where stereo starts...
const LOUD_FULL = 0.2 // ...and where it's at full strength
// Mixes often lean slightly to one side throughout; a slow average of the
// balance is treated as centre, so only actual panning moves the lights.
const CENTRE_RATE = 0.2 // per second; ~5s memory
const STEREO_GAIN = 4 // panning moves are small; exaggerate them
const BEAT_THRESHOLD = 0.6
const BEAT_COOLDOWN = 0.18 // seconds; fast enough for 170+ BPM
// Any sharp onset (not just kicks), for effects that should land on hits.
const HIT_THRESHOLD = 0.7
const HIT_COOLDOWN = 0.1
// City bands above band 0 (overall bass) start low, so sub sweeps and bass
// rises get bands of their own.
const BAND_FROM_HZ = 40
// In calm passages each band is measured against its own recent peak, so slow
// rises (risers, swelling bass) light their windows rather than only hits.
const BAND_PEAK_DECAY = 0.05 // per second
const BAND_PEAK_FLOOR = 0.08
const CALM_SUSTAIN = 0.8 // how much of a band's normalised level shows when calm
// Even outside calm passages, part of each band's steady level (against its
// own peak) feeds the lights, so held vocals and pads register over drums.
const SUSTAIN_FLOOR = 0.35
// The hero's bars blend absolute level with each bar's level against its own
// recent peak, so vocals and quiet sections still move them.
const BAR_NORMALISE = 0.5
const BAR_PEAK_DECAY = 0.15 // per second
const BAR_PEAK_FLOOR = 0.1
// Vocal presence: the voice range against its own recent peak, smoothed.
const VOICE_HZ = [300, 3000]
const VOICE_PEAK_DECAY = 0.1 // per second
const VOICE_SMOOTHING = 8 // per second
// Energy: where the track is in its arc (build-up vs drop). Mostly whether the
// heavy sub-bass is in (a DnB drop is where the sub arrives), partly overall
// loudness. It scales how hard the lights respond, so build-ups stay subdued
// and the drop opens everything up.
const ENERGY_SUB_HZ = [30, 100]
const ENERGY_SUB = [0.55, 0.8] // smoothed sub level: no energy below, full above
const ENERGY_SUB_SHARE = 0.6 // vs. 1 - calm
const SUB_SMOOTHING = 1.5 // per second
const ENERGY_RISE = 4 // per second: the drop lands fast...
const ENERGY_FALL = 0.7 // ...and the energy drains away slowly
const QUIET_LIGHTS = 0.4 // light response at zero energy (1 at full)
const QUIET_DRUMS = 0.35 // drum flash strength at zero energy
// Heavy bass pushes pull every window towards one colour: bass level range
// over which that happens (scaled by energy, so build-ups don't do it).
const UNIFY_BASS = [0.4, 0.9]

// Drum detection by spectral flux (new energy since the last frame) over each
// drum's frequency ranges ([fromHz, toHz, weight]); a hit is flux well above
// its own running average, so it adapts to each mix. DnB snares sit on the
// backbeat; hats and light percussion fill in between.
const DRUMS = {
  snare: { ranges: [[180, 280, 0.3], [1500, 6000, 0.7]], sensitivity: 1.5, cooldown: 0.15, decay: 7 },
  hat: { ranges: [[7000, 14000, 1]], sensitivity: 1.5, cooldown: 0.06, decay: 14 },
}
const FLUX_RATE = 2 // per second; memory of the running average
const MIN_FLUX = 0.01

function spectralFlux(frequency, previous, binHz, fromHz, toHz) {
  const lo = Math.floor(fromHz / binHz)
  const hi = Math.max(lo + 1, Math.floor(toHz / binHz))
  let sum = 0
  for (let i = lo; i < hi; i++) sum += Math.max(0, frequency[i] - previous[i])
  return sum / (hi - lo) / 255
}

// Power surges: the heaviest sub-bass hits, judged against the track's own
// recent sub-bass peak (sub levels vary a lot between masters).
const SURGE_RATIO = 0.92 // fraction of the sub-bass peak that counts as a surge
const SURGE_DECAY = 0.03 // per second, how fast the remembered sub peak falls
const SURGE_COOLDOWN = 0.6 // seconds
// "Calm" (quiet passages, build-ups): well below the track's peak, or just quiet.
const CALM_RATIO = [0.55, 0.85] // loudness / peak: fully calm below, not at all above
const CALM_LOUDNESS = [0.08, 0.16] // absolute loudness, same idea

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
    this.bandPeaks = new Float32Array(BANDS)
    this.barPeaks = new Float32Array(BARS)
    this.levels = { bass: 0, treble: 0, voice: 0 }
    this.voicePeak = 0.1
    // Envelopes (1 on a hit, decaying) and which side the last snare was on.
    this.drums = { snare: 0, hat: 0, snareSide: 0 }
    this.drumState = Object.fromEntries(Object.keys(DRUMS).map((name) => [name, { mean: 0, variance: 0, since: 0 }]))
    this.previousFrequency = null
    this.loudness = 0 // slow average of overall level
    this.peakLoudness = 0.1
    // balance: -1 louder right .. 1 louder left; weight: 0..1, how much the
    // lights should follow it (only near the track's peaks).
    this.stereo = { balance: 0, weight: 0 }
    this.stereoCentre = 0
    this.beat = false // true on the frame a kick lands
    this.beatCount = 0
    this.sinceBeat = 0
    this.beatInterval = 0.35 // seconds, smoothed spacing between kicks
    this.hit = false // true on the frame any sharp onset lands
    this.sinceHit = 0
    this.calm = 0 // 0..1, how quiet this passage is relative to the track
    this.energy = 0 // 0..1, build-up / breakdown vs drop
    this.unify = 0 // 0..1, how far windows go to one colour on a heavy bass push
    this.subLevel = 0
    this.surge = false // true on a kick with exceptionally deep, heavy sub-bass
    this.subPeak = 0.5
    this.sinceSurge = 0
    this.frame = null
  }

  update(delta, frame) {
    this.frame = frame
    this.beat = false
    this.hit = false
    this.surge = false
    this.sinceBeat += delta
    this.sinceHit += delta
    this.sinceSurge += delta
    if (!frame.frequency || !frame.playing) {
      this.calm = 0
      this.energy = 0
      this.unify = 0
      this.bars.fill(0)
      this.bands.fill(0)
      this.bandAverages.fill(0)
      this.levels.bass = this.levels.treble = this.levels.voice = 0
      this.drums.snare = this.drums.hat = 0
      this.stereo.balance = this.stereo.weight = 0
      this.stereoCentre = 0
      return
    }
    const binHz = frame.sampleRate / 2 / frame.frequency.length
    const raw = this.rawBands
    logSpectrum(frame.frequency, binHz, this.bars, MIN_HZ, MAX_HZ, TREBLE_TILT)
    logSpectrum(frame.frequency, binHz, raw.subarray(1), BAND_FROM_HZ, MAX_HZ, TREBLE_TILT)
    raw[0] = bandLevel(frame.frequency, binHz, 20, 150) ** CURVE

    let mean = 0
    for (let i = 0; i < BANDS; i++) mean += raw[i]
    mean /= BANDS
    this.loudness += (mean - this.loudness) * Math.min(1, delta * LOUDNESS_RATE)
    this.peakLoudness = Math.max(this.loudness, this.peakLoudness - delta * PEAK_DECAY, 0.1)
    const boost = THREE.MathUtils.clamp(AGC_TARGET / (this.loudness + 0.02), 1, AGC_MAX)
    const { smoothstep } = THREE.MathUtils
    this.calm = Math.max(
      1 - smoothstep(this.loudness / this.peakLoudness, ...CALM_RATIO),
      1 - smoothstep(this.loudness, ...CALM_LOUDNESS),
    )
    const subNow = bandLevel(frame.frequency, binHz, ...ENERGY_SUB_HZ)
    this.subLevel += (subNow - this.subLevel) * Math.min(1, delta * SUB_SMOOTHING)
    const energyTarget =
      smoothstep(this.subLevel, ...ENERGY_SUB) * ENERGY_SUB_SHARE + (1 - this.calm) * (1 - ENERGY_SUB_SHARE)
    const energyRate = energyTarget > this.energy ? ENERGY_RISE : ENERGY_FALL
    this.energy += (energyTarget - this.energy) * Math.min(1, delta * energyRate)
    const lightScale = THREE.MathUtils.lerp(QUIET_LIGHTS, 1, this.energy)
    // The hero's bars get part of the quiet-passage boost too.
    const barBoost = 1 + (boost - 1) * 0.5
    for (let i = 0; i < BARS; i++) {
      const bar = this.bars[i]
      this.barPeaks[i] = Math.max(bar, this.barPeaks[i] - delta * BAR_PEAK_DECAY, BAR_PEAK_FLOOR)
      this.bars[i] = Math.min(1, THREE.MathUtils.lerp(bar * barBoost, bar / this.barPeaks[i], BAR_NORMALISE))
    }

    const blend = Math.min(1, delta * AVERAGE_RATE)
    let strongestOnset = 0
    for (let i = 0; i < BANDS; i++) {
      const onset = Math.max(0, raw[i] - this.bandAverages[i]) * ONSET_GAIN * boost
      this.bandPeaks[i] = Math.max(raw[i], this.bandPeaks[i] - delta * BAND_PEAK_DECAY, BAND_PEAK_FLOOR)
      const sustainWeight = Math.max(this.calm, SUSTAIN_FLOOR)
      const sustained = THREE.MathUtils.lerp(raw[i] * 0.5, (raw[i] / this.bandPeaks[i]) * CALM_SUSTAIN, sustainWeight)
      this.bands[i] = Math.min(1, sustained + onset) * lightScale
      this.bandAverages[i] += (raw[i] - this.bandAverages[i]) * blend
      strongestOnset = Math.max(strongestOnset, onset)
    }
    if (strongestOnset > HIT_THRESHOLD && this.sinceHit > HIT_COOLDOWN) {
      this.hit = true
      this.sinceHit = 0
    }
    this.updateStereo(delta, frame)
    this.levels.bass = this.bands[0]
    this.unify = THREE.MathUtils.smoothstep(this.levels.bass, ...UNIFY_BASS) * this.energy
    this.levels.treble = bandLevel(frame.frequency, binHz, 3000, 12000)
    const voice = bandLevel(frame.frequency, binHz, ...VOICE_HZ) ** CURVE
    this.voicePeak = Math.max(voice, this.voicePeak - delta * VOICE_PEAK_DECAY, 0.1)
    this.levels.voice += (voice / this.voicePeak - this.levels.voice) * Math.min(1, delta * VOICE_SMOOTHING)
    this.detectDrums(delta, frame, binHz)

    if (this.levels.bass > BEAT_THRESHOLD && this.sinceBeat > BEAT_COOLDOWN) {
      // Plausible kick spacings only (50-300 BPM), smoothed into a tempo.
      if (this.sinceBeat < 1.2) this.beatInterval += (this.sinceBeat - this.beatInterval) * 0.2
      this.beat = true
      this.beatCount++
      this.sinceBeat = 0
    }

    const sub = bandLevel(frame.frequency, binHz, 20, 60)
    this.subPeak = Math.max(sub, this.subPeak - delta * SURGE_DECAY, 0.5)
    if (this.beat && sub >= this.subPeak * SURGE_RATIO && this.sinceSurge > SURGE_COOLDOWN) {
      this.surge = true
      this.sinceSurge = 0
    }
  }

  detectDrums(delta, frame, binHz) {
    const { frequency } = frame
    if (this.previousFrequency?.length !== frequency.length) {
      this.previousFrequency = Uint8Array.from(frequency)
      return
    }
    const blend = Math.min(1, delta * FLUX_RATE)
    for (const [name, spec] of Object.entries(DRUMS)) {
      const state = this.drumState[name]
      let flux = 0
      for (const [from, to, weight] of spec.ranges) {
        flux += weight * spectralFlux(frequency, this.previousFrequency, binHz, from, to)
      }
      state.since += delta
      const hit =
        flux > MIN_FLUX &&
        flux > state.mean + spec.sensitivity * Math.sqrt(state.variance) &&
        state.since > spec.cooldown
      state.mean += (flux - state.mean) * blend
      state.variance += ((flux - state.mean) ** 2 - state.variance) * blend
      const strength = THREE.MathUtils.lerp(QUIET_DRUMS, 1, this.energy)
      this.drums[name] = hit ? strength : this.drums[name] * Math.exp(-delta * spec.decay)
      if (hit) {
        state.since = 0
        if (name === 'snare') this.drums.snareSide = 1 - this.drums.snareSide // ping-pong
      }
    }
    this.previousFrequency.set(frequency)
  }

  // Left/right balance above the bass (DnB sub-bass is usually mono).
  updateStereo(delta, frame) {
    const binHz = frame.sampleRate / 2 / frame.left.length
    const left = bandLevel(frame.left, binHz, 150, 12000)
    const right = bandLevel(frame.right, binHz, 150, 12000)
    // A mono file leaves one channel silent; treat that as centred.
    const mono = Math.min(left, right) < Math.max(left, right) * 0.05
    const raw = mono || !(left + right) ? 0 : (left - right) / (left + right)
    this.stereoCentre += (raw - this.stereoCentre) * Math.min(1, delta * CENTRE_RATE)
    const balance = THREE.MathUtils.clamp((raw - this.stereoCentre) * STEREO_GAIN, -1, 1)
    this.stereo.balance += (balance - this.stereo.balance) * Math.min(1, delta * 10)
    this.stereo.weight =
      THREE.MathUtils.smoothstep(this.loudness / this.peakLoudness, PEAK_FROM, PEAK_FULL) *
      THREE.MathUtils.smoothstep(this.loudness, LOUD_FROM, LOUD_FULL)
  }
}
