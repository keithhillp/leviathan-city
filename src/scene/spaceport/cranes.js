import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { YARD } from './port.js'

// Tower cranes slewing over the terminal and hangars, and a rail-mounted
// gantry crane working the container yard. All slow, looping motions.
const TOWER_CRANES = [
  { x: 60, z: -95, height: 60, jib: 45, phase: 0 },
  { x: -120, z: -110, height: 48, jib: 36, phase: 2.5 },
]
const GANTRY = { height: 16, legInset: 6, travel: 12, railLength: 70 }

const YELLOW = 0xc89a1a
const BEACON = new THREE.Color(5, 0.3, 0.15)

const box = (w, h, d, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y, z)

// A thin straight member between two points.
function strut(from, to, thickness = 0.15) {
  const a = new THREE.Vector3(...from)
  const b = new THREE.Vector3(...to)
  const geometry = box(thickness, thickness, a.distanceTo(b))
  geometry.lookAt(b.clone().sub(a))
  return geometry.translate(...a.lerp(b, 0.5).toArray())
}

// Four posts with bracing rings every `step`: a lattice mast from y0 to y1.
function lattice(size, y0, y1, step = 4) {
  const half = size / 2
  const parts = []
  for (const [dx, dz] of [[-half, -half], [half, -half], [-half, half], [half, half]]) {
    parts.push(box(0.3, y1 - y0, 0.3, dx, (y0 + y1) / 2, dz))
  }
  for (let y = y0 + step; y < y1; y += step) {
    parts.push(box(size, 0.2, 0.2, 0, y, -half), box(size, 0.2, 0.2, 0, y, half))
    parts.push(box(0.2, 0.2, size, -half, y, 0), box(0.2, 0.2, size, half, y, 0))
    parts.push(strut([-half, y - step, -half], [half, y, -half]), strut([-half, y - step, half], [half, y, half]))
  }
  return parts
}

function createTowerCrane(spec, materials) {
  const { height, jib } = spec
  const group = new THREE.Group()
  group.add(new THREE.Mesh(mergeGeometries([box(5, 1.5, 5, 0, 0.75, 0), ...lattice(2.4, 1.5, height)]), materials.paint))

  // Everything above the slewing ring turns together.
  const slew = new THREE.Group()
  slew.position.y = height
  const apex = 8
  slew.add(
    new THREE.Mesh(
      mergeGeometries([
        box(2.6, 1.6, 2.6, 0, 0.8, 0),
        box(1.6, 1.6, 1.8, 0, 2.2, 1.8), // operator's cab
        box(jib, 1.4, 1.4, jib / 2, 2, 0),
        box(jib * 0.35, 1, 1.4, (-jib * 0.35) / 2, 2, 0),
        box(1, apex, 1, 0, 1.6 + apex / 2, 0),
        strut([0, apex + 1.6, 0], [jib, 2.7, 0]),
        strut([0, apex + 1.6, 0], [-jib * 0.35, 2.5, 0]),
      ]),
      materials.paint,
    ),
    new THREE.Mesh(box(3, 3, 2.4, -jib * 0.32, 1, 0), materials.concrete), // counterweight
  )
  const tip = new THREE.Mesh(box(0.5, 0.5, 0.5, jib, 3, 0), materials.beacon)
  const top = new THREE.Mesh(box(0.5, 0.5, 0.5, 0, apex + 2.1, 0), materials.beacon)
  slew.add(tip, top)

  // Trolley runs along the jib; the hook hangs from it on a cable.
  const trolley = new THREE.Group()
  trolley.position.y = 1.2
  const cable = new THREE.Mesh(box(0.08, 1, 0.08, 0, -0.5, 0), materials.dark)
  const hook = new THREE.Mesh(box(0.8, 1, 0.8), materials.paint)
  trolley.add(new THREE.Mesh(box(1.6, 0.5, 1.8), materials.dark), cable, hook)
  slew.add(trolley)
  group.add(slew)
  group.position.set(spec.x, 0, spec.z)

  return {
    group,
    beacons: [tip, top],
    update(elapsed) {
      const t = elapsed + spec.phase * 40
      slew.rotation.y = spec.phase + Math.sin(t * 0.04) * 1.4 + Math.sin(t * 0.011) * 0.8
      trolley.position.x = jib * (0.55 + Math.sin(t * 0.09) * 0.35)
      const drop = height * (0.45 + Math.sin(t * 0.07) * 0.3)
      cable.scale.y = drop
      hook.position.y = -drop - 0.5
    },
  }
}

// Spans the yard across z, running on rails along x.
function createGantryCrane(materials) {
  const { height, legInset, railLength } = GANTRY
  const span = YARD.rows * 3 + 14
  const zMid = YARD.z + (YARD.rows - 1) * 1.5
  const xMid = YARD.x + ((YARD.columns - 1) * 13) / 2
  const group = new THREE.Group()

  const rails = [-1, 1].map((s) => box(railLength, 0.3, 0.6, xMid, 0.15, zMid + (s * span) / 2))
  group.add(new THREE.Mesh(mergeGeometries(rails), materials.dark))

  const frame = new THREE.Group()
  const parts = []
  for (const sz of [-1, 1]) {
    const z = (sz * span) / 2
    parts.push(box(legInset * 2 + 2, 1, 1.4, 0, 0.8, z)) // bogie
    for (const sx of [-1, 1]) parts.push(strut([sx * legInset, 1, z], [sx * 1.5, height, z], 0.9))
  }
  for (const sx of [-1, 1]) parts.push(box(1.4, 1.8, span + 3, sx * 1.5, height + 0.9, 0)) // main girders
  parts.push(box(3, 2.4, 2.6, -3, height - 1, span / 2 - 1)) // cab
  frame.add(new THREE.Mesh(mergeGeometries(parts), materials.paint))

  const trolley = new THREE.Group()
  trolley.position.y = height + 2.2
  const cables = new THREE.Mesh(
    mergeGeometries([-1, 1].map((s) => box(0.08, 1, 0.08, s * 4, -0.5, 0))),
    materials.dark,
  )
  const spreader = new THREE.Group()
  spreader.add(new THREE.Mesh(box(12, 0.5, 2.4), materials.paint))
  const cargo = new THREE.Mesh(box(12, 2.6, 2.6, 0, -1.6, 0), materials.cargo)
  spreader.add(cargo)
  trolley.add(new THREE.Mesh(box(4, 1.2, 3), materials.paint), cables, spreader)
  frame.add(trolley)
  group.add(frame)
  frame.position.set(xMid, 0, zMid)

  return {
    group,
    beacons: [],
    update(elapsed) {
      frame.position.x = xMid + Math.sin(elapsed * 0.05) * GANTRY.travel
      trolley.position.z = Math.sin(elapsed * 0.13) * (span / 2 - 4)
      // Lifts are short: the stacks are up to three high.
      const drop = 3 + Math.sin(elapsed * 0.21) * 1.2
      cables.scale.y = drop
      spreader.position.y = -drop - 0.3
      cargo.visible = Math.sin(elapsed * 0.105) > 0 // picks up and puts down
    },
  }
}

export function createCranes() {
  const materials = {
    paint: new THREE.MeshStandardMaterial({ color: YELLOW, roughness: 0.6, metalness: 0.3 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x1c1e20, roughness: 0.8 }),
    concrete: new THREE.MeshStandardMaterial({ color: 0x777773, roughness: 0.95 }),
    cargo: new THREE.MeshStandardMaterial({ color: 0x2c5a6a, roughness: 0.7 }),
    beacon: new THREE.MeshBasicMaterial({ color: BEACON }),
  }
  const group = new THREE.Group()
  const cranes = [...TOWER_CRANES.map((spec) => createTowerCrane(spec, materials)), createGantryCrane(materials)]
  for (const crane of cranes) group.add(crane.group)

  return {
    group,
    update(elapsed) {
      for (const crane of cranes) crane.update(elapsed)
      const on = elapsed % 1.5 < 0.15
      for (const crane of cranes) for (const beacon of crane.beacons) beacon.visible = on
    },
  }
}
