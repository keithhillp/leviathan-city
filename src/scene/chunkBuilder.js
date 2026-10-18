import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { CELLS } from './textures.js'
import { FLOOR_H, STREET, WINDOW_W, streamFor } from './plan.js'

// Geometry for one chunk of the city plan (plan.js). No DOM here, so it runs
// in the chunk worker (chunkWorker.js) as well as on the main thread.

const LAMP_SPACING = 22

function solidColor(geometry, color) {
  const count = geometry.attributes.position.count
  const colors = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) color.toArray(colors, i * 3)
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return geometry
}

function box(w, h, d, x, y, z) {
  return new THREE.BoxGeometry(w, h, d).translate(x, y, z)
}

// Places geometry built round the origin at a lot or block: turned by its
// `angle`, then moved to its centre (x, z) and lifted by `y`.
const place = (geometry, { x, z, angle = 0 }, y = 0) => geometry.rotateY(angle).translate(x, y, z)

// Box whose side UVs are scaled so window cells keep a real-world size.
function facadeGeometry(lot) {
  const { w, d, floors, uv: [u, v], tint } = lot
  const h = floors * FLOOR_H
  const geometry = new THREE.BoxGeometry(w, h, d)
  const uv = geometry.attributes.uv
  const offsetU = Math.floor(u * CELLS) / CELLS
  const offsetV = Math.floor(v * CELLS) / CELLS

  // BoxGeometry faces, 4 vertices each: +x, -x, +y, -y, +z, -z
  for (let face = 0; face < 6; face++) {
    const span = face < 2 ? d : w
    for (let i = face * 4; i < face * 4 + 4; i++) {
      if (face === 2 || face === 3) {
        uv.setXY(i, 0.001, 0.001)
      } else {
        uv.setXY(
          i,
          offsetU + (uv.getX(i) * span) / (CELLS * WINDOW_W),
          offsetV + (uv.getY(i) * h) / (CELLS * FLOOR_H),
        )
      }
    }
  }
  return solidColor(place(geometry, lot, h / 2), new THREE.Color().setHSL(...tint))
}

// A lot's roof clutter, which is placed relative to the lot.
function addRoofClutter(geometries, lot) {
  for (const item of lot.clutter) {
    const parts = []
    if (item.kind === 'box') {
      parts.push(box(item.w, item.h, item.d, item.x, item.y, item.z))
    } else if (item.kind === 'tank') {
      // Water tank on legs
      parts.push(new THREE.CylinderGeometry(1.6, 1.6, 3, 10).translate(item.x, item.y + 4, item.z))
      parts.push(box(2.6, 2.5, 0.2, item.x, item.y + 1.25, item.z))
    } else if (item.kind === 'antenna') {
      parts.push(new THREE.CylinderGeometry(0.06, 0.1, item.h, 4).translate(item.x, item.y + item.h / 2, item.z))
    }
    for (const part of parts) geometries.push(place(part, lot))
  }
}

// A street lamp at (x, z) with its arm reaching towards `arm` ([x, z], unit).
function addLamp(geometries, bulbs, x, z, [ax, az]) {
  const lamp = { x, z, angle: Math.atan2(-az, ax) } // built with the arm along +x
  geometries.push(place(new THREE.CylinderGeometry(0.1, 0.16, 7, 6).translate(0, 3.5, 0), lamp))
  geometries.push(place(box(1.8, 0.12, 0.12, 0.9, 6.9, 0), lamp))
  geometries.push(place(box(0.9, 0.22, 0.9, 1.8, 6.85, 0), lamp))
  bulbs.push(place(box(0.6, 0.05, 0.6, 1.8, 6.72, 0), lamp))
}

// Lamps along both kerbs of each of `edges` that has them, clear of the
// crossings at either end and anywhere the plan keeps clear. Positions keep to
// one lattice per street line (with the two kerbs staggered), so lamps line up
// from one edge to the next.
function placeLamps(plan, edges, plainGeometries, bulbGeometries) {
  const { nodes } = plan.roads
  const curb = STREET / 2 - 0.4
  for (const edge of edges) {
    if (!edge.lamps) continue
    let [a, b] = [nodes[edge.a], nodes[edge.b]]
    // One direction per line, whichever way the edge was made: towards +x
    // (or +z for lines along z).
    if (b.x - a.x < -1e-6 || (Math.abs(b.x - a.x) <= 1e-6 && b.z < a.z)) [a, b] = [b, a]
    const length = Math.hypot(b.x - a.x, b.z - a.z)
    const dx = (b.x - a.x) / length
    const dz = (b.z - a.z) / length
    const [nx, nz] = [dz, -dx] // across the street
    // Distance along the line from the point on it nearest the world origin.
    const ta = a.x * dx + a.z * dz
    const start = ta + plan.crossingClear(a)
    const end = ta + length - plan.crossingClear(b)
    for (const side of [-1, 1]) {
      const stagger = side > 0 ? 0 : LAMP_SPACING / 2
      for (let t = stagger + Math.ceil((start - stagger) / LAMP_SPACING) * LAMP_SPACING; t <= end; t += LAMP_SPACING) {
        const x = a.x + (t - ta) * dx + side * curb * nx
        const z = a.z + (t - ta) * dz + side * curb * nz
        if (plan.blocked(x, z, 2)) continue
        addLamp(plainGeometries, bulbGeometries, x, z, [-side * nx, -side * nz])
      }
    }
  }
}

// Every mesh of one chunk, merged by material: `facades` (one per facade
// texture variant, null where unused), `plain` (sidewalks, roof clutter, lamp
// posts, sign frames), `bulbs` and `signs` (each null if empty). `signs` is a
// SignLayout (signs.js); `facadeVariants` how many facade textures there are.
export function buildChunkGeometry(plan, chunk, { signs, facadeVariants }) {
  const facadeGeometries = Array.from({ length: facadeVariants }, () => [])
  const plainGeometries = []
  const bulbGeometries = []
  const quads = []
  for (const block of chunk.blocks) plainGeometries.push(place(box(block.w, 0.2, block.d, 0, 0, 0), block, 0.1)) // sidewalk
  for (const lot of chunk.lots) {
    const { w, d, floors, faces } = lot
    facadeGeometries[lot.variant].push(facadeGeometry(lot))
    addRoofClutter(plainGeometries, lot)
    // Signs are laid out round the origin, then placed with the lot.
    const out = { rng: streamFor(plan.seed, `signs:${lot.key}`), quads: [], structure: [] }
    signs.decorate({ x: 0, z: 0, w, d, height: floors * FLOOR_H, faces }, out, FLOOR_H)
    for (const quad of out.quads) quads.push(place(quad, lot))
    for (const part of out.structure) plainGeometries.push(place(part, lot))
  }
  placeLamps(plan, chunk.edges, plainGeometries, bulbGeometries)

  const merge = (geometries) => {
    const merged = geometries.length ? mergeGeometries(geometries) : null
    for (const geometry of geometries) geometry.dispose()
    return merged
  }
  return {
    facades: facadeGeometries.map(merge),
    plain: merge(plainGeometries),
    bulbs: merge(bulbGeometries),
    signs: merge(quads),
  }
}

// Chunk geometry as plain arrays, to post from the worker; `transfer` lists
// their buffers so they move rather than copy.
export function toTransfer(geometries) {
  const transfer = []
  const pack = (geometry) => {
    if (!geometry) return null
    const attributes = {}
    for (const [name, { array, itemSize, normalized }] of Object.entries(geometry.attributes)) {
      attributes[name] = { array, itemSize, normalized }
      transfer.push(array.buffer)
    }
    if (geometry.index) transfer.push(geometry.index.array.buffer)
    return { attributes, index: geometry.index?.array ?? null }
  }
  const data = {
    facades: geometries.facades.map(pack),
    plain: pack(geometries.plain),
    bulbs: pack(geometries.bulbs),
    signs: pack(geometries.signs),
  }
  return { data, transfer }
}

// Back from toTransfer()'s arrays to chunk geometry.
export function fromTransfer(data) {
  const unpack = (packed) => {
    if (!packed) return null
    const geometry = new THREE.BufferGeometry()
    for (const [name, { array, itemSize, normalized }] of Object.entries(packed.attributes)) {
      geometry.setAttribute(name, new THREE.BufferAttribute(array, itemSize, normalized))
    }
    if (packed.index) geometry.setIndex(new THREE.BufferAttribute(packed.index, 1))
    return geometry
  }
  return {
    facades: data.facades.map(unpack),
    plain: unpack(data.plain),
    bulbs: unpack(data.bulbs),
    signs: unpack(data.signs),
  }
}
