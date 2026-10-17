import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { Screen } from './screens.js'
import { Visualiser } from './visualiser.js'
import { AdsContent, DeadContent, TickerContent } from './screenContent.js'
import billboards from '../content/billboards.json'

// A Times Square style plaza along the avenue at x = 0: the camera stands at
// the open end looking at a tower carrying the big visualiser screen, with
// a few worn advertising screens on the buildings either side.
const PLAZA_HALF_WIDTH = 20
const FRONT_Z = 45
const TOWER_FACE_Z = -72
const SCREEN_GAP = 0.25 // distance in front of the facade

// CCTV cameras the viewer can switch between; the first is the default.
// Find new ones with the free camera (F) and paste its coordinates here.
export const CAMERAS = [
  {
    name: 'LEVIATHAN APPROACH',
    position: new THREE.Vector3(14.4, 7.16, 56.59),
    target: new THREE.Vector3(-13.18, 37.95, -47.34),
  },
  {
    name: 'PLAZA OVERWATCH',
    position: new THREE.Vector3(-12.06, 22.97, 27.73),
    target: new THREE.Vector3(4.16, 9.21, -62.46),
  },
  {
    name: 'STREET LEVEL',
    position: new THREE.Vector3(16.53, 0.59, 53.76),
    target: new THREE.Vector3(4.09, 7.38, -57.21),
  },
  {
    name: 'ROOFTOP',
    position: new THREE.Vector3(2.26, 48.82, 101.03),
    target: new THREE.Vector3(6.0, 22.51, -54.6),
  },
]

// Traffic runs down the plaza between a tunnel in the tower's base and the
// street behind the camera. Oncoming lanes are on the left (drive on the right).
// Raised strip between the two directions; the camera stands on it.
const MEDIAN = { halfWidth: 2.5, height: 0.25, bollardSpacing: 10 }
const REFLECTOR = new THREE.Color(3, 1.4, 0.2)

// Lanes per side, from the reservation outwards (inside lanes are fastest).
const LANE = { width: 4, speeds: [44, 37, 30] }
const ROAD_INNER = MEDIAN.halfWidth + 0.25 // reservation kerb to first lane
const ROAD_OUTER = ROAD_INNER + LANE.width * LANE.speeds.length
const laneX = (i) => ROAD_INNER + LANE.width * (i + 0.5)
const LINE = { width: 0.15, dash: 3, gap: 6, y: 0.08 }
const PAVEMENT_HEIGHT = 0.18

const TUNNEL = { width: ROAD_OUTER * 2 + 2, height: 7 }

// Rail bridge crossing the road part-way down the plaza, well clear of the
// tower. Its ends run into buildings L2 and R2, which hide where the train
// comes and goes, so `z` must stay where both of them stand (about -17..2).
export const BRIDGE = {
  z: -10,
  underside: 8,
  thickness: 1.8,
  depth: 8,
  span: 76, // x -38..38, building edge to building edge
  tracks: [-1.6, 1.6], // offsets from the bridge centre line
  pillars: [-17.4, 0, 17.4], // on the pavements and the reservation
  markerSpacing: 4, // dark red lights along both faces of the deck
  // Arched black openings where the tracks meet the buildings: total height,
  // how much narrower than the deck, frame thickness and how far it projects.
  portal: { height: 6, inset: 1, frame: 0.6, depth: 1.2 },
}
const BRIDGE_MARKER = new THREE.Color(1.6, 0.04, 0.03)
BRIDGE.deckY = BRIDGE.underside + BRIDGE.thickness

// Where the eyebots patrol: in front of the side buildings' facades (at
// ±wallX), above the bridge, train and portal arches.
export const PATROL = { wallX: PLAZA_HALF_WIDTH, z: [-64, 40], y: [17, 45] }
export const ROAD = {
  minZ: TOWER_FACE_Z - 8, // inside the tunnel
  maxZ: 70, // behind the camera
  lanes: LANE.speeds.flatMap((speed, i) => [
    { x: -laneX(i), dir: 1, speed },
    { x: laneX(i), dir: -1, speed: speed - 3 },
  ]),
}

// Buildings the city generates (with its window materials) instead of the
// procedural blocks. Floors are 3.5 units.
export const SQUARE = {
  bounds: { x0: -38, x1: 38, z0: -94, z1: FRONT_Z },
  buildings: [
    { name: 'L1', x0: -38, x1: -20, z0: 9, z1: 45, floors: 6 },
    { name: 'L2', x0: -38, x1: -20, z0: -24, z1: 6, floors: 17 },
    { name: 'L3', x0: -38, x1: -20, z0: -51, z1: -27, floors: 13 },
    { name: 'L4', x0: -38, x1: -20, z0: -72, z1: -54, floors: 18 },
    { name: 'R1', x0: 20, x1: 38, z0: 12, z1: 45, floors: 5 },
    { name: 'R2', x0: 20, x1: 38, z0: -21, z1: 9, floors: 19 },
    { name: 'R3', x0: 20, x1: 38, z0: -48, z1: -24, floors: 12 },
    { name: 'R4', x0: 20, x1: 38, z0: -72, z1: -51, floors: 16 },
    { name: 'tower', x0: -28, x1: 28, z0: -93, z1: TOWER_FACE_Z, floors: 28 },
    { name: 'endL', x0: -38, x1: -30, z0: -93, z1: -75, floors: 11 },
    { name: 'endR', x0: 30, x1: 38, z0: -93, z1: -75, floors: 9 },
  ],
}

// As wide as the plaza allows (the side buildings would hide anything wider)
// and tall enough for a big, readable track title above the bars.
const HERO = { x: 0, bottom: 20, width: 38, height: 30 } // raised clear of the rail bridge

const content = {
  ads: () => (ctx, w, h) => new AdsContent(ctx, w, h),
  dead: () => () => new DeadContent(),
  ticker: (color) => (ctx, w, h) => new TickerContent(ctx, w, h, color),
}

// Placement helpers. `along` is the centre along the facade, `bottom` the
// height of the lower edge.
// `options` are passed through to Screen (e.g. flicker).
const left = (along, bottom, w, h, create, options) => ({
  position: [-PLAZA_HALF_WIDTH + SCREEN_GAP, bottom + h / 2, along],
  rotation: Math.PI / 2,
  w,
  h,
  create,
  options,
})
const right = (along, bottom, w, h, create, options) => ({
  position: [PLAZA_HALF_WIDTH - SCREEN_GAP, bottom + h / 2, along],
  rotation: -Math.PI / 2,
  w,
  h,
  create,
  options,
})
const front = (x, faceZ, bottom, w, h, create, options) => ({
  position: [x, bottom + h / 2, faceZ + SCREEN_GAP],
  rotation: 0,
  w,
  h,
  create,
  options,
})
const SCREENS = [
  // Left side
  front(-29, 6, 26, 16, 14, content.ads()), // L2, above L1
  left(-9, 16.5, 26, 2.2, content.ticker()),
  left(-9, 20, 24, 13, content.ads()),
  left(-39, 10, 16, 9, content.ads(), { flicker: true }),
  left(-63, 16, 14, 26, content.dead()),
  // Right side
  front(29, 9, 22, 14, 12, content.dead()), // R2, above R1
  right(-6, 18, 24, 14, content.ads()),
  right(-61, 14, 16, 22, content.ads(), { flicker: true }),
  // Under the hero
  front(0, TOWER_FACE_Z, HERO.bottom - 3.2, HERO.width, 2.4, content.ticker()),
]

// Faint coloured spill from the larger adverts: [position, index into SCREENS].
const SPILL_LIGHTS = [
  [[-14, 14, -8], 2],
  [[14, 14, -4], 6],
]
const SPILL_INTENSITY = 120

// Screen glitches in quiet passages: chance per hit (scaled by how calm the
// passage is) and the share of screens each glitch hits.
const GLITCH = { chance: 0.5, share: 0.4 }
// Power surges on the heaviest sub-bass: share of screens hit, how long (in
// beats) and the spread of start delays (in beats) so failures cascade.
const SURGE = { share: 0.75, beats: 0.75, spread: 0.25 }

// White neon company name standing on the tower's roof, facing the plaza.
// `lift` is the gap between the roof and the letters, `setback` how far
// behind the front edge it stands.
const CORPORATE_SIGN = { width: 54, lift: 1.5, setback: 1, brightness: 2.6, light: 400 }
const FLOOR_HEIGHT = 3.5 // matches the city's floors

// Glowing white letters on a transparent background, so the tower's windows
// show between them. Tube-like: a soft halo with a hot white core.
function createCorporateSign(text) {
  const canvas = document.createElement('canvas')
  canvas.width = 2048
  canvas.height = 256
  const ctx = canvas.getContext('2d')
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.letterSpacing = '28px'
  let size = 170
  ctx.font = `800 ${size}px "Noto Sans", sans-serif`
  const fit = (canvas.width - 120) / ctx.measureText(text).width
  if (fit < 1) ctx.font = `800 ${(size *= fit)}px "Noto Sans", sans-serif`

  const x = canvas.width / 2
  const y = canvas.height / 2 + 6
  ctx.shadowColor = 'rgba(225, 240, 255, 0.9)'
  ctx.shadowBlur = 36
  ctx.fillStyle = 'rgba(225, 240, 255, 0.55)'
  ctx.fillText(text, x, y)
  ctx.shadowBlur = 10
  ctx.fillStyle = '#ffffff'
  ctx.fillText(text, x, y)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false })
  material.color.setScalar(CORPORATE_SIGN.brightness) // HDR so the letters bloom
  const height = (CORPORATE_SIGN.width * canvas.height) / canvas.width
  return new THREE.Mesh(new THREE.PlaneGeometry(CORPORATE_SIGN.width, height), material)
}

const HERO_GLOW_BASE = 1500
const HERO_GLOW_BASS = 7000
const WARM = new THREE.Color(1, 0.55, 0.15)
const COLD = new THREE.Color(0.4, 0.85, 1)

// Opening with straight sides and a semicircular top, base at y = 0.
function archShape(halfWidth, straight) {
  const shape = new THREE.Shape()
  shape.moveTo(-halfWidth, 0)
  shape.lineTo(halfWidth, 0)
  shape.lineTo(halfWidth, straight)
  shape.absarc(0, straight, halfWidth, 0, Math.PI, false)
  shape.closePath()
  return shape
}

// The U-shaped band around archShape, open at the bottom where the deck is.
function archFrameShape(halfWidth, thickness, straight) {
  const outer = halfWidth + thickness
  const shape = new THREE.Shape()
  shape.moveTo(-outer, 0)
  shape.lineTo(-halfWidth, 0)
  shape.lineTo(-halfWidth, straight)
  shape.absarc(0, straight, halfWidth, Math.PI, 0, true)
  shape.lineTo(halfWidth, 0)
  shape.lineTo(outer, 0)
  shape.lineTo(outer, straight)
  shape.absarc(0, straight, outer, 0, Math.PI, false)
  shape.closePath()
  return shape
}

export function createSquare() {
  const group = new THREE.Group()
  const frameMaterial = new THREE.MeshStandardMaterial({ color: 0x111316, roughness: 0.6, metalness: 0.7 })

  const screens = SCREENS.map((spec) => {
    const screen = new Screen({ width: spec.w, height: spec.h, createContent: spec.create, ...spec.options })
    screen.mesh.position.set(...spec.position)
    screen.mesh.rotation.y = spec.rotation
    group.add(screen.mesh)
    const frame = new THREE.Mesh(new THREE.BoxGeometry(spec.w + 0.5, spec.h + 0.5, 0.3), frameMaterial)
    frame.position.set(...spec.position)
    frame.rotation.y = spec.rotation
    frame.translateZ(-0.2)
    group.add(frame)
    return screen
  })

  const hero = new Screen({
    width: HERO.width,
    height: HERO.height,
    resolution: 1024 / HERO.width,
    brightness: 1.3,
    heavyGrime: false,
    pulse: true,
    createContent: () => new Visualiser(),
  })
  hero.material.fog = false // the focal point cuts through the haze
  const heroCenter = new THREE.Vector3(HERO.x, HERO.bottom + HERO.height / 2, TOWER_FACE_Z + SCREEN_GAP)
  hero.mesh.position.copy(heroCenter)
  group.add(hero.mesh)
  const heroFrame = new THREE.Mesh(
    new THREE.BoxGeometry(HERO.width + 0.8, HERO.height + 0.8, 0.3),
    frameMaterial,
  )
  heroFrame.position.copy(heroCenter).z -= 0.2
  group.add(heroFrame)

  const tower = SQUARE.buildings.find((building) => building.name === 'tower')
  const roof = tower.floors * FLOOR_HEIGHT
  const sign = createCorporateSign(billboards.corporateSign)
  const signHeight = sign.geometry.parameters.height
  const signZ = TOWER_FACE_Z - CORPORATE_SIGN.setback
  const signY = roof + CORPORATE_SIGN.lift + signHeight / 2
  sign.position.set(0, signY, signZ)
  // Steel rack behind the letters, standing on the roof.
  const rackHeight = CORPORATE_SIGN.lift + signHeight
  const rack = new THREE.Mesh(
    mergeGeometries([
      new THREE.BoxGeometry(CORPORATE_SIGN.width + 1, 0.4, 0.4).translate(0, roof + CORPORATE_SIGN.lift, 0),
      new THREE.BoxGeometry(CORPORATE_SIGN.width + 1, 0.4, 0.4).translate(0, roof + rackHeight, 0),
      ...[-0.5, -0.25, 0, 0.25, 0.5].map((f) =>
        new THREE.BoxGeometry(0.4, rackHeight, 0.4).translate(f * CORPORATE_SIGN.width, roof + rackHeight / 2, 0),
      ),
    ]),
    frameMaterial,
  )
  rack.position.z = signZ - 0.5
  // Cool white wash over the roof edge and the top of the facade.
  const signLight = new THREE.PointLight(0xdfeeff, CORPORATE_SIGN.light, 45, 2)
  signLight.position.set(0, signY, TOWER_FACE_Z + 6)
  group.add(sign, rack, signLight)

  // Tunnel mouth: a black opening in the tower's base with a concrete lintel.
  const tunnel = new THREE.Mesh(
    new THREE.PlaneGeometry(TUNNEL.width, TUNNEL.height),
    new THREE.MeshBasicMaterial({ color: 0x000000 }),
  )
  tunnel.position.set(0, TUNNEL.height / 2, TOWER_FACE_Z + 0.05)
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(TUNNEL.width + 2, 1.2, 0.8), frameMaterial)
  lintel.position.set(0, TUNNEL.height + 0.6, TOWER_FACE_Z + 0.3)
  group.add(tunnel, lintel)

  // Concrete deck, parapets and pillars, rails on top, lamps underneath.
  const concrete = new THREE.MeshStandardMaterial({ color: 0x3a3c3a, roughness: 0.9 })
  const { z: bz, underside, thickness, depth, span, deckY } = BRIDGE
  const bridge = new THREE.Mesh(
    mergeGeometries([
      new THREE.BoxGeometry(span, thickness, depth).translate(0, underside + thickness / 2, bz),
      ...[-1, 1].map((side) =>
        new THREE.BoxGeometry(span, 1.3, 0.35).translate(0, deckY + 0.65, bz + side * (depth / 2 - 0.175)),
      ),
      ...BRIDGE.pillars.map((x) => new THREE.BoxGeometry(1.6, underside, 3).translate(x, underside / 2, bz)),
    ]),
    concrete,
  )
  const rails = new THREE.Mesh(
    mergeGeometries(
      BRIDGE.tracks.flatMap((track) =>
        [-0.75, 0.75].map((gauge) =>
          new THREE.BoxGeometry(span, 0.15, 0.12).translate(0, deckY + 0.08, bz + track + gauge),
        ),
      ),
    ),
    frameMaterial,
  )
  const lampXs = []
  for (let x = -span / 2 + 6; x < span / 2 - 4; x += 8) lampXs.push(x)
  const lamps = new THREE.Mesh(
    mergeGeometries(lampXs.map((x) => new THREE.BoxGeometry(1.2, 0.12, 0.5).translate(x, underside - 0.06, bz))),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.2, 1.2) }),
  )
  const markers = []
  for (let x = -span / 2 + 2; x <= span / 2 - 2; x += BRIDGE.markerSpacing) {
    for (const side of [-1, 1]) {
      markers.push(new THREE.BoxGeometry(0.5, 0.3, 0.1).translate(x, underside + thickness / 2, bz + side * (depth / 2 + 0.05)))
    }
  }
  const markerLights = new THREE.Mesh(
    mergeGeometries(markers),
    new THREE.MeshBasicMaterial({ color: BRIDGE_MARKER }),
  )
  group.add(bridge, rails, lamps, markerLights)

  // Arched black openings in the buildings either side, like the road tunnel,
  // so the train disappears into a hole rather than through the windows. The
  // arch stands proud of the wall and the hole sits inside it, clear of the
  // facade, so the building can't poke through at the edges.
  const { height: portalHeight, inset, frame: frameWidth, depth: frameDepth } = BRIDGE.portal
  const halfWidth = (depth - inset) / 2
  const straight = portalHeight - halfWidth // walls below the round top
  const blackout = new THREE.MeshBasicMaterial({ color: 0x000000 })
  const holeGeometry = new THREE.ShapeGeometry(archShape(halfWidth, straight))
  const archGeometry = new THREE.ExtrudeGeometry(archFrameShape(halfWidth, frameWidth, straight), {
    depth: frameDepth,
    bevelEnabled: false,
  })
  for (const side of [-1, 1]) {
    const faceX = side * PLAZA_HALF_WIDTH
    const facing = -side * (Math.PI / 2) // towards the plaza
    const arch = new THREE.Mesh(archGeometry, concrete)
    arch.rotation.y = facing
    arch.position.set(faceX + side * 0.2, deckY, bz) // slightly sunk into the wall
    const hole = new THREE.Mesh(holeGeometry, blackout)
    hole.rotation.y = facing
    hole.position.set(faceX - side * 0.4, deckY, bz)
    group.add(arch, hole)
  }

  const heroLight = new THREE.SpotLight(COLD, HERO_GLOW_BASE, 160, 0.8, 1, 2)
  heroLight.position.copy(heroCenter).z += 3
  heroLight.target.position.set(0, 0, 10)
  group.add(heroLight, heroLight.target)
  const heroGlow = new THREE.Color()

  const spills = SPILL_LIGHTS.map(([position, screenIndex]) => {
    const light = new THREE.PointLight(0xffffff, SPILL_INTENSITY, 70, 2)
    light.position.set(...position)
    group.add(light)
    return { light, screen: screens[screenIndex] }
  })

  // Central reservation with kerbs and a row of reflective bollards.
  const medianLength = ROAD.maxZ - TOWER_FACE_Z
  const medianZ = (ROAD.maxZ + TOWER_FACE_Z) / 2
  const median = new THREE.Mesh(
    new THREE.BoxGeometry(MEDIAN.halfWidth * 2, MEDIAN.height, medianLength),
    new THREE.MeshStandardMaterial({ color: 0x161817, roughness: 0.75, metalness: 0.1 }),
  )
  median.position.set(0, MEDIAN.height / 2, medianZ)
  const kerbHeight = MEDIAN.height + 0.08
  const kerbs = new THREE.Mesh(
    mergeGeometries(
      [-1, 1].map((side) =>
        new THREE.BoxGeometry(0.3, kerbHeight, medianLength).translate(
          side * (MEDIAN.halfWidth - 0.15),
          kerbHeight / 2,
          medianZ,
        ),
      ),
    ),
    new THREE.MeshStandardMaterial({ color: 0x5a5c58, roughness: 0.5 }),
  )
  group.add(median, kerbs)

  // Worn lane markings: solid edge lines, dashed lines between lanes.
  const roadStart = TOWER_FACE_Z
  const roadLength = ROAD.maxZ - roadStart
  const stripe = (x, z, length) =>
    new THREE.PlaneGeometry(LINE.width, length).rotateX(-Math.PI / 2).translate(x, LINE.y, z)
  const markings = []
  for (const side of [-1, 1]) {
    for (const x of [ROAD_INNER + LINE.width, ROAD_OUTER - LINE.width]) {
      markings.push(stripe(side * x, roadStart + roadLength / 2, roadLength))
    }
    for (let i = 1; i < LANE.speeds.length; i++) {
      for (let z = roadStart; z < ROAD.maxZ; z += LINE.dash + LINE.gap) {
        markings.push(stripe(side * (ROAD_INNER + LANE.width * i), z + LINE.dash / 2, LINE.dash))
      }
    }
  }
  const paint = new THREE.Mesh(
    mergeGeometries(markings),
    new THREE.MeshStandardMaterial({
      color: 0x8c8c86,
      roughness: 0.55,
      // Keeps the paint from flickering against the road surface below.
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -4,
    }),
  )
  group.add(paint)

  // Pavements between the outside lanes and the buildings.
  const pavementWidth = PLAZA_HALF_WIDTH - ROAD_OUTER
  const pavementLength = FRONT_Z - TOWER_FACE_Z
  const pavements = new THREE.Mesh(
    mergeGeometries(
      [-1, 1].map((side) =>
        new THREE.BoxGeometry(pavementWidth, PAVEMENT_HEIGHT, pavementLength).translate(
          side * (ROAD_OUTER + pavementWidth / 2),
          PAVEMENT_HEIGHT / 2,
          (FRONT_Z + TOWER_FACE_Z) / 2,
        ),
      ),
    ),
    new THREE.MeshStandardMaterial({ color: 0x1f211f, roughness: 0.7, metalness: 0.1 }),
  )
  group.add(pavements)

  const bollardZs = []
  for (let z = TOWER_FACE_Z + 4; z < ROAD.maxZ; z += MEDIAN.bollardSpacing) {
    bollardZs.push(z)
  }
  const bollards = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.12, 0.14, 1, 8).translate(0, MEDIAN.height + 0.5, 0),
    new THREE.MeshStandardMaterial({ color: 0x1c1e20, roughness: 0.5, metalness: 0.4 }),
    bollardZs.length,
  )
  const bands = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.135, 0.135, 0.12, 8).translate(0, MEDIAN.height + 0.85, 0),
    new THREE.MeshBasicMaterial({ color: REFLECTOR }),
    bollardZs.length,
  )
  const bollardMatrix = new THREE.Matrix4()
  bollardZs.forEach((z, i) => {
    bollardMatrix.makeTranslation(0, 0, z)
    bollards.setMatrixAt(i, bollardMatrix)
    bands.setMatrixAt(i, bollardMatrix)
  })
  group.add(bollards, bands)

  return {
    group,
    heroCenter,
    // Rain-soaked surfaces near road level, for the wet reflections.
    wetSurfaces: [
      { mesh: median, roughness: 0.3 },
      { mesh: kerbs, roughness: 0.35 },
      { mesh: paint, roughness: 0.3 },
      { mesh: pavements, roughness: 0.3 },
    ],
    update(analysis, delta, elapsed) {
      // Quiet passages: hits sometimes glitch a few screens for a 16th or 8th note.
      if (analysis.hit && Math.random() < GLITCH.chance * analysis.calm) {
        const duration = analysis.beatInterval * (Math.random() < 0.5 ? 0.25 : 0.5)
        for (const screen of [hero, ...screens]) {
          if (Math.random() < GLITCH.share) screen.glitch(duration)
        }
      }
      if (analysis.surge) {
        const beat = analysis.beatInterval
        for (const screen of [hero, ...screens]) {
          if (Math.random() < SURGE.share) {
            screen.glitch(beat * SURGE.beats, { surge: true, delay: Math.random() * beat * SURGE.spread })
          }
        }
      }
      hero.update(delta, elapsed, analysis)
      for (const screen of screens) screen.update(delta, elapsed, analysis)

      const { bass, treble } = analysis.levels
      for (const { light, screen } of spills) light.color.lerp(screen.glow, Math.min(1, delta * 2))
      // Bass-heavy moments glow amber, bright hi-hats glow cyan.
      heroGlow.lerpColors(WARM, COLD, treble / (bass + treble + 0.001) || 0.5)
      heroLight.color.lerp(heroGlow, Math.min(1, delta * 4))
      heroLight.intensity = THREE.MathUtils.lerp(
        heroLight.intensity,
        HERO_GLOW_BASE + bass * HERO_GLOW_BASS,
        Math.min(1, delta * 12),
      )
    },
  }
}
