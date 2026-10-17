import * as THREE from 'three'
import { hashString, mulberry32 } from './random.js'

// Colour harmony schemes: hue offsets (fractions of the colour wheel) for the
// palette's four colours.
const SCHEMES = {
  analogous: [0, 0.07, 0.14, 0.21],
  complementary: [0, 0.04, 0.5, 0.54],
  triadic: [0, 1 / 3, 2 / 3, 0.08],
  split: [0, 0.42, 0.58, 0.06],
  square: [0, 0.25, 0.5, 0.75],
}
const SATURATION = [0.5, 1] // build-up .. drop
const LIGHTNESS = [0.45, 0.62] // dark .. bright sound
const TINT = [0.35, 0.7] // how strongly windows take the palette: calm .. drop
const PHRASE_ROTATION = 1 // pattern change: rotate hues by this many scheme steps
const DROP_ROTATION = 0.5 // drop: jump round the colour wheel (0.5 = opposite side)
const DRIFT = 0.004 // hue turns per second while the energy is up
const SHIFT_RANGE = 0.35 // how far the tone slides the palette across the windows
const HUE_RATE = 1.5 // per second, how fast hues glide to a new rotation
const RATE = 3 // per second, saturation / lightness / tint smoothing

// The city's palette. Each song (by title) gets a base hue and a harmony
// scheme; the hues rotate a step on every pattern change, jump round the wheel
// when a drop lands, and drift while the energy is up. Energy sets saturation,
// tonal brightness sets lightness and slides the palette across the windows
// (which pick colours by the frequency they listen to).
export function createPalette({ audioField, patterns }) {
  const { uPalette, uPaletteShift, uPaletteTint } = audioField.uniforms
  let title = null
  let offsets = SCHEMES.analogous
  let hue = 0 // where the hues are heading
  let shownHue = 0 // where they are (glides towards hue)
  let seenSwitches = 0
  let saturation = SATURATION[0]
  let lightness = LIGHTNESS[0]
  let shift = 0

  function startSong(name) {
    const rng = mulberry32(hashString(name))
    const schemes = Object.values(SCHEMES)
    offsets = schemes[Math.floor(rng() * schemes.length)]
    hue = shownHue = rng()
  }

  return {
    update(delta, analysis, songTitle) {
      if (songTitle !== title) {
        title = songTitle
        startSong(songTitle || 'untitled')
        seenSwitches = patterns.switches.count
      }
      if (patterns.switches.count !== seenSwitches) {
        seenSwitches = patterns.switches.count
        const step = offsets[1] - offsets[0] || 0.1
        hue += patterns.switches.drop ? DROP_ROTATION : step * PHRASE_ROTATION
      }
      hue += DRIFT * analysis.energy * delta
      shownHue += (hue - shownHue) * Math.min(1, delta * HUE_RATE)

      const blend = Math.min(1, delta * RATE)
      saturation += (THREE.MathUtils.lerp(...SATURATION, analysis.energy) - saturation) * blend
      lightness += (THREE.MathUtils.lerp(...LIGHTNESS, analysis.brightness) - lightness) * blend
      shift += (analysis.brightness * SHIFT_RANGE - shift) * blend
      uPaletteTint.value += (THREE.MathUtils.lerp(...TINT, analysis.energy) - uPaletteTint.value) * blend
      uPaletteShift.value = shift
      offsets.forEach((offset, i) => {
        uPalette.value[i].setHSL((((shownHue + offset) % 1) + 1) % 1, saturation, lightness)
      })
    },
  }
}
