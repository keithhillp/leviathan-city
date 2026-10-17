import * as THREE from 'three'
import { BANDS } from './audioField.js'

// One texture tile is CELLS x CELLS windows. The bottom-left pixel of every
// cell is bare wall, which roofs and clutter sample via uv (0.001, 0.001).
export const CELLS = 8
const CELL_PX = 64

const LIT_COLORS = ['#ffb45a', '#ffc978', '#ffe0a8', '#d6eedc', '#b8d4dc']
const TRIGGER_COLORS = [...LIT_COLORS, '#9fe8ff', '#c8ffd8']
// Share of dark windows that switch on when their band gets loud enough;
// the rest stay dark.
const TRIGGER_CHANCE = 0.75
const MIN_THRESHOLD = 0.3
const MAX_THRESHOLD = 0.75

function makeCanvas(size) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  return canvas
}

function toTexture(canvas) {
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  return texture
}

function makeFacade(rng, litChance) {
  const size = CELLS * CELL_PX
  const colorCanvas = makeCanvas(size)
  const glowCanvas = makeCanvas(size)
  const triggerCanvas = makeCanvas(size)
  const bandCanvas = makeCanvas(size)
  const c = colorCanvas.getContext('2d')
  const g = glowCanvas.getContext('2d')
  const t = triggerCanvas.getContext('2d')
  const b = bandCanvas.getContext('2d')

  c.fillStyle = '#9a9a96'
  c.fillRect(0, 0, size, size)
  for (const ctx of [g, t]) {
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, size, size)
  }

  // Water stains running down the concrete.
  for (let i = 0; i < 260; i++) {
    c.fillStyle = `rgba(20, 24, 22, ${rng() * 0.12})`
    c.fillRect(rng() * size, rng() * size, 1 + rng() * 4, rng() * CELL_PX * 3)
  }

  for (let row = 0; row < CELLS; row++) {
    const floorOccupied = rng() < 0.75
    for (let col = 0; col < CELLS; col++) {
      const x = col * CELL_PX + 10
      const y = row * CELL_PX + 14
      const w = CELL_PX - 20
      const h = CELL_PX - 26

      c.fillStyle = '#5c5f5c'
      c.fillRect(x - 3, y + h, w + 6, 4) // sill
      c.fillStyle = rng() < 0.15 ? '#252b30' : '#161b20'
      c.fillRect(x, y, w, h)

      // Audio data per cell, read by the window shader: red = band,
      // green = trigger threshold. Math.random keeps the seeded layout
      // unchanged.
      const band = Math.floor(Math.random() * BANDS) / (BANDS - 1)
      let threshold = 0

      if (floorOccupied && rng() < litChance) {
        const color = LIT_COLORS[Math.floor(rng() * LIT_COLORS.length)]
        const blind = rng() < 0.4 ? h * (0.2 + rng() * 0.5) : 0
        for (const ctx of [c, g]) {
          ctx.globalAlpha = 0.55 + rng() * 0.45
          ctx.fillStyle = color
          ctx.fillRect(x, y + blind, w, h - blind)
          ctx.globalAlpha = 1
        }
        // Window mullion
        c.fillStyle = g.fillStyle = '#111'
        c.fillRect(x + w / 2 - 1, y, 2, h)
        g.fillRect(x + w / 2 - 1, y, 2, h)
      } else if (Math.random() < TRIGGER_CHANCE) {
        threshold = MIN_THRESHOLD + Math.random() * (MAX_THRESHOLD - MIN_THRESHOLD)
        t.fillStyle = TRIGGER_COLORS[Math.floor(Math.random() * TRIGGER_COLORS.length)]
        t.fillRect(x, y, w, h)
        t.fillStyle = '#000'
        t.fillRect(x + w / 2 - 1, y, 2, h)
      }

      b.fillStyle = `rgb(${Math.round(band * 255)}, ${Math.round(threshold * 255)}, 0)`
      b.fillRect(col * CELL_PX, row * CELL_PX, CELL_PX, CELL_PX)
    }
  }

  const bandMap = new THREE.CanvasTexture(bandCanvas) // data, so no colour space
  bandMap.wrapS = bandMap.wrapT = THREE.RepeatWrapping
  return {
    map: toTexture(colorCanvas),
    emissiveMap: toTexture(glowCanvas),
    triggerMap: toTexture(triggerCanvas),
    bandMap,
  }
}

export function createFacadeTextures(rng, maxAnisotropy) {
  return [0.12, 0.22, 0.35].map((litChance) => {
    const textures = makeFacade(rng, litChance)
    textures.map.anisotropy = maxAnisotropy
    textures.emissiveMap.anisotropy = textures.triggerMap.anisotropy = maxAnisotropy
    return textures
  })
}
