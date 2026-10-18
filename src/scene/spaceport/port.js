import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { mulberry32 } from '../random.js'
import { Screen } from '../screens.js'
import { Visualiser } from '../visualiser.js'
import { fbm2, noise3 } from './noise.js'

// A landing field on an airless moon: pads in an arc in front of the
// terminal, hangars to the west, fuel farm and launch gantry to the east,
// ringed by cratered plains and a far mountain wall.
const GROUND_SIZE = 9000
const FLAT_RADIUS = 380 // the field itself is graded flat...
const HILLS_FROM = 900 // ...and the hills are at full height from here
const APRON_RADIUS = 300
const PAD_HEIGHT = 1.2

export const PADS = [
  { x: -100, z: 20, radius: 16 },
  { x: -40, z: 55, radius: 16 },
  { x: 40, z: 55, radius: 16 },
  { x: 100, z: 20, radius: 16 },
  { x: 0, z: 130, radius: 24 },
]
const TERMINAL = { x: 0, z: -60, w: 80, h: 16, d: 34 }
const TOWERS = [
  { x: -62, z: -48, height: 46 },
  { x: 48, z: 167, height: 46 }, // carries the billboard
]
const ROCKET = { x: 140, z: -110 }
// Visualiser screen bolted to the second tower's shaft, on the right of the
// field approach camera's view and turned to face it.
const BILLBOARD = { tower: TOWERS[1], heading: -0.733, width: 24, height: 14, bottom: 14.5, standoff: 5 }

// The container yard the gantry crane works (see cranes.js): containers are 12 long on x.
export const YARD = { x: -150, z: 70, rows: 4, columns: 3 }

const PAD_LIGHTS = 24
const TAXI_SPACING = 6
const MAST_RADIUS = 250
const MASTS = 10

const COLOURS = {
  idle: new THREE.Color(0.5, 0.9, 2.4),
  inbound: new THREE.Color(3, 1.6, 0.2),
  landed: new THREE.Color(0.3, 2, 0.6),
  outbound: new THREE.Color(3, 0.25, 0.15),
  taxi: new THREE.Color(0.25, 0.6, 2.6),
  beacon: new THREE.Color(5, 0.3, 0.15),
  flood: new THREE.Color(1.5, 1.3, 1),
}

const box = (w, h, d, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y, z)
const random = (rng, min, max) => min + rng() * (max - min)

function canvasTexture(size, draw, repeat = 1) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  draw(canvas.getContext('2d'), size)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(repeat, repeat)
  return texture
}

// ---- Terrain ------------------------------------------------------------------

function regolithTexture(rng) {
  return canvasTexture(
    256,
    (ctx, size) => {
      ctx.fillStyle = '#6a6660'
      ctx.fillRect(0, 0, size, size)
      for (let i = 0; i < 4000; i++) {
        const shade = 70 + rng() * 70
        ctx.fillStyle = `rgba(${shade}, ${shade - 3}, ${shade - 8}, ${0.2 + rng() * 0.4})`
        ctx.fillRect(rng() * size, rng() * size, 1 + rng() * 3, 1 + rng() * 3)
      }
      // Small craters: dark bowl, bright rim on the sun side.
      for (let i = 0; i < 14; i++) {
        const x = rng() * size
        const y = rng() * size
        const r = 3 + rng() ** 2 * 18
        ctx.fillStyle = 'rgba(30, 28, 26, 0.35)'
        ctx.beginPath()
        ctx.arc(x, y, r, 0, Math.PI * 2)
        ctx.fill()
        ctx.strokeStyle = 'rgba(190, 185, 175, 0.35)'
        ctx.lineWidth = 1 + r * 0.15
        ctx.beginPath()
        ctx.arc(x, y, r, Math.PI * 0.9, Math.PI * 1.7)
        ctx.stroke()
      }
    },
    GROUND_SIZE / 40,
  )
}

function terrainHeight(x, z, craters) {
  const r = Math.hypot(x, z)
  const hills = THREE.MathUtils.smoothstep(r, FLAT_RADIUS, HILLS_FROM)
  let h = (fbm2(x / 700 + 10, z / 700, 4) - 0.45) * 160 + (fbm2(x / 90, z / 90, 3) - 0.5) * 10
  for (const crater of craters) {
    const d = Math.hypot(x - crater.x, z - crater.z) / crater.radius
    if (d < 1.4) {
      // Bowl inside, raised rim just outside.
      h += d < 1 ? -crater.depth * (1 - d * d) : 0
      h += crater.depth * 0.45 * Math.exp(-((d - 1) ** 2) * 18)
    }
  }
  return h * hills
}

function createGround(rng) {
  const craters = Array.from({ length: 40 }, () => {
    const angle = rng() * Math.PI * 2
    const distance = random(rng, 700, 3600)
    const radius = random(rng, 40, 320)
    return { x: Math.cos(angle) * distance, z: Math.sin(angle) * distance, radius, depth: radius * random(rng, 0.15, 0.3) }
  })
  const geometry = new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE, 220, 220).rotateX(-Math.PI / 2)
  const position = geometry.attributes.position
  for (let i = 0; i < position.count; i++) {
    position.setY(i, terrainHeight(position.getX(i), position.getZ(i), craters))
  }
  geometry.computeVertexNormals()
  return new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ map: regolithTexture(rng), color: 0xb0aaa0, roughness: 1 }),
  )
}

// Jagged ridges all the way round, so the ground never shows an edge.
function createMountains(radius, depth, minHeight, maxHeight, colour, seed) {
  const segments = 360
  const positions = []
  const ridge = (i) => {
    const t = (i % segments) / segments
    const n = noise3(Math.cos(t * Math.PI * 2) * 6 + seed, Math.sin(t * Math.PI * 2) * 6, seed)
    const sharp = noise3(Math.cos(t * Math.PI * 2) * 30, Math.sin(t * Math.PI * 2) * 30, seed + 4)
    return minHeight + (maxHeight - minHeight) * (n ** 1.5 * 0.85 + sharp * 0.15)
  }
  const at = (i, r, y) => {
    const angle = (i / segments) * Math.PI * 2
    return [Math.cos(angle) * r, y, Math.sin(angle) * r]
  }
  for (let i = 0; i < segments; i++) {
    const near0 = at(i, radius, -60)
    const near1 = at(i + 1, radius, -60)
    const peak0 = at(i, radius + depth * 0.5, ridge(i))
    const peak1 = at(i + 1, radius + depth * 0.5, ridge(i + 1))
    const far0 = at(i, radius + depth, -60)
    const far1 = at(i + 1, radius + depth, -60)
    positions.push(...near0, ...peak0, ...near1, ...near1, ...peak0, ...peak1)
    positions.push(...peak0, ...far0, ...peak1, ...peak1, ...far0, ...far1)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.computeVertexNormals()
  return new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ color: colour, roughness: 1, flatShading: true, side: THREE.DoubleSide }),
  )
}

// ---- Field ----------------------------------------------------------------------

function apronTexture() {
  return canvasTexture(
    128,
    (ctx, size) => {
      ctx.fillStyle = '#4c4f50'
      ctx.fillRect(0, 0, size, size)
      for (let i = 0; i < 600; i++) {
        ctx.fillStyle = `rgba(0, 0, 0, ${Math.random() * 0.15})`
        ctx.fillRect(Math.random() * size, Math.random() * size, 2, 2)
      }
      ctx.strokeStyle = 'rgba(20, 22, 22, 0.8)'
      ctx.lineWidth = 2
      ctx.strokeRect(0, 0, size, size) // slab joints
    },
    (APRON_RADIUS * 2) / 12,
  )
}

function padTexture(number) {
  const texture = canvasTexture(256, (ctx, size) => {
    const c = size / 2
    ctx.fillStyle = '#3a3d3f'
    ctx.fillRect(0, 0, size, size)
    ctx.strokeStyle = '#d8a020'
    ctx.lineWidth = 10
    ctx.beginPath()
    ctx.arc(c, c, c - 14, 0, Math.PI * 2)
    ctx.stroke()
    // Hazard dashes round the inner ring.
    ctx.lineWidth = 6
    ctx.setLineDash([18, 14])
    ctx.strokeStyle = '#c8cccc'
    ctx.beginPath()
    ctx.arc(c, c, c - 42, 0, Math.PI * 2)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.fillStyle = '#c8cccc'
    ctx.font = 'bold 110px monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(number).padStart(2, '0'), c, c + 6)
  })
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping
  return texture
}

// Gates along the terminal front, one per pad.
function gateFor(pad) {
  return { x: THREE.MathUtils.clamp(pad.x * 0.35, -30, 30), z: TERMINAL.z + TERMINAL.d / 2 + 2 }
}

// ---- Buildings ----------------------------------------------------------------

function addTerminal(plain, glass) {
  const { x, z, w, h, d } = TERMINAL
  plain.push(box(w, h, d, x, h / 2, z))
  plain.push(box(w + 6, 1, d + 6, x, h + 0.5, z)) // roof slab
  plain.push(new THREE.SphereGeometry(15, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2).translate(x, h + 1, z))
  // Two bands of windows along the front, and a ring round the dome.
  for (const y of [4.5, 10.5]) glass.push(box(w - 4, 2.2, 0.3, x, y, z + d / 2 + 0.1))
  glass.push(new THREE.CylinderGeometry(15.05, 15.05, 1.6, 32, 1, true).translate(x, h + 4, z))
  // Gate tunnels poking out towards the pads.
  for (const pad of PADS) {
    const gate = gateFor(pad)
    plain.push(box(5, 4, 6, gate.x, 2, gate.z + 1))
  }
}

function addTower(plain, glass, lights, { x, z, height }) {
  plain.push(new THREE.CylinderGeometry(3, 4.5, height, 12).translate(x, height / 2, z))
  plain.push(new THREE.CylinderGeometry(9, 6, 3, 16).translate(x, height + 1.5, z))
  plain.push(new THREE.CylinderGeometry(9, 9, 1, 16).translate(x, height + 8.5, z))
  glass.push(new THREE.CylinderGeometry(8.6, 8.6, 5, 16, 1, true).translate(x, height + 5.5, z))
  plain.push(new THREE.CylinderGeometry(0.15, 0.25, 14, 5).translate(x, height + 16, z))
  lights.push({ position: new THREE.Vector3(x, height + 23, z), kind: 'beacon', phase: 0 })
}

function addHangar(shells, glass, x, z) {
  const radius = 20
  const length = 56
  // A half-cylinder along x, open towards the field (+x).
  const shell = new THREE.CylinderGeometry(radius, radius, length, 18, 1, true, Math.PI / 2, Math.PI)
    .rotateX(Math.PI / 2)
    .rotateY(Math.PI / 2)
    .translate(x, 0, z)
  shells.push(shell)
  shells.push(
    new THREE.CircleGeometry(radius, 18, 0, Math.PI).rotateY(Math.PI / 2).translate(x - length / 2, 0, z),
  )
  // Work lights inside.
  glass.push(box(0.4, 1, radius * 1.4, x - length / 2 + 0.6, 10, z))
  for (const dz of [-8, 8]) glass.push(box(length * 0.8, 0.3, 0.6, x, radius - 3, z + dz))
}

function addRocket(plain, painted, lights) {
  const { x, z } = ROCKET
  const base = 4
  plain.push(box(26, base, 26, x, base / 2, z)) // launch mount
  painted.push(new THREE.CylinderGeometry(4.5, 4.5, 52, 16).translate(x, base + 26, z))
  painted.push(new THREE.ConeGeometry(4.5, 14, 16).translate(x, base + 59, z))
  for (const side of [-1, 1]) {
    painted.push(new THREE.CylinderGeometry(2, 2, 30, 10).translate(x + side * 6.5, base + 15, z))
    painted.push(new THREE.ConeGeometry(2, 5, 10).translate(x + side * 6.5, base + 32.5, z))
  }
  // Lattice gantry beside it, with swing arms.
  const gx = x - 13
  const top = 72
  for (const [dx, dz] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) {
    plain.push(box(0.8, top, 0.8, gx + dx, top / 2, z + dz))
  }
  for (let y = 6; y < top; y += 6) {
    plain.push(box(6.8, 0.5, 0.5, gx, y, z - 3), box(6.8, 0.5, 0.5, gx, y, z + 3))
    plain.push(box(0.5, 0.5, 6.8, gx - 3, y, z), box(0.5, 0.5, 6.8, gx + 3, y, z))
  }
  for (const y of [24, 44, 58]) plain.push(box(8, 1, 2, gx + 6.5, y, z))
  lights.push({ position: new THREE.Vector3(gx, top + 1, z), kind: 'beacon', phase: 0.5 })
  lights.push({ position: new THREE.Vector3(gx + 3, 40, z + 3.5), kind: 'flood' })
}

function addFuelFarm(plain) {
  for (const [x, z] of [[200, 40], [218, 68], [190, 92]]) {
    plain.push(new THREE.SphereGeometry(8, 16, 10).translate(x, 12, z))
    for (const [dx, dz] of [[-5, -5], [5, -5], [-5, 5], [5, 5]]) plain.push(box(0.8, 9, 0.8, x + dx, 4.5, z + dz))
  }
  plain.push(box(40, 0.8, 0.8).rotateY(0.6).translate(200, 1, 66))
}

function createDish() {
  const group = new THREE.Group()
  const material = new THREE.MeshStandardMaterial({ color: 0xa8acae, roughness: 0.6, metalness: 0.4, side: THREE.DoubleSide })
  group.add(new THREE.Mesh(mergeGeometries([box(4, 8, 4, 0, 4, 0), box(2, 4, 2, 0, 10, 0)]), material))
  const head = new THREE.Group()
  head.position.y = 12
  // A shallow cap opening towards +z, with the feed arm out to its focus.
  const bowl = new THREE.SphereGeometry(10, 20, 8, 0, Math.PI * 2, 0, 0.75).rotateX(-Math.PI / 2).translate(0, 0, 10)
  const feed = new THREE.CylinderGeometry(0.2, 0.2, 6, 5).rotateX(Math.PI / 2).translate(0, 0, 3)
  head.add(new THREE.Mesh(mergeGeometries([bowl, feed]), material))
  group.add(head)
  group.position.set(70, 0, -130)
  return { group, head }
}

function addContainers(rng, painted, x0, z0, rows, columns) {
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < columns; j++) {
      const stack = 1 + Math.floor(rng() * 3)
      for (let k = 0; k < stack; k++) {
        const geometry = box(12, 2.6, 2.6, x0 + j * 13, 1.3 + k * 2.65, z0 + i * 3)
        const colour = new THREE.Color().setHSL([0.02, 0.08, 0.5, 0.58, 0.13][Math.floor(rng() * 5)], 0.45, 0.32)
        const colours = new Float32Array(geometry.attributes.position.count * 3)
        for (let v = 0; v < colours.length; v += 3) colour.toArray(colours, v)
        geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3))
        painted.push(geometry)
      }
    }
  }
}

// Gives every geometry a white vertex colour, so it can share a material with
// the painted (vertex coloured) ones.
function white(geometry) {
  if (geometry.attributes.color) return geometry
  const colours = new Float32Array(geometry.attributes.position.count * 3).fill(0.9)
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3))
  return geometry
}

const merge = (geometries) => mergeGeometries(geometries.map((g) => (g.index ? g.toNonIndexed() : g)))

// ---- Everything together ----------------------------------------------------------

export function createPort({ seed = 11 } = {}) {
  const rng = mulberry32(seed)
  const group = new THREE.Group()
  const plain = [] // concrete and steel
  const painted = [] // vertex-coloured: rocket, containers
  const glass = [] // lit windows
  const shells = [] // hangars: seen from inside too
  const lights = [] // small glowing markers, all in one instanced mesh

  group.add(createGround(rng))
  group.add(createMountains(3200, 500, 60, 420, 0x55524c, 1))
  group.add(createMountains(4100, 700, 200, 760, 0x3e3c39, 7))

  const apron = new THREE.Mesh(
    new THREE.CircleGeometry(APRON_RADIUS, 64).rotateX(-Math.PI / 2).translate(0, 0.06, 0),
    new THREE.MeshStandardMaterial({ map: apronTexture(), roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
  )
  group.add(apron)

  // Pads, their light rings and taxiways to the terminal.
  const taxiways = []
  const centrelines = []
  const pads = PADS.map((spec, index) => {
    const pad = {
      index,
      radius: spec.radius,
      position: new THREE.Vector3(spec.x, PAD_HEIGHT, spec.z),
      status: 'idle', // set by the traffic: idle, inbound, landed, outbound
    }
    plain.push(new THREE.CylinderGeometry(spec.radius + 1, spec.radius + 2, PAD_HEIGHT, 32).translate(spec.x, PAD_HEIGHT / 2, spec.z))
    const top = new THREE.Mesh(
      new THREE.CircleGeometry(spec.radius, 40).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ map: padTexture(index + 1), roughness: 0.8 }),
    )
    top.position.copy(pad.position).y += 0.02
    group.add(top)
    for (let i = 0; i < PAD_LIGHTS; i++) {
      const angle = (i / PAD_LIGHTS) * Math.PI * 2
      lights.push({
        position: new THREE.Vector3(spec.x + Math.cos(angle) * (spec.radius + 0.6), PAD_HEIGHT + 0.15, spec.z + Math.sin(angle) * (spec.radius + 0.6)),
        kind: 'pad',
        pad,
        order: i / PAD_LIGHTS,
      })
    }

    const gate = gateFor(spec)
    const from = new THREE.Vector3(spec.x, 0, spec.z)
    const to = new THREE.Vector3(gate.x, 0, gate.z)
    const run = to.clone().sub(from)
    const direction = run.clone().normalize()
    from.addScaledVector(direction, spec.radius + 2)
    const length = to.distanceTo(from)
    const middle = from.clone().lerp(to, 0.5)
    const heading = Math.atan2(direction.x, direction.z)
    taxiways.push(box(9, 0.1, length, 0, 0.1, 0).rotateY(heading).translate(middle.x, 0, middle.z))
    centrelines.push(box(0.3, 0.12, length, 0, 0.12, 0).rotateY(heading).translate(middle.x, 0, middle.z))
    const side = new THREE.Vector3(direction.z, 0, -direction.x)
    for (let t = 0; t < length; t += TAXI_SPACING) {
      for (const s of [-1, 1]) {
        lights.push({
          position: from.clone().addScaledVector(direction, t).addScaledVector(side, s * 5).setY(0.3),
          kind: 'taxi',
          order: t / length,
        })
      }
    }
    return pad
  })

  addTerminal(plain, glass)
  for (const tower of TOWERS) addTower(plain, glass, lights, tower)
  addHangar(shells, glass, -190, -60)
  addHangar(shells, glass, -190, 10)
  addRocket(plain, painted, lights)
  addFuelFarm(plain)
  addContainers(rng, painted, YARD.x, YARD.z, YARD.rows, YARD.columns)
  addContainers(rng, painted, 160, -40, 3, 2)

  // Light masts round the field.
  for (let i = 0; i < MASTS; i++) {
    const angle = (i / MASTS) * Math.PI * 2 + 0.3
    const x = Math.cos(angle) * MAST_RADIUS
    const z = Math.sin(angle) * MAST_RADIUS
    plain.push(box(0.8, 24, 0.8, x, 12, z))
    plain.push(box(4, 1.2, 1.2).rotateY(-angle).translate(x, 23, z))
    lights.push({ position: new THREE.Vector3(x, 22.2, z), kind: 'flood' })
    lights.push({ position: new THREE.Vector3(x, 24.8, z), kind: 'beacon', phase: i * 0.1 })
  }

  const steel = new THREE.MeshStandardMaterial({ vertexColors: true, color: 0x8c9294, roughness: 0.75, metalness: 0.3 })
  group.add(new THREE.Mesh(merge([...plain, ...painted].map(white)), steel))
  group.add(new THREE.Mesh(merge(shells), new THREE.MeshStandardMaterial({ color: 0x7a7e80, roughness: 0.7, metalness: 0.4, side: THREE.DoubleSide })))
  // Flat markings sit just above the ground; polygon offset keeps them from flickering at a distance.
  const decal = (factor) => ({ polygonOffset: true, polygonOffsetFactor: factor, polygonOffsetUnits: factor })
  group.add(new THREE.Mesh(merge(taxiways), new THREE.MeshStandardMaterial({ color: 0x2c2f31, roughness: 0.95, ...decal(-2) })))
  group.add(new THREE.Mesh(merge(centrelines), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.9, 0.65, 0.1), ...decal(-4) })))
  const glassMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.7, 0.8, 0.9) })
  group.add(new THREE.Mesh(merge(glass), glassMaterial))

  const lightMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.7, 0.4, 0.7), new THREE.MeshBasicMaterial(), lights.length)
  const matrix = new THREE.Matrix4()
  lights.forEach((light, i) => {
    const scale = light.kind === 'flood' ? 2 : light.kind === 'beacon' ? 1.4 : 1
    matrix.makeScale(scale, scale, scale).setPosition(light.position)
    lightMesh.setMatrixAt(i, matrix)
    lightMesh.setColorAt(i, COLOURS.idle)
  })
  group.add(lightMesh)

  // A few real lights so the field isn't only lit by the low sun.
  for (const [x, z] of [[0, -30], [-90, 60], [90, 60]]) {
    const lamp = new THREE.PointLight(0xffd8a8, 1800, 160, 2)
    lamp.position.set(x, 24, z)
    group.add(lamp)
  }

  const dish = createDish()
  group.add(dish.group)

  const { tower, width, height, bottom, standoff } = BILLBOARD
  const screen = new Screen({
    width,
    height,
    resolution: 1024 / width,
    brightness: 1.3,
    heavyGrime: false,
    pulse: true,
    createContent: () => new Visualiser(),
  })
  const billboard = new THREE.Group()
  screen.mesh.position.set(0, bottom + height / 2, standoff + 0.25)
  billboard.add(screen.mesh)
  // Frame, held off the shaft by four arms.
  const arms = [-1, 1].flatMap((side) =>
    [bottom + 2, bottom + height - 2].map((y) => box(0.8, 0.8, standoff, side * width * 0.3, y, standoff / 2)),
  )
  billboard.add(new THREE.Mesh(merge([box(width + 1, height + 1, 0.4, 0, bottom + height / 2, standoff), ...arms].map(white)), steel))
  billboard.position.set(tower.x, 0, tower.z)
  billboard.rotation.y = BILLBOARD.heading
  group.add(billboard)

  const colour = new THREE.Color()
  let chase = 0 // taxi light sweep, advancing with the tempo
  let padSpin = 0
  let flash = 0

  return {
    group,
    pads,
    update(delta, elapsed, analysis) {
      const { bass } = analysis.levels
      const playing = analysis.frame?.playing
      // One sweep down the taxiways every four beats (a steady walk without music).
      chase = (chase + delta / (playing ? analysis.beatInterval * 4 : 3)) % 1
      padSpin = (padSpin + delta * (0.15 + analysis.energy * 0.5)) % 1
      if (analysis.beat) flash = 1
      flash = Math.max(0, flash - delta * 5)

      lights.forEach((light, i) => {
        if (light.kind === 'taxi') {
          const behind = (((chase - light.order) % 1) + 1) % 1
          colour.copy(COLOURS.taxi).multiplyScalar(0.25 + Math.exp(-behind * 10) * (1.6 + bass * 2) + analysis.drums.snare * 0.5)
        } else if (light.kind === 'pad') {
          const { status } = light.pad
          if (status === 'inbound' || status === 'outbound') {
            // Fast strobe round the ring.
            const behind = (((elapsed * 1.5 - light.order) % 1) + 1) % 1
            colour.copy(COLOURS[status]).multiplyScalar(0.2 + Math.exp(-behind * 6) * 1.6)
          } else if (status === 'landed') {
            colour.copy(COLOURS.landed).multiplyScalar(0.6 + flash * 0.6)
          } else {
            const behind = (((padSpin - light.order) % 1) + 1) % 1
            colour.copy(COLOURS.idle).multiplyScalar(0.25 + Math.exp(-behind * 8) * (0.6 + bass * 1.5) + flash * 0.5)
          }
        } else if (light.kind === 'beacon') {
          colour.copy(COLOURS.beacon).multiplyScalar((elapsed + light.phase) % 1.4 < 0.12 ? 1 : 0.05)
        } else {
          colour.copy(COLOURS.flood)
        }
        lightMesh.setColorAt(i, colour)
      })
      lightMesh.instanceColor.needsUpdate = true

      glassMaterial.color.setRGB(0.7, 0.8, 0.9).multiplyScalar(0.8 + analysis.energy * 0.4)
      dish.group.rotation.y = elapsed * 0.08
      dish.head.rotation.x = -0.6 + Math.sin(elapsed * 0.05) * 0.15
      screen.update(delta, elapsed, analysis)
    },
  }
}
