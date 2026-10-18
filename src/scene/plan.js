// The city as data: the street network, the blocks, and every building with all
// of its random choices made, worked out before any geometry is built (city.js
// builds from this). No three.js here, so it can move into a worker later.

import { hashString, mulberry32 } from './random.js'

export const BLOCK = 30
export const STREET = 14
export const PITCH = BLOCK + STREET // a block and a street
export const FLOOR_H = 3.5
export const WINDOW_W = 3
const SIDEWALK_INSET = 3 // lots sit this far inside the block's edge
// The city is built and streamed in square chunks this size.
export const CHUNK = 4 * PITCH

// Every random choice for a place comes from its own stream, keyed on the seed
// and where it is, so it comes out the same whatever else changes or whichever
// order things are built in.
export const streamFor = (seed, key) => mulberry32(hashString(`${seed}:${key}`))

// The city is an octagon round the hub, where Leviathan Labs stands, cut into
// eight sectors like slices of a pie. Each sector has its own street grid,
// squared up with the avenue down its middle, so every sector's avenue leads
// to the hub. Sector 0 is the south one (towards +z), whose grid is the world
// grid the square is built on.
//
// In a sector, `v` is distance out from the hub along its avenue and `u` is
// across it. A ring at v = r is an octagon with its sides r from the hub.
export const HUB = { x: 0, z: -640 }
export const SECTORS = 8
const HALF_WEDGE = Math.PI / SECTORS
const TAN_HALF = Math.tan(HALF_WEDGE)
// Cross streets sit at v = GRID_OFFSET + k * PITCH, which keeps the south
// sector's streets on the world grid (z = k * PITCH).
const GRID_OFFSET = ((-HUB.z % PITCH) + PITCH) % PITCH
export const RINGS = {
  crown: GRID_OFFSET + 3 * PITCH, // boulevard round the tower's plaza
  highway: GRID_OFFSET + 11 * PITCH, // the elevated ring highway, just behind the square's tower
  rail: -10 - HUB.z, // the outer rail loop: its south side is the square's bridge (z = -10)
  edge: GRID_OFFSET + 22 * PITCH, // the city's edge
}
// The ring highway: the widest of the elevated roads, a deck `y` up on
// pillars, with three lanes each way (`laneOffsets` from its centre line,
// inside first).
export const HIGHWAY = {
  y: 22,
  half: 13, // deck half width
  laneOffsets: [3, 6.6, 10.2],
}
// All traffic runs on elevated roads ("skyways"). Rings round the hub at
// different heights, each above a cross street (`v` from the hub); radials up
// the sectors' avenues, rising and falling to meet each ring at its height on
// their way in to the tower; and express decks stacked above the radials,
// flying over every ring but the outermost, which they come down to meet.
// Radials and express decks end inside the tower's podium (`tower`), where
// traffic turns round out of sight. At the octagon's corners every ring
// curves round, starting `cornerTrim` before the corner.
export const SKYWAYS = {
  rings: [
    { v: GRID_OFFSET + 5 * PITCH, y: 58 },
    { v: GRID_OFFSET + 8 * PITCH, y: 38 },
    { v: RINGS.highway, y: HIGHWAY.y, highway: true },
    { v: GRID_OFFSET + 16 * PITCH, y: 30 },
    { v: GRID_OFFSET + 20 * PITCH, y: 60 }, // reached by the express decks
  ],
  radialRings: 4, // the radials meet the rings up to this many out
  half: 8, // deck half width: over a street, clear of the buildings either side
  laneOffsets: [2, 5.5],
  tower: { v: 60, radialY: 72, expressY: 90 },
  express: { y: 90, descend: GRID_OFFSET + 16 * PITCH }, // level until here, then down to the last ring
  cornerTrim: 30,
}
// Bands kept clear of buildings (half widths), for the highway and the rail.
const CORRIDORS = [
  { v: RINGS.highway, half: 16 },
  { v: RINGS.rail, half: 6 },
]
const SEAM_CLEAR = 10 // buildings keep this far from the roads along the seams
const CROSSING_CLEAR = STREET / 2 + 1 // lamps keep this far from a crossing...
const SEAM_CROSSING_CLEAR = 16 // ...and further from a slanted one on a seam

// Sector s: its avenue's direction from the hub, and conversions between its
// (u, v) and world (x, z). Its buildings are turned by `angle` about y.
function sectorFrame(s) {
  const angle = s * 2 * HALF_WEDGE
  const sin = Math.sin(angle)
  const cos = Math.cos(angle)
  return {
    s,
    angle,
    toWorld: (u, v) => [HUB.x + u * cos + v * sin, HUB.z - u * sin + v * cos],
    // A point's v in this sector.
    vOf: (x, z) => (x - HUB.x) * sin + (z - HUB.z) * cos,
  }
}
const FRAMES = Array.from({ length: SECTORS }, (_, s) => sectorFrame(s))

// The sector a world point is in.
function sectorAt(x, z) {
  const angle = Math.atan2(x - HUB.x, z - HUB.z) // 0 towards +z, increasing towards +x
  return FRAMES[(Math.round(angle / (2 * HALF_WEDGE)) + SECTORS) % SECTORS]
}

const overlaps = (b, x0, x1, z0, z1, margin) =>
  x1 > b.x0 - margin && x0 < b.x1 + margin && z1 > b.z0 - margin && z0 < b.z1 + margin
const smoothstep = (a, b, x) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1)
  return t * t * (3 - 2 * t)
}

// Floors for a lot `v` from the hub, from one random draw `r`: towers inside
// the ring highway, the old city's mix around the square, low sprawl beyond
// the rail loop, blended across each boundary.
function floorsAt(v, r) {
  const core = 20 + r ** 1.5 * 60
  const mid = 3 + r ** 2.2 * 26
  const outer = 2 + r ** 1.8 * 9
  const inner = core + (mid - core) * smoothstep(RINGS.highway - 40, RINGS.highway + 40, v)
  return Math.floor(inner + (outer - inner) * smoothstep(RINGS.rail + 20, RINGS.rail + 120, v))
}
const AVENUE_BOOST = 1.4 // lots on a sector's avenue rise higher: canyons leading to the hub

function concreteTint(rng) {
  return [0.2 + rng() * 0.3, 0.04 + rng() * 0.08, 0.26 + rng() * 0.2] // hsl
}

// Boxes, water tanks and antennas on a roof, relative to its centre (x along
// the lot's width, z along its depth).
function roofClutter(rng, w, d, h) {
  const clutter = []
  const count = Math.floor(rng() * 4)
  for (let i = 0; i < count; i++) {
    const s = 1 + rng() * 3
    const x = (rng() - 0.5) * (w - s)
    const z = (rng() - 0.5) * (d - s)
    clutter.push({ kind: 'box', x, z, y: h + 0.7, w: s, h: 0.8 + rng() * 1.5, d: s * (0.6 + rng()) })
  }
  if (rng() < 0.25) {
    // Water tank on legs
    clutter.push({ kind: 'tank', x: (rng() - 0.5) * (w - 4), z: (rng() - 0.5) * (d - 4), y: h })
  }
  if (rng() < 0.35) clutter.push({ kind: 'antenna', x: 0, z: 0, y: h, h: 4 + rng() * 10 })
  return clutter
}

// The same seed always gives the same city. `facadeVariants` is how many
// facade textures there are. Hand-built areas (`stamps`, like the hero square)
// are { id, bounds, buildings, roads, rail }: no generated buildings or
// streets go inside their bounds, and their own are added as they are.
export function createPlan({ seed, facadeVariants, stamps = [] }) {
  const reserved = stamps.map((stamp) => stamp.bounds)
  const inStamp = (x0, x1, z0, z1, margin = 0) => reserved.some((b) => overlaps(b, x0, x1, z0, z1, margin))
  const inCorridor = (v0, v1, margin = 0) =>
    CORRIDORS.some(({ v, half }) => v1 > v - half - margin && v0 < v + half + margin)
  // Whether a point is somewhere kept clear (a stamp, a corridor), within `margin`.
  const blocked = (x, z, margin = 0) => {
    if (inStamp(x, x, z, z, margin)) return true
    const v = sectorAt(x, z).vOf(x, z)
    return inCorridor(v, v, margin)
  }

  const roads = { nodes: [], edges: [] }
  const rail = { nodes: [], edges: [] }
  const blocks = []
  const lots = []

  // Street nodes, one per place: streets that meet there share it.
  const index = new Map()
  const nodeAt = (x, z, kind = 'junction') => {
    const key = `${Math.round(x * 4)},${Math.round(z * 4)}`
    if (!index.has(key)) {
      index.set(key, roads.nodes.length)
      roads.nodes.push({ id: roads.nodes.length, x, z, kind })
    }
    const id = index.get(key)
    if (kind === 'seam') roads.nodes[id].kind = 'seam'
    return id
  }

  // `rng` is the stream of the block (or stamp) the lot is in; `key` names the
  // lot, for the streams of things built on it later (its signs).
  const addLot = (rng, key, lot) => {
    lots.push({
      ...lot,
      id: lots.length,
      key,
      variant: Math.floor(rng() * facadeVariants),
      tint: concreteTint(rng),
      uv: [rng(), rng()], // where in the facade texture it starts
      clutter: roofClutter(rng, lot.w, lot.d, lot.floors * FLOOR_H),
    })
  }

  // Blocks of one sector: each a 1 or 2 by 1 or 2 grid of lots inside a
  // sidewalk. Lots are kept only if they're wholly inside the sector (clear of
  // the seam roads), between the crown and the edge, and out of the corridors
  // and stamps, so blocks along those are cut down to the lots that fit.
  function addSectorBlocks({ s, angle, toWorld }) {
    const usable = BLOCK - SIDEWALK_INSET * 2
    const [ca, sa] = [Math.abs(Math.cos(angle)), Math.abs(Math.sin(angle))]
    for (let k = 0; GRID_OFFSET + (k + 1) * PITCH <= RINGS.edge; k++) {
      const vLine = GRID_OFFSET + k * PITCH
      if (vLine < RINGS.crown) continue
      const vc = vLine + PITCH / 2 // block centre
      const across = Math.ceil(((vc + BLOCK / 2) * TAN_HALF) / PITCH)
      for (let i = -across; i < across; i++) {
        const uc = (i + 0.5) * PITCH
        const rng = streamFor(seed, `block:${s}:${i},${k}`)
        const splitsU = rng() < 0.6 ? 2 : 1
        const splitsV = rng() < 0.6 ? 2 : 1
        const lotW = usable / splitsU
        const lotD = usable / splitsV
        const kept = []
        for (let a = 0; a < splitsU; a++) {
          for (let b = 0; b < splitsV; b++) {
            const shrink = rng() < 0.3 ? WINDOW_W : 0
            const draw = rng()
            const u = uc - usable / 2 + lotW * (a + 0.5)
            const v = vc - usable / 2 + lotD * (b + 0.5)
            const w = lotW - shrink
            const d = lotD - shrink
            // Clear of the seams: the corner nearest one must be far enough from it.
            const nearV = v - d / 2
            if ((nearV * TAN_HALF - (Math.abs(u) + w / 2)) * Math.cos(HALF_WEDGE) < SEAM_CLEAR) continue
            if (nearV < RINGS.crown + STREET / 2 || v + d / 2 > RINGS.edge - STREET / 2) continue
            if (inCorridor(v - d / 2, v + d / 2)) continue
            const [x, z] = toWorld(u, v)
            const ex = (ca * w + sa * d) / 2
            const ez = (sa * w + ca * d) / 2
            if (inStamp(x - ex, x + ex, z - ez, z + ez)) continue
            const onAvenue = i === -1 || i === 0
            const floors = Math.max(2, Math.floor(floorsAt(v, draw) * (onAvenue ? AVENUE_BOOST : 1)))
            // Sides on the block's edge face a street; inner sides face neighbours.
            const faces = []
            if (a === 0) faces.push('-x')
            if (a === splitsU - 1) faces.push('+x')
            if (b === 0) faces.push('-z')
            if (b === splitsV - 1) faces.push('+z')
            kept.push({ a, b, u, v, x, z, w, d, floors, faces })
          }
        }
        if (!kept.length) continue
        // The sidewalk covers just the lots that were kept.
        const u0 = Math.min(...kept.map((l) => l.u - lotW / 2)) - SIDEWALK_INSET
        const u1 = Math.max(...kept.map((l) => l.u + lotW / 2)) + SIDEWALK_INSET
        const v0 = Math.min(...kept.map((l) => l.v - lotD / 2)) - SIDEWALK_INSET
        const v1 = Math.max(...kept.map((l) => l.v + lotD / 2)) + SIDEWALK_INSET
        const [bx, bz] = toWorld((u0 + u1) / 2, (v0 + v1) / 2)
        const block = blocks.push({ id: blocks.length, x: bx, z: bz, w: u1 - u0, d: v1 - v0, angle }) - 1
        for (const { a, b, u, ...lot } of kept) {
          addLot(rng, `${s}:${i},${k}:${a},${b}`, { ...lot, block, angle, sector: s })
        }
      }
    }
  }

  // Streets: each sector's grid lines (lengthways at fixed u, across at fixed
  // v) clipped to the sector between the crown and the edge, split at their
  // crossings. Ends that meet a seam join the road running along it.
  function addStreets() {
    // Streets stop short of stamps: any that would go into one is left out
    // (a stamp brings its own roads).
    const link = (a, b, kind) => {
      if (a === b) return
      const [na, nb] = [roads.nodes[a], roads.nodes[b]]
      const [x0, x1] = [Math.min(na.x, nb.x), Math.max(na.x, nb.x)]
      const [z0, z1] = [Math.min(na.z, nb.z), Math.max(na.z, nb.z)]
      if (reserved.some((r) => overlaps(r, x0, x1, z0, z1, -0.5))) return
      roads.edges.push({ id: roads.edges.length, a, b, kind, width: STREET, lamps: true })
    }
    const seams = Array.from({ length: SECTORS }, () => []) // seam j is between sectors j and j + 1
    const onSeam = (frame, u, v) => {
      const id = nodeAt(...frame.toWorld(u, v), 'seam')
      seams[(frame.s + (u > 0 ? 0 : SECTORS - 1)) % SECTORS].push(id)
      return id
    }
    const crossLines = []
    for (let k = 0; GRID_OFFSET + k * PITCH <= RINGS.edge; k++) {
      const v = GRID_OFFSET + k * PITCH
      if (v >= RINGS.crown) crossLines.push(v)
    }

    for (const frame of FRAMES) {
      const { toWorld } = frame
      // Across: from seam to seam (the crown and the edge are octagons).
      for (const v of crossLines) {
        const reach = v * TAN_HALF
        const points = [onSeam(frame, -reach, v)]
        for (let i = Math.ceil(-reach / PITCH); i * PITCH < reach; i++) {
          if (Math.abs(i * PITCH) < reach - 0.01) points.push(nodeAt(...toWorld(i * PITCH, v)))
        }
        points.push(onSeam(frame, reach, v))
        const kind = v === RINGS.crown || v === RINGS.edge ? 'boulevard' : 'street'
        for (let p = 1; p < points.length; p++) link(points[p - 1], points[p], kind)
      }
      // Lengthways: from the crown (or the seam, if it meets that first) out to
      // the edge. The middle one is the sector's avenue.
      const across = Math.ceil((RINGS.edge * TAN_HALF) / PITCH)
      for (let i = -across; i <= across; i++) {
        const u = i * PITCH
        const start = Math.abs(u) / TAN_HALF
        if (start >= RINGS.edge - 0.01) continue
        const points = []
        if (start > RINGS.crown + 0.01) points.push(onSeam(frame, u, start))
        for (const v of crossLines) if (v > start + 0.01) points.push(nodeAt(...toWorld(u, v)))
        for (let p = 1; p < points.length; p++) link(points[p - 1], points[p], i === 0 ? 'avenue' : 'street')
      }
    }
    // Along each seam, its nodes in order out from the hub.
    const fromHub = (id) => Math.hypot(roads.nodes[id].x - HUB.x, roads.nodes[id].z - HUB.z)
    for (const ids of seams) {
      const sorted = [...new Set(ids)].sort((a, b) => fromHub(a) - fromHub(b))
      for (let p = 1; p < sorted.length; p++) link(sorted[p - 1], sorted[p], 'seam')
    }
    addSkyways()
  }

  // The elevated roads (see SKYWAYS), as `elevated` edges with nodes of their
  // own, separate from the streets'. Each ring has a node where each radial or
  // express deck meets it, and ones where it starts and ends each bend round a
  // corner; a `curve` edge round each bend has no lanes of its own (the lanes
  // either side join on round it), nor has a `link` between the ends of a
  // radial and an express deck inside the tower. A radial or express deck
  // that would cross a stamp (the square) is left out there.
  function addSkyways() {
    const { rings, radialRings, tower, express } = SKYWAYS
    const node = (x, z, y, kind) => roads.nodes.push({ id: roads.nodes.length, x, z, y, kind }) - 1
    const edge = (a, b, kind, width, extra = {}) =>
      roads.edges.push({ id: roads.edges.length, a, b, kind, width, elevated: true, ...extra })
    const crosses = ({ toWorld }, v0, v1) => {
      const [[x0, z0], [x1, z1]] = [toWorld(0, v0), toWorld(0, v1)]
      return inStamp(Math.min(x0, x1), Math.max(x0, x1), Math.min(z0, z1), Math.max(z0, z1))
    }

    // Which rings each sector's radial reaches (in from the tower until a
    // stamp's in the way), and whether it has an express deck.
    const radials = FRAMES.map((frame) => {
      let reach = 0
      let from = tower.v
      while (reach < radialRings && !crosses(frame, from, rings[reach].v)) from = rings[reach++].v
      return { reach, express: !crosses(frame, tower.v, rings.at(-1).v) }
    })

    // Rings: a node where a radial or express deck meets each side.
    const junctions = rings.map(() => [])
    rings.forEach((ring, r) => {
      const straight = ring.v * TAN_HALF - SKYWAYS.cornerTrim
      const kind = ring.highway ? 'highway' : 'skyway'
      const width = (ring.highway ? HIGHWAY.half : SKYWAYS.half) * 2
      const ends = FRAMES.map(({ toWorld }) => [
        node(...toWorld(-straight, ring.v), ring.y, 'bend'),
        node(...toWorld(straight, ring.v), ring.y, 'bend'),
      ])
      for (const frame of FRAMES) {
        const { s, toWorld } = frame
        const met = r < radials[s].reach || (r === rings.length - 1 && radials[s].express)
        const points = [ends[s][0]]
        if (met) points.push((junctions[r][s] = node(...toWorld(0, ring.v), ring.y, 'junction')))
        points.push(ends[s][1])
        for (let p = 1; p < points.length; p++) edge(points[p - 1], points[p], kind, width, { ring: r, sector: s })
        edge(ends[s][1], ends[(s + 1) % SECTORS][0], kind, width, { ring: r, curve: true })
      }
    })

    // Radials, and express decks, from inside the tower outwards.
    for (const frame of FRAMES) {
      const { s, toWorld } = frame
      const width = SKYWAYS.half * 2
      const { reach, express: hasExpress } = radials[s]
      const inside = node(...toWorld(0, tower.v), tower.radialY, 'tower')
      let last = inside
      for (let r = 0; r < reach; r++) {
        edge(last, junctions[r][s], 'radial', width, { sector: s })
        last = junctions[r][s]
      }
      if (hasExpress) {
        const start = node(...toWorld(0, tower.v), tower.expressY, 'tower')
        const top = node(...toWorld(0, express.descend), express.y, 'bend')
        edge(start, top, 'express', width, { sector: s })
        edge(top, junctions[rings.length - 1][s], 'express', width, { sector: s })
        // Inside the tower, out of sight, traffic can go up or down between them.
        edge(inside, start, 'inside', width, { link: true })
      }
    }
    skyways.radials = radials
  }
  const skyways = { radials: [] }

  for (const frame of FRAMES) addSectorBlocks(frame)
  addStreets()

  for (const stamp of stamps) {
    // A stamp's roads join the streets where their ends meet them.
    for (const { a, b, ...rest } of stamp.roads ?? []) {
      roads.edges.push({ id: roads.edges.length, a: nodeAt(...a), b: nodeAt(...b), stamp: stamp.id, ...rest })
    }
    addLines(rail, stamp.rail ?? [], stamp.id)
    const rng = streamFor(seed, `stamp:${stamp.id}`)
    stamp.buildings?.forEach(({ x0, x1, z0, z1, floors }, i) => {
      const lot = { stamp: stamp.id, angle: 0, x: (x0 + x1) / 2, z: (z0 + z1) / 2, w: x1 - x0, d: z1 - z0, floors, faces: [] }
      addLot(rng, `${stamp.id}:${i}`, lot)
    })
  }

  // The ring highway and outer rail loop to come, as octagons' corners.
  const octagon = (r) => FRAMES.map(({ toWorld }) => toWorld(r * TAN_HALF, r))
  const radius = RINGS.edge / Math.cos(HALF_WEDGE) + STREET
  return {
    seed,
    hub: HUB,
    rings: RINGS,
    frames: FRAMES,
    corridors: { highway: octagon(RINGS.highway), rail: octagon(RINGS.rail) },
    skyways,
    bounds: { x0: HUB.x - radius, x1: HUB.x + radius, z0: HUB.z - radius, z1: HUB.z + radius },
    roads,
    rail,
    blocks,
    lots,
    stamps,
    chunks: chunkUp(blocks, lots, roads),
    blocked,
    // How far lamps keep from a crossing at `node`.
    crossingClear: (node) => (node.kind === 'seam' ? SEAM_CROSSING_CLEAR : CROSSING_CLEAR),
  }
}

// Adds a stamp's own rail lines ({ a: [x, z], b: [x, z], ...rest }) to a
// network as edges between new nodes.
function addLines(network, lines, stamp) {
  for (const { a, b, ...rest } of lines) {
    const na = network.nodes.push({ id: network.nodes.length, x: a[0], z: a[1] }) - 1
    const nb = network.nodes.push({ id: network.nodes.length, x: b[0], z: b[1] }) - 1
    network.edges.push({ id: network.edges.length, a: na, b: nb, stamp, ...rest })
  }
}

// How far a box `w` by `d` turned by `angle` reaches along x and z.
export function extents({ w, d, angle = 0 }) {
  const c = Math.abs(Math.cos(angle))
  const s = Math.abs(Math.sin(angle))
  return [(c * w + s * d) / 2, (s * w + c * d) / 2]
}

// Sorts blocks, lots and street edges into chunks by where their centres are.
// A chunk's `bounds` cover everything in it (x0..x1, z0..z1, and y up to the
// tallest roof), for deciding when it's near enough to load and to draw.
function chunkUp(blocks, lots, roads) {
  const chunks = new Map()
  const chunkAt = (x, z) => {
    const cx = Math.floor(x / CHUNK)
    const cz = Math.floor(z / CHUNK)
    const key = `${cx},${cz}`
    if (!chunks.has(key)) {
      const bounds = { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity, y: 0 }
      chunks.set(key, { key, cx, cz, bounds, blocks: [], lots: [], edges: [] })
    }
    return chunks.get(key)
  }
  const grow = (b, x, z, [ex, ez]) => {
    b.x0 = Math.min(b.x0, x - ex)
    b.x1 = Math.max(b.x1, x + ex)
    b.z0 = Math.min(b.z0, z - ez)
    b.z1 = Math.max(b.z1, z + ez)
  }
  for (const block of blocks) {
    const chunk = chunkAt(block.x, block.z)
    chunk.blocks.push(block)
    grow(chunk.bounds, block.x, block.z, extents(block))
  }
  for (const lot of lots) {
    const chunk = chunkAt(lot.x, lot.z)
    chunk.lots.push(lot)
    grow(chunk.bounds, lot.x, lot.z, extents(lot))
    chunk.bounds.y = Math.max(chunk.bounds.y, lot.floors * FLOOR_H)
  }
  // Streets reach half their width (and their lamps) beyond their centre line.
  const reach = [STREET / 2, STREET / 2]
  for (const edge of roads.edges) {
    if (edge.stamp || edge.elevated) continue // built whole, not in chunks
    const a = roads.nodes[edge.a]
    const b = roads.nodes[edge.b]
    const chunk = chunkAt((a.x + b.x) / 2, (a.z + b.z) / 2)
    chunk.edges.push(edge)
    grow(chunk.bounds, a.x, a.z, reach)
    grow(chunk.bounds, b.x, b.z, reach)
  }
  return [...chunks.values()]
}
