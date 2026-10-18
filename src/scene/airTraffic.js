import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

// Dropships and other craft crossing the skyline on long straight routes,
// high above the rooftops. Glow only, no real lights, so they're cheap.
const COUNT = 16
const ROUTE_HALF_LENGTH = 420 // each route runs this far either side of the city
const ROUTE_OFFSET = 260 // how far to the side of the city centre a route can pass
const CENTRE = new THREE.Vector3(0, 0, -20)
const BOB = 0.6

const NAV_RED = new THREE.Color(5, 0.2, 0.1)
const NAV_GREEN = new THREE.Color(0.2, 5, 0.6)
const STROBE = new THREE.Color(6, 6, 6)

const box = (w, h, d, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y, z)
const disc = (r, x, y, z) => new THREE.CircleGeometry(r, 10).rotateX(Math.PI / 2).translate(x, y, z)
const random = ([min, max]) => min + Math.random() * (max - min)

// Each variant: hull geometry, engine glow discs (pointing down), colour,
// engine colour, flight height and speed, plus optional lit `windows`.
export const VARIANTS = {
  gunship: {
    hull: () =>
      mergeGeometries([
        box(6, 2.5, 14),
        box(4.6, 1.4, 3, 0, -0.3, 8),
        box(9, 0.3, 4, 0, 0.6, -2),
        ...[-1, 1].flatMap((s) => [
          new THREE.CylinderGeometry(1, 1, 2.4, 10).translate(s * 4.6, 0.2, 2),
          new THREE.CylinderGeometry(1, 1, 2.4, 10).translate(s * 4.6, 0.2, -5),
        ]),
      ]),
    engines: () => mergeGeometries([-1, 1].flatMap((s) => [disc(0.85, s * 4.6, -1.02, 2), disc(0.85, s * 4.6, -1.02, -5)])),
    colour: 0x2b3036,
    engine: new THREE.Color(1.2, 2.4, 4),
    height: [80, 140],
    speed: [18, 26],
    wingspan: 4.6,
  },
  lifter: {
    hull: () =>
      mergeGeometries([
        box(7, 3, 22),
        box(5, 2, 4, 0, 0.2, 12),
        box(14, 0.4, 5, 0, 1, 0),
        box(5.5, 3.5, 12, 0, -3.8, -1), // slung cargo container
        box(0.3, 1.5, 0.3, -2, -1.9, -1),
        box(0.3, 1.5, 0.3, 2, -1.9, -1),
      ]),
    engines: () => mergeGeometries([-1, 1].flatMap((s) => [-7, 0, 7].map((z) => disc(1.1, s * 5.5, 0.75, z)))),
    colour: 0x3d3a33,
    engine: new THREE.Color(4, 2.2, 0.8),
    height: [100, 150],
    speed: [10, 15],
    wingspan: 7,
  },
  interceptor: {
    hull: () =>
      mergeGeometries([
        box(1.8, 1, 8),
        box(1.2, 0.7, 2, 0, 0.1, 5),
        box(7, 0.2, 2.5, 0, 0, -1.5), // wings, narrowing towards the tail
        box(4, 0.2, 1.5, 0, 0, -3.2),
        box(0.15, 1.4, 1.5, 0, 0.8, -3.5),
      ]),
    engines: () => mergeGeometries([disc(0.45, -0.5, -0.55, -3.8), disc(0.45, 0.5, -0.55, -3.8)]),
    colour: 0x24272b,
    engine: new THREE.Color(6, 2, 0.4),
    height: [70, 130],
    speed: [40, 55],
    wingspan: 3.5,
  },
  patrol: {
    hull: () =>
      mergeGeometries([
        box(4, 2, 10),
        box(3, 1.2, 2.5, 0, -0.2, 6),
        box(7, 0.25, 3, 0, 0.5, -1),
      ]),
    engines: () => mergeGeometries([-1, 1].map((s) => disc(0.8, s * 3.2, 0.37, -1))),
    colour: 0x1f2a33,
    engine: new THREE.Color(1, 2, 4),
    height: [60, 90],
    speed: [12, 18],
    wingspan: 3.5,
  },
  transport: {
    hull: () =>
      mergeGeometries([
        box(4.5, 3, 16),
        box(3.5, 2.2, 3, 0, -0.2, 9),
        box(10, 0.3, 3.5, 0, 0.2, -1),
        box(0.2, 2.5, 3, 0, 2.5, -7),
      ]),
    engines: () => mergeGeometries([-1, 1].flatMap((s) => [disc(0.9, s * 4.5, 0.05, -1), disc(0.6, s * 1.2, -1.52, -6)])),
    colour: 0xb8bcc0,
    engine: new THREE.Color(2.2, 2.6, 3.2),
    height: [90, 130],
    speed: [16, 22],
    wingspan: 5,
    windows: true,
  },
}

export function createShip(spec) {
  const group = new THREE.Group()
  group.add(
    new THREE.Mesh(spec.hull(), new THREE.MeshStandardMaterial({ color: spec.colour, roughness: 0.4, metalness: 0.7 })),
    new THREE.Mesh(spec.engines(), new THREE.MeshBasicMaterial({ color: spec.engine, side: THREE.DoubleSide })),
  )
  const basic = (color) => new THREE.MeshBasicMaterial({ color })
  const navRed = new THREE.Mesh(box(0.35, 0.35, 0.35, -spec.wingspan, 0.6, 0), basic(NAV_RED))
  const navGreen = new THREE.Mesh(box(0.35, 0.35, 0.35, spec.wingspan, 0.6, 0), basic(NAV_GREEN))
  const strobe = new THREE.Mesh(box(0.3, 0.3, 0.3, 0, 1.8, -5), basic(STROBE))
  group.add(navRed, navGreen, strobe)
  if (spec.windows) {
    // A strip of lit cabin windows down each side.
    group.add(
      new THREE.Mesh(
        mergeGeometries([-1, 1].map((s) => box(0.05, 0.4, 11, s * 2.27, 0.4, 0))),
        basic(new THREE.Color(2.4, 2.1, 1.4)),
      ),
    )
  }
  return { group, navRed, navGreen, strobe }
}

export function createAirTraffic() {
  const group = new THREE.Group()
  const variants = Object.values(VARIANTS)
  const ships = Array.from({ length: COUNT }, (_, i) => {
    const spec = variants[i % variants.length]
    const ship = createShip(spec)
    group.add(ship.group)
    return {
      ...ship,
      spec,
      start: new THREE.Vector3(),
      direction: new THREE.Vector3(),
      travelled: 0,
      speed: 0,
      phase: Math.random() * 10,
    }
  })

  // A new straight route across the city, at a random heading, offset and height.
  function route(ship, progress = 0) {
    const heading = Math.random() * Math.PI * 2
    ship.direction.set(Math.sin(heading), 0, Math.cos(heading))
    const side = new THREE.Vector3(ship.direction.z, 0, -ship.direction.x)
    ship.start
      .copy(CENTRE)
      .addScaledVector(side, (Math.random() * 2 - 1) * ROUTE_OFFSET)
      .addScaledVector(ship.direction, -ROUTE_HALF_LENGTH)
      .setY(random(ship.spec.height))
    ship.speed = random(ship.spec.speed)
    ship.travelled = progress
    ship.group.rotation.set(0, heading, 0)
  }
  for (const ship of ships) route(ship, Math.random() * ROUTE_HALF_LENGTH * 2)

  return {
    group,
    update(delta, elapsed) {
      for (const ship of ships) {
        ship.travelled += ship.speed * delta
        if (ship.travelled > ROUTE_HALF_LENGTH * 2) route(ship)
        ship.group.position.copy(ship.start).addScaledVector(ship.direction, ship.travelled)
        ship.group.position.y += Math.sin(elapsed * 0.7 + ship.phase) * BOB
        const blink = (elapsed + ship.phase) % 1
        ship.navRed.visible = ship.navGreen.visible = blink < 0.5
        ship.strobe.visible = blink < 0.06 || (blink > 0.14 && blink < 0.2)
      }
    },
  }
}
