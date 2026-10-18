import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { HIGHWAY, PITCH, SECTORS, SKYWAYS } from './plan.js'

// Geometry for the elevated roads (plan.js's SKYWAYS): the rings, the radials
// and the express decks above them, all on pillars. Built whole: always
// loaded, a few draw calls for the lot.

const DECK_THICKNESS = 1.2
const BARRIER = { height: 1.1, width: 0.4 }
const JUNCTION_GAP = SKYWAYS.half + 1 // barriers open this far either side of a road joining
const LAMP = { spacing: 60, height: 8, arm: 2.2, clear: 14 }
const MARKER_SPACING = 16
const DASH = { length: 3, gap: 9, width: 0.15 }
const PILLAR = 1.6
const STRAIGHT_STEP = PITCH / 2 // spacing of points along straight decks (plus where barriers open)...
const CURVE_STEPS = 12 // ...and how many round each corner
// Pillars stand just outside a deck over a street (on the pavement), or
// under the highway, whose corridor is clear.
const pillarOffset = (ring) => (ring?.highway ? 10 : SKYWAYS.half + 0.8)
const halfOf = (ring) => (ring?.highway ? HIGHWAY.half : SKYWAYS.half)

// A box `width` wide and `thickness` deep whose top runs from a to b
// ([x, y, z]), sloping if they're at different heights.
function slab(a, b, width, thickness) {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const dz = b[2] - a[2]
  const run = Math.hypot(dx, dz)
  return new THREE.BoxGeometry(Math.hypot(run, dy), thickness, width)
    .translate(0, -thickness / 2, 0)
    .rotateZ(Math.atan2(dy, run))
    .rotateY(Math.atan2(-dz, dx))
    .translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2)
}

const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z)

// A flat quad (two triangles) through the four corners given, in order round
// it, facing the way `normal` ([x, y, z]) says.
function quad(corners, normal) {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(corners.flat(), 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 2, 3].flatMap(() => normal), 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2))
  const [a, b, c] = corners
  const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
  const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
  const facing = (e1[1] * e2[2] - e1[2] * e2[1]) * normal[0] + (e1[2] * e2[0] - e1[0] * e2[2]) * normal[1] + (e1[0] * e2[1] - e1[1] * e2[0]) * normal[2]
  geometry.setIndex(facing >= 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2])
  return geometry
}

// A ring's centre line, all the way round: points { x, y, z, tx, tz (unit
// direction), u (across the sector, on the straight sides; null on the
// corners), sector, curve, arc (distance round from the start) }. The
// straight sides run round the octagon; each corner is a curve (the
// quadratic through the corner itself) from `cornerTrim` before it to
// `cornerTrim` after.
function ringLine(plan, { v, y }) {
  const reach = v * Math.tan(Math.PI / SECTORS)
  const straight = reach - SKYWAYS.cornerTrim
  const points = []
  plan.frames.forEach((frame, s) => {
    const next = plan.frames[(s + 1) % SECTORS]
    const [x0, z0] = frame.toWorld(0, v)
    const [x1, z1] = frame.toWorld(1, v)
    const [tx, tz] = [x1 - x0, z1 - z0]
    // Points along the straight side, and either side of where a road joins.
    const us = [-straight, 0, -JUNCTION_GAP, JUNCTION_GAP]
    for (let u = Math.ceil(-straight / STRAIGHT_STEP) * STRAIGHT_STEP; u < straight; u += STRAIGHT_STEP) us.push(u)
    for (const u of [...new Set(us)].sort((a, b) => a - b)) {
      const [x, z] = frame.toWorld(u, v)
      points.push({ x, y, z, tx, tz, u, sector: s })
    }
    const a = frame.toWorld(straight, v)
    const c = frame.toWorld(reach, v)
    const b = next.toWorld(-straight, v)
    for (let i = 0; i < CURVE_STEPS; i++) {
      const t = i / CURVE_STEPS
      const [p, q, r] = [(1 - t) ** 2, 2 * (1 - t) * t, t * t]
      const dx = (1 - t) * (c[0] - a[0]) + t * (b[0] - c[0])
      const dz = (1 - t) * (c[1] - a[1]) + t * (b[1] - c[1])
      const length = Math.hypot(dx, dz)
      points.push({
        x: p * a[0] + q * c[0] + r * b[0],
        y,
        z: p * a[1] + q * c[1] + r * b[1],
        tx: dx / length,
        tz: dz / length,
        u: null,
        sector: s,
        curve: t,
      })
    }
  })
  return withArcs(points, true)
}

// A straight line from a to b ([x, y, z]), as points like ringLine's.
function straightLine(a, b, step = STRAIGHT_STEP) {
  const run = Math.hypot(b[0] - a[0], b[2] - a[2])
  const [tx, tz] = [(b[0] - a[0]) / run, (b[2] - a[2]) / run]
  const count = Math.max(1, Math.round(run / step))
  const points = []
  for (let i = 0; i <= count; i++) {
    const t = i / count
    points.push({ x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, z: a[2] + (b[2] - a[2]) * t, tx, tz })
  }
  return withArcs(points, false)
}

function withArcs(points, closed) {
  let arc = 0
  points.forEach((point, i) => {
    point.arc = arc
    const next = points[i + 1] ?? (closed ? points[0] : point)
    arc += Math.hypot(next.x - point.x, next.z - point.z)
  })
  return { points, length: arc, closed }
}

// A point `arc` along a line, `offset` to its right, `lift` above its deck.
function along({ points, length, closed }, arc, offset, lift = 0) {
  if (closed) arc = ((arc % length) + length) % length
  let i = points.findIndex((point) => point.arc > arc) - 1
  if (i < 0) i = points.length - (closed ? 1 : 2)
  const p = points[i]
  const q = points[(i + 1) % points.length]
  const span = (q.arc || length) - p.arc
  const t = span > 0 ? Math.min(1, (arc - p.arc) / span) : 0
  return [
    p.x + (q.x - p.x) * t - p.tz * offset,
    p.y + (q.y - p.y) * t + lift,
    p.z + (q.z - p.z) * t + p.tx * offset,
  ]
}

// A band following `points` between `from` and `to` (offsets to the right
// of the line), its top `lift` above each point's height and `thickness`
// deep: top, bottom and both sides. `closed` joins the last point back to
// the first.
function ribbon(points, from, to, lift, thickness, closed = false) {
  const positions = []
  const normals = []
  const uvs = []
  const indices = []
  // Four faces, each a strip of two vertices per point: [offset, depth] pairs.
  const faces = [
    { a: [from, 0], b: [to, 0], normal: () => [0, 1, 0] },
    { a: [to, thickness], b: [from, thickness], normal: () => [0, -1, 0] },
    { a: [from, thickness], b: [from, 0], normal: (rx, rz) => [-rx, 0, -rz] },
    { a: [to, 0], b: [to, thickness], normal: (rx, rz) => [rx, 0, rz] },
  ]
  const count = points.length
  faces.forEach((face, f) => {
    for (const { x, y, z, tx, tz, arc } of points) {
      const [rx, rz] = [-tz, tx]
      for (const [offset, depth] of [face.a, face.b]) {
        positions.push(x + rx * offset, y + lift - depth, z + rz * offset)
        normals.push(...face.normal(rx, rz))
        uvs.push(arc / 10, offset === face.a[0] ? 0 : 1)
      }
    }
    const base = f * count * 2
    // Wind the triangles so they face the way the face's normal does.
    const vertex = (i) => positions.slice(i * 3, i * 3 + 3)
    const [p0, q0, r0] = [vertex(base), vertex(base + 1), vertex(base + 2)]
    const [e1, e2] = [r0.map((c, k) => c - p0[k]), q0.map((c, k) => c - p0[k])]
    const facing = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]
    const flip = facing.reduce((sum, c, k) => sum + c * normals[base * 3 + k], 0) < 0
    const segments = closed ? count : count - 1
    for (let i = 0; i < segments; i++) {
      const j = (i + 1) % count
      const [p, q, r, s] = [base + i * 2, base + i * 2 + 1, base + j * 2, base + j * 2 + 1]
      if (flip) indices.push(p, q, r, q, s, r)
      else indices.push(p, r, q, q, r, s)
    }
  })
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  return geometry
}

// `structure` (decks, pillars, barriers, lamp posts), `bulbs`, `markers`
// (red lights along the decks' sides) and `markings` (lane markings).
export function createSkywayGeometry(plan) {
  const { rings, tower, express } = SKYWAYS
  const { radials } = plan.skyways
  const structure = []
  const bulbs = []
  const markers = []
  const markings = []

  // Everything along a deck's line: the deck, barriers (left open over
  // `gaps`: points where another road joins, by side), red markers along
  // both sides, lane markings and lamps down the middle (`lamps` says where).
  function deck(line, half, laneOffsets, { gaps = () => false, lamps = () => true } = {}) {
    const { points, length, closed } = line
    structure.push(ribbon(points, -half, half, 0, DECK_THICKNESS, closed))
    for (const side of [-1, 1]) {
      // Barrier runs: stretches of points not in a gap on this side.
      let run = []
      const flush = () => {
        if (run.length > 1) {
          const [a, b] = [side * (half - BARRIER.width), side * half]
          structure.push(ribbon(run, Math.min(a, b), Math.max(a, b), BARRIER.height, BARRIER.height))
        }
        run = []
      }
      const start = closed ? Math.max(0, points.findIndex((point) => gaps(point, side))) : 0
      for (let k = 0; k <= points.length - (closed ? 0 : 1); k++) {
        const point = points[(start + k) % points.length]
        if (gaps(point, side)) flush()
        else run.push(point)
      }
      flush()
      // Red lights on the deck's side: small squares facing out.
      for (let arc = 0; arc < length; arc += MARKER_SPACING) {
        const [a, b] = [along(line, arc - 0.2, side * (half + 0.05)), along(line, arc + 0.2, side * (half + 0.05))]
        const out = [b[2] - a[2], 0, -(b[0] - a[0])].map((c) => (c * side) / 0.4)
        const [lo, hi] = [-DECK_THICKNESS / 2 - 0.1, -DECK_THICKNESS / 2 + 0.1]
        markers.push(quad([[a[0], a[1] + lo, a[2]], [b[0], b[1] + lo, b[2]], [b[0], b[1] + hi, b[2]], [a[0], a[1] + hi, a[2]]], out))
      }
      for (let lane = 1; lane < laneOffsets.length; lane++) {
        const offset = (side * (laneOffsets[lane - 1] + laneOffsets[lane])) / 2
        const [l, r] = [offset - DASH.width / 2, offset + DASH.width / 2]
        for (let arc = 0; arc + DASH.length < length; arc += DASH.length + DASH.gap) {
          const end = arc + DASH.length
          markings.push(quad([along(line, arc, l, 0.03), along(line, arc, r, 0.03), along(line, end, r, 0.03), along(line, end, l, 0.03)], [0, 1, 0]))
        }
      }
    }
    for (let arc = LAMP.spacing / 2; arc < length; arc += LAMP.spacing) {
      const base = along(line, arc, 0)
      if (!lamps(base, arc)) continue
      const [x, y, z] = base
      structure.push(box(0.3, LAMP.height, 0.3, x, y + LAMP.height / 2, z))
      for (const side of [-1, 1]) {
        const arm = along(line, arc, side * LAMP.arm, LAMP.height)
        structure.push(slab([x, y + LAMP.height, z], arm, 0.15, 0.15))
        bulbs.push(box(0.7, 0.06, 0.7, arm[0], arm[1] - 0.2, arm[2]))
      }
    }
  }
  const pillar = (x, z, top) => structure.push(box(PILLAR, top - DECK_THICKNESS, PILLAR, x, (top - DECK_THICKNESS) / 2, z))

  // The rings.
  rings.forEach((ring, r) => {
    const line = ringLine(plan, ring)
    const half = halfOf(ring)
    const offsets = ring.highway ? HIGHWAY.laneOffsets : SKYWAYS.laneOffsets
    // Where a radial or express deck joins, from the inside (-1) or outside (+1).
    const joins = (sector, side) => {
      const { reach, express: hasExpress } = radials[sector]
      if (side < 0) return r < reach || (r === rings.length - 1 && hasExpress)
      return r < reach - 1
    }
    deck(line, half, offsets, {
      gaps: (point, side) => point.u !== null && Math.abs(point.u) < JUNCTION_GAP && joins(point.sector, side),
      lamps: (base, arc) => {
        const point = line.points.find((p) => p.arc >= arc) ?? line.points[0]
        return point.u !== null && Math.abs(point.u) > LAMP.clear
      },
    })
    // Pillars midway between the streets below, and under the bends.
    const straight = ring.v * Math.tan(Math.PI / SECTORS) - SKYWAYS.cornerTrim
    for (const frame of plan.frames) {
      for (let u = PITCH / 2 - Math.ceil(straight / PITCH) * PITCH; u < straight - 2; u += PITCH) {
        if (u < -straight + 2) continue
        for (const side of [-1, 1]) pillar(...frame.toWorld(u, ring.v + side * pillarOffset(ring)), ring.y)
      }
    }
    for (const point of line.points) {
      if (point.curve !== 0.25 && point.curve !== 0.75) continue
      for (const side of [-1, 1]) {
        const offset = side * pillarOffset(ring)
        pillar(point.x - point.tz * offset, point.z + point.tx * offset, ring.y)
      }
    }
  })

  // Radials and express decks, up each sector's avenue.
  plan.frames.forEach((frame, s) => {
    const { reach, express: hasExpress } = radials[s]
    const at = (v, y) => {
      const [x, z] = frame.toWorld(0, v)
      return [x, y, z]
    }
    // Heights along the radial: the tower, then each ring it meets.
    const stops = [{ v: tower.v, y: tower.radialY }, ...rings.slice(0, reach)]
    const radialY = (v) => {
      for (let i = 1; i < stops.length; i++) {
        if (v <= stops[i].v) return stops[i - 1].y + ((stops[i].y - stops[i - 1].y) * (v - stops[i - 1].v)) / (stops[i].v - stops[i - 1].v)
      }
      return null
    }
    const expressY = (v) => {
      if (!hasExpress || v < tower.v) return null
      if (v <= express.descend) return express.y
      const last = rings.at(-1)
      return v > last.v ? null : express.y + ((last.y - express.y) * (v - express.descend)) / (last.v - express.descend)
    }
    // Radial decks between the rings, stopping at each ring's edge.
    for (let i = 1; i < stops.length; i++) {
      const v0 = i === 1 ? tower.v : stops[i - 1].v + halfOf(stops[i - 1])
      const v1 = stops[i].v - halfOf(stops[i])
      deck(straightLine(at(v0, radialY(v0)), at(v1, radialY(v1))), SKYWAYS.half, SKYWAYS.laneOffsets)
    }
    if (hasExpress) {
      const last = rings.at(-1)
      const end = last.v - halfOf(last)
      deck(straightLine(at(tower.v, express.y), at(express.descend, express.y)), SKYWAYS.half, SKYWAYS.laneOffsets)
      deck(straightLine(at(express.descend, express.y), at(end, expressY(end))), SKYWAYS.half, SKYWAYS.laneOffsets)
    }
    // Pillars along the avenue, midway between cross streets, as tall as the
    // highest deck above (clear of the rings, and of the plaza round the tower).
    for (let v = PITCH / 2 + (((-plan.hub.z % PITCH) + PITCH) % PITCH); v < rings.at(-1).v; v += PITCH) {
      if (v < plan.rings.crown || rings.some((ring) => Math.abs(v - ring.v) < halfOf(ring) + PILLAR)) continue
      const top = Math.max(radialY(v) ?? 0, expressY(v) ?? 0)
      if (!top) continue
      for (const side of [-1, 1]) {
        const [x, z] = frame.toWorld(side * (SKYWAYS.half + 0.8), v)
        pillar(x, z, top)
      }
    }
  })

  const merge = (list) => {
    const merged = mergeGeometries(list)
    for (const geometry of list) geometry.dispose()
    return merged
  }
  return { structure: merge(structure), bulbs: merge(bulbs), markers: merge(markers), markings: merge(markings) }
}
