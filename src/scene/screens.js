import * as THREE from 'three'

const PX_PER_UNIT = 22
const MAX_PX = 1024
const LED_PITCH = 3 // px per LED cell in the overlay
const FLICKER_CHANCE = 0.15 // per second, for screens with `flicker`
const GLITCH_COLOURS = ['#ff00aa', '#00ffee', '#000000', '#ffffff']

function makeCanvas(w, h) {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  return canvas
}

// Static overlay drawn over the content: LED grid, vignette and, for worn
// screens, water stains and burnt-out LED modules.
function createGrime(w, h, heavy) {
  const canvas = makeCanvas(w, h)
  const ctx = canvas.getContext('2d')

  const cell = makeCanvas(LED_PITCH, LED_PITCH)
  const c = cell.getContext('2d')
  c.fillStyle = 'rgba(0, 0, 0, 0.4)'
  c.fillRect(LED_PITCH - 1, 0, 1, LED_PITCH)
  c.fillRect(0, LED_PITCH - 1, LED_PITCH, 1)
  ctx.fillStyle = ctx.createPattern(cell, 'repeat')
  ctx.fillRect(0, 0, w, h)

  const vignette = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.75)
  vignette.addColorStop(0, 'rgba(0, 0, 0, 0)')
  vignette.addColorStop(1, `rgba(0, 0, 0, ${heavy ? 0.6 : 0.35})`)
  ctx.fillStyle = vignette
  ctx.fillRect(0, 0, w, h)

  const stains = heavy ? 120 : 30
  for (let i = 0; i < stains; i++) {
    ctx.fillStyle = `rgba(20, 16, 10, ${0.04 + Math.random() * 0.12})`
    ctx.fillRect(Math.random() * w, Math.random() * h * 0.3, 1 + Math.random() * 3, Math.random() * h)
  }

  if (heavy) {
    // Dead modules and dead rows
    const modW = w / 8
    const modH = h / 6
    const dead = Math.floor(Math.random() * 4)
    for (let i = 0; i < dead; i++) {
      ctx.fillStyle = Math.random() < 0.7 ? 'rgba(0, 0, 0, 0.88)' : 'rgba(120, 0, 40, 0.25)'
      ctx.fillRect(Math.floor(Math.random() * 8) * modW, Math.floor(Math.random() * 6) * modH, modW, modH)
    }
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)'
      ctx.fillRect(0, Math.random() * h, w, 1)
    }
  }
  return canvas
}

// A screen on a building: content draws into a persistent buffer, which is
// copied to the texture canvas with the grime overlay on top. Content returns
// true from draw() when it changed, so static screens cost nothing per frame.
export class Screen {
  constructor({
    width,
    height,
    createContent,
    brightness = 0.75,
    resolution = PX_PER_UNIT,
    heavyGrime = true,
    flicker = false,
    pulse = false, // brightness follows the bass
  }) {
    let pxW = Math.round(width * resolution)
    let pxH = Math.round(height * resolution)
    const scale = Math.min(1, MAX_PX / Math.max(pxW, pxH))
    pxW = Math.max(32, Math.round(pxW * scale))
    pxH = Math.max(16, Math.round(pxH * scale))

    this.buffer = makeCanvas(pxW, pxH)
    this.bufferCtx = this.buffer.getContext('2d')
    this.canvas = makeCanvas(pxW, pxH)
    this.ctx = this.canvas.getContext('2d')
    this.grime = createGrime(pxW, pxH, heavyGrime)
    this.content = createContent(this.bufferCtx, pxW, pxH)

    this.texture = new THREE.CanvasTexture(this.canvas)
    this.texture.colorSpace = THREE.SRGBColorSpace
    this.brightness = brightness
    this.flicker = flicker
    this.pulse = pulse
    this.flickerTime = 0
    this.glitchTime = 0
    this.glitchLength = 0
    this.glitchDelay = 0
    this.surging = false
    this.wasGlitching = false
    this.material = new THREE.MeshBasicMaterial({ map: this.texture })
    this.material.color.setScalar(brightness)
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), this.material)
  }

  get glow() {
    return this.content.glow
  }

  // Corrupts the picture for `duration` seconds (re-randomised every frame),
  // starting after `delay`. A `surge` is a power overload: a blown-out flash,
  // then a flickering brownout, with the picture rolling vertically.
  glitch(duration, { surge = false, delay = 0 } = {}) {
    if (this.glitchTime > 0 && !surge) return
    this.glitchTime = this.glitchLength = duration
    this.glitchDelay = delay
    this.surging = surge
  }

  // Torn horizontal slices, a colour-split ghost and corrupted blocks, drawn
  // over the clean frame on the display canvas (the content buffer is untouched).
  drawGlitch(width, height) {
    const ctx = this.ctx
    for (let i = 0, n = 3 + Math.floor(Math.random() * 5); i < n; i++) {
      const y = Math.random() * height
      const sliceH = height * (0.02 + Math.random() * 0.1)
      const shift = (Math.random() - 0.5) * width * 0.5
      ctx.drawImage(this.buffer, 0, y, width, sliceH, shift, y, width, sliceH)
    }
    ctx.save()
    ctx.globalCompositeOperation = 'difference'
    ctx.globalAlpha = 0.6
    ctx.drawImage(this.buffer, (Math.random() - 0.5) * width * 0.04, 0)
    ctx.restore()
    for (let i = 0, n = Math.floor(Math.random() * 4); i < n; i++) {
      ctx.fillStyle = GLITCH_COLOURS[Math.floor(Math.random() * GLITCH_COLOURS.length)]
      ctx.fillRect(Math.random() * width, Math.random() * height, width * (0.05 + Math.random() * 0.25), height * 0.03)
    }
  }

  update(delta, elapsed, analysis) {
    const { width, height } = this.canvas
    if (this.glitchDelay > 0) this.glitchDelay -= delta
    const glitching = this.glitchTime > 0 && this.glitchDelay <= 0
    if (glitching) this.glitchTime -= delta
    const changed = this.content.draw(this.bufferCtx, width, height, delta, elapsed, analysis)
    // Static content still needs redrawing while glitching, and once after to restore it.
    if (changed || glitching || this.wasGlitching) {
      if (glitching && this.surging) {
        // Picture rolls vertically as the power fails.
        const roll = Math.random() * height
        this.ctx.drawImage(this.buffer, 0, roll - height)
        this.ctx.drawImage(this.buffer, 0, roll)
      } else {
        this.ctx.drawImage(this.buffer, 0, 0)
      }
      if (glitching) this.drawGlitch(width, height)
      this.ctx.drawImage(this.grime, 0, 0)
      this.texture.needsUpdate = true
    }
    this.wasGlitching = glitching

    let level = this.brightness
    if (this.pulse) level *= 1 + analysis.levels.bass * 0.25
    if (this.flicker) {
      if (this.flickerTime <= 0 && Math.random() < FLICKER_CHANCE * delta) {
        this.flickerTime = 0.1 + Math.random() * 0.4
      }
      if (this.flickerTime > 0) {
        this.flickerTime -= delta
        level *= Math.random() < 0.5 ? 0.25 : 0.8
      }
    }
    if (glitching && this.surging) {
      // Overload flash for the first part, then a flickering brownout.
      const progress = 1 - this.glitchTime / this.glitchLength
      level *= progress < 0.3 ? 2.5 + Math.random() : 0.1 + Math.random() * 0.35
    } else if (glitching) {
      level *= 0.6 + Math.random() * 0.8 // brightness stutter
    }
    this.material.color.setScalar(level)
  }
}
