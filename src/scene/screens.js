import * as THREE from 'three'

const PX_PER_UNIT = 22
const MAX_PX = 1024
const LED_PITCH = 3 // px per LED cell in the overlay
const FLICKER_CHANCE = 0.15 // per second, for screens with `flicker`

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
    this.material = new THREE.MeshBasicMaterial({ map: this.texture })
    this.material.color.setScalar(brightness)
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), this.material)
  }

  get glow() {
    return this.content.glow
  }

  update(delta, elapsed, analysis) {
    const { width, height } = this.canvas
    if (this.content.draw(this.bufferCtx, width, height, delta, elapsed, analysis)) {
      this.ctx.drawImage(this.buffer, 0, 0)
      this.ctx.drawImage(this.grime, 0, 0)
      this.texture.needsUpdate = true
    }

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
    this.material.color.setScalar(level)
  }
}
