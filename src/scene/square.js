import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { Screen } from './screens.js'
import { Visualiser } from './visualiser.js'
import { AdsContent, DeadContent, TickerContent } from './screenContent.js'

// A Times Square style plaza along the avenue at x = 0: the camera stands at
// the open end looking at a tower carrying the big visualiser screen, with
// a few worn advertising screens on the buildings either side.
const PLAZA_HALF_WIDTH = 20
const FRONT_Z = 45
const TOWER_FACE_Z = -72
const SCREEN_GAP = 0.25 // distance in front of the facade

export const CAMERA = {
  position: new THREE.Vector3(0, 1.8, 18),
  target: new THREE.Vector3(0, 24, -72),
}

// Traffic runs down the plaza between a tunnel in the tower's base and the
// street behind the camera. Oncoming lanes are on the left (drive on the right).
// Raised strip between the two directions; the camera stands on it.
const MEDIAN = { halfWidth: 2.5, height: 0.25, bollardSpacing: 10, bollardClearance: 8 }
const REFLECTOR = new THREE.Color(3, 1.4, 0.2)

// Lanes per side, from the reservation outwards (inside lanes are fastest).
const LANE = { width: 4, speeds: [44, 37, 30] }
const ROAD_INNER = MEDIAN.halfWidth + 0.25 // reservation kerb to first lane
const ROAD_OUTER = ROAD_INNER + LANE.width * LANE.speeds.length
const laneX = (i) => ROAD_INNER + LANE.width * (i + 0.5)
const LINE = { width: 0.15, dash: 3, gap: 6, y: 0.08 }
const PAVEMENT_HEIGHT = 0.18

const TUNNEL = { width: ROAD_OUTER * 2 + 2, height: 7 }
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

// 16:9, as wide as the plaza allows (the side buildings would hide anything wider)
const HERO = { x: 0, bottom: 12, width: 38, height: 21.375 }

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
  front(0, TOWER_FACE_Z, 8.8, HERO.width, 2.4, content.ticker()),
]

// Faint coloured spill from the larger adverts: [position, index into SCREENS].
const SPILL_LIGHTS = [
  [[-14, 14, -8], 2],
  [[14, 14, -4], 6],
]
const SPILL_INTENSITY = 120

const HERO_GLOW_BASE = 1500
const HERO_GLOW_BASS = 7000
const WARM = new THREE.Color(1, 0.55, 0.15)
const COLD = new THREE.Color(0.4, 0.85, 1)

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
    createContent: (ctx) => new Visualiser(ctx),
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

  // Tunnel mouth: a black opening in the tower's base with a concrete lintel.
  const tunnel = new THREE.Mesh(
    new THREE.PlaneGeometry(TUNNEL.width, TUNNEL.height),
    new THREE.MeshBasicMaterial({ color: 0x000000 }),
  )
  tunnel.position.set(0, TUNNEL.height / 2, TOWER_FACE_Z + 0.05)
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(TUNNEL.width + 2, 1.2, 0.8), frameMaterial)
  lintel.position.set(0, TUNNEL.height + 0.6, TOWER_FACE_Z + 0.3)
  group.add(tunnel, lintel)

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


  // Central reservation with kerbs and a row of reflective bollards that
  // stops short of the camera.
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
  group.add(
    new THREE.Mesh(
      mergeGeometries(markings),
      new THREE.MeshStandardMaterial({
        color: 0x8c8c86,
        roughness: 0.55,
        // Keeps the paint from flickering against the road surface below.
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -4,
      }),
    ),
  )

  // Pavements between the outside lanes and the buildings.
  const pavementWidth = PLAZA_HALF_WIDTH - ROAD_OUTER
  const pavementLength = FRONT_Z - TOWER_FACE_Z
  group.add(
    new THREE.Mesh(
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
    ),
  )

  const bollardZs = []
  for (let z = TOWER_FACE_Z + 4; z < CAMERA.position.z - MEDIAN.bollardClearance; z += MEDIAN.bollardSpacing) {
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
    update(analysis, delta, elapsed) {
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
