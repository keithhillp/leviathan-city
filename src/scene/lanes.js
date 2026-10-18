// Traffic lanes over the city plan's elevated roads (plan.js), and how they
// join up. Pure data, no three.js.

import { HIGHWAY, SKYWAYS } from './plan.js'

// Speeds (units per second) by kind of road, inside lane first.
const SPEEDS = {
  highway: [46, 40, 34],
  skyway: [40, 34],
  radial: [36, 30],
  express: [52, 46],
}

// How much each kind of road matters: traffic heads for the bigger ones
// (traffic.js), and they get the longer green at the lights.
export const IMPORTANCE = { skyway: 2, highway: 3, radial: 3, express: 4 }
export const importanceOf = (lane) => IMPORTANCE[lane.kind] ?? 1

// Traffic lights: two groups of approaches (roughly, the two ways across)
// take turns, with an all-red between; each junction is out of step with its
// neighbours. Where a bigger road crosses a smaller one it gets the longer
// green.
export const SIGNAL = { even: 9, major: 14, minor: 6, clear: 2 }

// Lanes: { id, edge, kind, from, to (nodes), index (0 inside), outer, speed,
// start, end ([x, y, z]), dir ([x, z], unit), length (along the ground),
// next (lane ids it can go on to), signal (its traffic light, or null) }.
// Lanes stop short of junctions; vehicles cross them on curves (connector()).
// Only the elevated roads have lanes: the streets below are empty.
export function buildLanes(plan) {
  const { nodes, edges } = plan.roads
  const lanes = []
  const leaving = nodes.map(() => [])
  const arriving = nodes.map(() => [])
  const roads = edges.filter((edge) => edge.elevated && !edge.curve && !edge.link)

  // Lanes end this far from a junction: clear of the widest road crossing it.
  const meeting = nodes.map(() => [])
  for (const edge of roads) for (const n of [edge.a, edge.b]) meeting[n].push(edge)
  const clear = meeting.map((here) => (here.length > 2 ? Math.max(...here.map((edge) => edge.width / 2)) : 0))

  const addLane = (edge, from, to, offset, speed, index, outer) => {
    const a = nodes[from]
    const b = nodes[to]
    const [ay, by] = [a.y ?? 0, b.y ?? 0]
    const run = Math.hypot(b.x - a.x, b.z - a.z)
    const [dx, dz] = [(b.x - a.x) / run, (b.z - a.z) / run]
    const [rx, rz] = [-dz, dx] // to the right of the way it runs (traffic keeps right)
    const [c0, c1] = [clear[from], clear[to]]
    const length = run - c0 - c1
    if (length < 1) return
    const lane = {
      id: lanes.length,
      edge: edge.id,
      kind: edge.kind,
      from,
      to,
      index,
      outer,
      speed,
      start: [a.x + rx * offset + dx * c0, ay + ((by - ay) * c0) / run, a.z + rz * offset + dz * c0],
      end: [b.x + rx * offset - dx * c1, by - ((by - ay) * c1) / run, b.z + rz * offset - dz * c1],
      dir: [dx, dz],
      length,
      next: [],
      signal: null,
    }
    lanes.push(lane)
    leaving[from].push(lane)
    arriving[to].push(lane)
  }

  for (const edge of roads) {
    const offsets = edge.kind === 'highway' ? HIGHWAY.laneOffsets : SKYWAYS.laneOffsets
    const speeds = SPEEDS[edge.kind]
    offsets.forEach((offset, i) => {
      const outer = i === offsets.length - 1
      addLane(edge, edge.a, edge.b, offset, speeds[i], i, outer)
      addLane(edge, edge.b, edge.a, offset, speeds[i], i, outer)
    })
  }

  // Round a ring's bends, lanes go straight on from one end to the other;
  // across a link (inside the tower) they go on from either end.
  const across = new Map()
  const linked = new Map()
  for (const edge of edges) {
    const pairs = edge.curve ? across : edge.link ? linked : null
    pairs?.set(edge.a, edge.b).set(edge.b, edge.a)
  }
  const ahead = (p, q) => p.dir[0] * q.dir[0] + p.dir[1] * q.dir[1] > 0.1

  for (const lane of lanes) {
    let next
    if (across.has(lane.to)) {
      // On round the bend, in the same lane.
      next = leaving[across.get(lane.to)].filter((m) => m.index === lane.index && ahead(lane, m))
    } else {
      // At a junction any road out (any lane of it), not straight back; at the
      // tower, where the radials and express decks end, back out again.
      const here = [leaving[lane.to], leaving[linked.get(lane.to)] ?? []].flat()
      next = here.filter((m) => m.edge !== lane.edge)
      if (!next.length) next = here
    }
    lane.next = next.map((m) => m.id)
  }

  // Lights at junctions where three or more roads meet.
  nodes.forEach((node, n) => {
    if (meeting[n].length < 3 || !arriving[n].length) return
    const axis = (lane) => Math.atan2(lane.dir[1], lane.dir[0])
    const reference = axis(arriving[n][0])
    const groupOf = (lane) => (Math.abs(Math.sin(axis(lane) - reference)) < Math.SQRT1_2 ? 0 : 1)
    const weight = [0, 0]
    for (const lane of arriving[n]) weight[groupOf(lane)] = Math.max(weight[groupOf(lane)], importanceOf(lane))
    const greens =
      weight[0] === weight[1] ? [SIGNAL.even, SIGNAL.even]
      : weight[0] > weight[1] ? [SIGNAL.major, SIGNAL.minor]
      : [SIGNAL.minor, SIGNAL.major]
    const cycle = greens[0] + greens[1] + 2 * SIGNAL.clear
    const offset = (n * 7.31) % cycle
    for (const lane of arriving[n]) {
      const group = groupOf(lane)
      const start = group ? greens[0] + SIGNAL.clear : 0
      lane.signal = { node: n, start, green: greens[group], cycle, offset }
    }
  })

  return { lanes, leaving, arriving }
}

// Whether a lane's light is green at time `t` (seconds); always, without one.
export function isGreen(lane, t) {
  if (!lane.signal) return true
  const { start, green, cycle, offset } = lane.signal
  const phase = (t + offset) % cycle
  return phase >= start && phase < start + green
}

// The curve across a junction from the end of lane `p` to the start of lane
// `q`: a cubic Bezier { p0, p1, p2, p3, length } leaving and arriving along
// each lane, so a vehicle's heading never jumps; or null where they meet.
export function connector(p, q) {
  const [p0, p3] = [p.end, q.start]
  const chord = Math.hypot(p3[0] - p0[0], p3[2] - p0[2])
  if (chord < 0.5) return null
  const [ax, az] = p.dir
  const [bx, bz] = q.dir
  // Handles along each lane: two thirds of the way to where the lanes' lines
  // cross (the same curve as a quadratic through that point, as the highway's
  // deck curves), or, for lanes nearly in line, a share of the distance.
  let [h0, h1] = [chord * 0.4, chord * 0.4]
  const denom = ax * bz - az * bx
  if (Math.abs(denom) > 0.2) {
    const t = ((p3[0] - p0[0]) * bz - (p3[2] - p0[2]) * bx) / denom
    const u = ((p3[2] - p0[2]) * ax - (p3[0] - p0[0]) * az) / denom
    if (t > 0 && u > 0 && t < chord * 2 && u < chord * 2) [h0, h1] = [(t * 2) / 3, (u * 2) / 3]
  }
  const p1 = [p0[0] + ax * h0, p0[1], p0[2] + az * h0]
  const p2 = [p3[0] - bx * h1, p3[1], p3[2] - bz * h1]
  const curve = { p0, p1, p2, p3, length: 0 }
  // Length, from points along it.
  const at = [0, 0, 0]
  let [x, z] = [p0[0], p0[2]]
  for (let i = 1; i <= 8; i++) {
    bezier(curve, i / 8, at)
    curve.length += Math.hypot(at[0] - x, at[2] - z)
    ;[x, z] = [at[0], at[2]]
  }
  return curve
}

// Point `u` (0..1) along a connector, into `out` ([x, y, z]); with `tangent`,
// its direction there too (unnormalised).
export function bezier({ p0, p1, p2, p3 }, u, out, tangent) {
  const v = 1 - u
  const [a, b, c, d] = [v * v * v, 3 * v * v * u, 3 * v * u * u, u * u * u]
  for (let i = 0; i < 3; i++) out[i] = a * p0[i] + b * p1[i] + c * p2[i] + d * p3[i]
  if (tangent) {
    const [e, f, g] = [3 * v * v, 6 * v * u, 3 * u * u]
    for (let i = 0; i < 3; i++) tangent[i] = e * (p1[i] - p0[i]) + f * (p2[i] - p1[i]) + g * (p3[i] - p2[i])
  }
  return out
}
