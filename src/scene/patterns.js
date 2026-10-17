import * as THREE from 'three'
import { PATTERN_TYPES } from './audioField.js'
import { mulberry32 } from './random.js'

const { sweep, ripple, outward, scatter } = PATTERN_TYPES

const SET_SIZE = [3, 4] // patterns per song
const PHRASE_KICKS = 16 // consider switching every this many kicks...
const PHRASE_SWITCH_CHANCE = 0.5 // ...with this chance
const DROP_FROM = 0.4 // energy below this, then above DROP_TO, is a drop landing
const DROP_TO = 0.65
const FADE = 1.5 // seconds to crossfade between patterns

// Where ripples can start from: the main screen, the corporate sign, or a
// random spot on a facade.
function rippleOrigin(rng, { heroCenter, signCenter, wallX }) {
  const roll = rng()
  if (roll < 0.25) return heroCenter.clone()
  if (roll < 0.4) return signCenter.clone()
  const side = rng() < 0.5 ? -1 : 1
  return new THREE.Vector3(side * wallX, 10 + rng() * 30, -60 + rng() * 100)
}

// Pattern library: [name, type, origin (or a function of rng), axis, speed].
// Speed is units per second (for scatter: spread in seconds).
function library(places) {
  const { heroCenter } = places
  return [
    ['tower sweep', sweep, heroCenter, [0, 0, 1], 90],
    ['reverse sweep', sweep, new THREE.Vector3(0, 0, 70), [0, 0, -1], 90],
    ['left to right', sweep, new THREE.Vector3(-40, 0, 0), [1, 0, 0], 50],
    ['right to left', sweep, new THREE.Vector3(40, 0, 0), [-1, 0, 0], 50],
    ['rising', sweep, new THREE.Vector3(0, 0, 0), [0, 1, 0], 45],
    ['falling', sweep, new THREE.Vector3(0, 100, 0), [0, -1, 0], 45],
    ['centre out', outward, new THREE.Vector3(0, 0, 0), [1, 0, 0], 25],
    ['ripple', ripple, (rng) => rippleOrigin(rng, places), [0, 0, 0], 90],
    ['scatter', scatter, new THREE.Vector3(), [0, 0, 0], 0.9],
  ].map(([name, type, origin, axis, speed]) => ({ name, type, origin, axis, speed }))
}

function hashString(text) {
  let hash = 2166136261
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619)
  return hash >>> 0
}

// Picks which shape the light pulses take. Each song (by title) gets its own
// set of patterns; within it, patterns change at random on phrase boundaries
// and always when a drop lands, crossfading in the shader.
export function createPatterns({ audioField, places }) {
  const patterns = library(places)
  const { uPatternA, uPatternAxisA, uPatternB, uPatternAxisB, uPatternMix } = audioField.uniforms

  let title = null
  let songSet = []
  let current = null
  let fading = false
  let lastSwitchBeat = 0
  let lowEnergySeen = false

  function write(pattern, rng, origin, axis) {
    const point = typeof pattern.origin === 'function' ? pattern.origin(rng) : pattern.origin
    origin.value.set(point.x, point.y, point.z, pattern.type)
    axis.value.set(...pattern.axis, pattern.speed)
  }

  function switchTo(pattern, rng, immediate) {
    current = pattern
    if (immediate) {
      write(pattern, rng, uPatternA, uPatternAxisA)
      uPatternMix.value = 0
      fading = false
    } else {
      write(pattern, rng, uPatternB, uPatternAxisB)
      uPatternMix.value = 0
      fading = true
    }
  }

  function startSong(name) {
    const rng = mulberry32(hashString(name))
    const shuffled = [...patterns].sort(() => rng() - 0.5)
    songSet = shuffled.slice(0, SET_SIZE[0] + Math.floor(rng() * (SET_SIZE[1] - SET_SIZE[0] + 1)))
    switchTo(songSet[0], rng, true)
  }

  function switchRandomly() {
    const options = songSet.filter((p) => p !== current)
    switchTo(options[Math.floor(Math.random() * options.length)], Math.random, false)
  }

  return {
    get current() {
      return current?.name
    },
    update(delta, analysis, songTitle) {
      if (songTitle !== title) {
        title = songTitle
        startSong(songTitle || 'untitled')
        lastSwitchBeat = analysis.beatCount
      }

      if (fading) {
        uPatternMix.value = Math.min(1, uPatternMix.value + delta / FADE)
        if (uPatternMix.value >= 1) {
          // B becomes the new A.
          uPatternA.value.copy(uPatternB.value)
          uPatternAxisA.value.copy(uPatternAxisB.value)
          uPatternMix.value = 0
          fading = false
        }
        return
      }

      if (analysis.energy < DROP_FROM) lowEnergySeen = true
      const dropLanded = lowEnergySeen && analysis.energy > DROP_TO
      const phraseEnded = analysis.beatCount - lastSwitchBeat >= PHRASE_KICKS
      if (dropLanded || (phraseEnded && Math.random() < PHRASE_SWITCH_CHANCE)) {
        switchRandomly()
        lowEnergySeen = false
        lastSwitchBeat = analysis.beatCount
      } else if (phraseEnded) {
        lastSwitchBeat = analysis.beatCount
      }
    },
  }
}
