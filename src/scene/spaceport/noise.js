// Small value-noise helpers for the procedural planet and terrain textures.

function hash3(x, y, z) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

const fade = (t) => t * t * (3 - 2 * t)
const lerp = (a, b, t) => a + (b - a) * t

// Smooth noise in 0..1.
export function noise3(x, y, z) {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const zi = Math.floor(z)
  const u = fade(x - xi)
  const v = fade(y - yi)
  const w = fade(z - zi)
  const corner = (dx, dy, dz) => hash3(xi + dx, yi + dy, zi + dz)
  return lerp(
    lerp(lerp(corner(0, 0, 0), corner(1, 0, 0), u), lerp(corner(0, 1, 0), corner(1, 1, 0), u), v),
    lerp(lerp(corner(0, 0, 1), corner(1, 0, 1), u), lerp(corner(0, 1, 1), corner(1, 1, 1), u), v),
    w,
  )
}

// Fractal noise in roughly 0..1: `octaves` layers, each twice as fine and half as strong.
export function fbm3(x, y, z, octaves = 5) {
  let sum = 0
  let amplitude = 0.5
  let total = 0
  for (let i = 0; i < octaves; i++) {
    sum += noise3(x, y, z) * amplitude
    total += amplitude
    x *= 2.03
    y *= 2.03
    z *= 2.03
    amplitude *= 0.5
  }
  return sum / total
}

export const fbm2 = (x, y, octaves) => fbm3(x, y, 0.5, octaves)
