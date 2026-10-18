import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

// Ground crew: tugs pulling baggage carts, crew buses, fuel bowsers, a
// follow-me car and straddle carriers, driving closed service loops round the
// field. Positions are laid out to keep clear of the pads and buildings.
const ROUTES = [
  {
    // In front of the terminal and round the outside of the pad arc.
    speed: 9,
    points: [[-60, -25], [0, -22], [60, -25], [130, -15], [145, 45], [75, 92], [0, 90], [-75, 92], [-140, 40], [-130, -20]],
    vehicles: ['tug', 'bus', 'followMe', 'bowser', 'loader', 'tug'],
  },
  {
    // Out to the fuel farm and back.
    speed: 7,
    points: [[120, -30], [180, -5], [240, 30], [238, 100], [170, 125], [130, 85], [125, 30]],
    vehicles: ['bowser', 'bowser', 'followMe'],
  },
  {
    // West side: the hangars and round the container yard.
    speed: 6,
    points: [[-128, -70], [-128, 40], [-95, 100], [-175, 100], [-152, 40], [-150, -70]],
    vehicles: ['straddle', 'tug', 'straddle', 'loader'],
  },
]
const CART_SPACING = 4.2

const HEADLIGHT = new THREE.Color(1.3, 1.2, 1)
const TAILLIGHT = new THREE.Color(1.6, 0.08, 0.04)
const BEACON = new THREE.Color(3, 1.4, 0.1)

const box = (w, h, d, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y, z)

// Four dark wheels for a body of the given width and wheelbase.
const wheels = (width, base, radius = 0.4) =>
  [-1, 1].flatMap((sx) => [-1, 1].map((sz) => box(0.4, radius * 2, radius * 2, (sx * width) / 2, radius, (sz * base) / 2)))

// Each model: painted parts, dark parts, lit windows, and where its
// headlights, tail lights and roof beacon go (front is +z).
const MODELS = {
  tug: {
    colour: 0xd4a017,
    body: () => [box(2.2, 1, 3, 0, 0.9, 0), box(1.8, 1, 1.2, 0, 1.9, -0.6)],
    dark: () => wheels(2.2, 2),
    front: 1.5,
    back: -1.5,
    lightY: 1,
    lightX: 0.8,
    roof: 2.5,
    carts: 3,
  },
  cart: {
    colour: 0x5a6066,
    body: () => [box(1.8, 0.3, 3, 0, 0.7, 0), box(1.6, 1, 2.6, 0, 1.35, 0)],
    dark: () => [...wheels(1.8, 2, 0.3), box(0.2, 0.2, 1.4, 0, 0.5, 2.1)],
  },
  bus: {
    colour: 0xc8ccd0,
    body: () => [box(2.6, 2.6, 10, 0, 1.8, 0)],
    dark: () => wheels(2.6, 6.5, 0.5),
    windows: () => [-1, 1].map((s) => box(0.05, 0.9, 8, s * 1.31, 2.3, 0.2)),
    front: 5,
    back: -5,
    lightY: 1.2,
    lightX: 1,
    roof: 3.2,
  },
  followMe: {
    colour: 0xe8c020,
    body: () => [box(2, 0.8, 4, 0, 0.8, 0), box(1.8, 0.6, 2, 0, 1.5, -0.3)],
    dark: () => [...wheels(2, 2.6, 0.35), box(1.6, 0.25, 0.4, 0, 1.9, -0.3)],
    front: 2,
    back: -2,
    lightY: 0.8,
    lightX: 0.7,
    roof: 2.1,
  },
  bowser: {
    colour: 0xa82a20,
    body: () => [
      box(2.4, 2.2, 2.4, 0, 1.6, 3.2),
      new THREE.CylinderGeometry(1.3, 1.3, 6.2, 12).rotateX(Math.PI / 2).translate(0, 2, -1.2),
    ],
    dark: () => [...wheels(2.4, 6, 0.5), box(2.4, 0.5, 8, 0, 0.7, 0)],
    front: 4.4,
    back: -4.3,
    lightY: 1.3,
    lightX: 0.9,
    roof: 2.9,
  },
  loader: {
    colour: 0x6a7480,
    body: () => [box(3, 0.9, 7, 0, 1, 0), box(2.8, 0.4, 5, 0, 2.2, -0.8), box(1.6, 1.4, 1.4, -0.5, 2.1, 2.8)],
    dark: () => [...wheels(3, 5, 0.45), box(0.2, 1, 3, 0.8, 1.6, -0.8), box(0.2, 1, 3, -0.8, 1.6, -0.8)],
    front: 3.5,
    back: -3.5,
    lightY: 1,
    lightX: 1.2,
    roof: 2.9,
  },
  straddle: {
    // A tall frame on legs, carrying a container slung underneath.
    colour: 0xc89a1a,
    body: () => [
      ...[-1, 1].flatMap((s) => [box(0.6, 8, 0.6, s * 2.2, 4.4, 3), box(0.6, 8, 0.6, s * 2.2, 4.4, -3), box(0.6, 0.6, 7, s * 2.2, 8.4, 0)]),
      box(5, 0.6, 0.6, 0, 8.4, 3),
      box(5, 0.6, 0.6, 0, 8.4, -3),
      box(2, 1.6, 1.4, 1.2, 9.4, 3),
    ],
    dark: () => [
      ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => box(0.6, 0.8, 0.8, sx * 2.2, 0.4, sz * 3))),
      box(2.6, 2.6, 6.8, 0, 3, 0), // the container
    ],
    front: 3.5,
    back: -3.5,
    lightY: 1.2,
    lightX: 2.2,
    roof: 10.3,
  },
}

function createVehicle(name) {
  const spec = MODELS[name]
  const group = new THREE.Group()
  const paint = new THREE.MeshStandardMaterial({ color: spec.colour, roughness: 0.6, metalness: 0.3 })
  group.add(new THREE.Mesh(mergeGeometries(spec.body()), paint))
  group.add(new THREE.Mesh(mergeGeometries(spec.dark()), materials.dark))
  if (spec.windows) group.add(new THREE.Mesh(mergeGeometries(spec.windows()), materials.windows))
  let beacon = null
  if (spec.front !== undefined) {
    const lamps = (z, material) =>
      new THREE.Mesh(mergeGeometries([-1, 1].map((s) => box(0.35, 0.25, 0.1, s * spec.lightX, spec.lightY, z))), material)
    group.add(lamps(spec.front + 0.05, materials.headlight), lamps(spec.back - 0.05, materials.taillight))
    beacon = new THREE.Mesh(box(0.4, 0.3, 0.4, 0, spec.roof, 0), materials.beacon)
    group.add(beacon)
  }
  group.rotation.order = 'YXZ'
  return { group, beacon, phase: Math.random() }
}

let materials

export function createVehicles() {
  materials ??= {
    dark: new THREE.MeshStandardMaterial({ color: 0x1c1e20, roughness: 0.9 }),
    windows: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 0.7, 0.8) }),
    headlight: new THREE.MeshBasicMaterial({ color: HEADLIGHT }),
    taillight: new THREE.MeshBasicMaterial({ color: TAILLIGHT }),
    beacon: new THREE.MeshBasicMaterial({ color: BEACON }),
  }
  const group = new THREE.Group()
  const point = new THREE.Vector3()
  const tangent = new THREE.Vector3()

  const routes = ROUTES.map((route) => {
    const curve = new THREE.CatmullRomCurve3(
      route.points.map(([x, z]) => new THREE.Vector3(x, 0, z)),
      true,
      'centripetal',
    )
    const length = curve.getLength()
    const vehicles = route.vehicles.map((name, i) => {
      const vehicle = createVehicle(name)
      group.add(vehicle.group)
      // Evenly spaced round the loop, each with its train of carts.
      const carts = Array.from({ length: MODELS[name].carts ?? 0 }, () => {
        const cart = createVehicle('cart')
        group.add(cart.group)
        return cart
      })
      return { ...vehicle, carts, distance: (i / route.vehicles.length) * length }
    })
    return { curve, length, speed: route.speed, vehicles }
  })

  // Places a model at `distance` round the loop, facing along it.
  function place(route, object, distance) {
    const u = (((distance / route.length) % 1) + 1) % 1
    route.curve.getPointAt(u, point)
    route.curve.getTangentAt(u, tangent)
    object.position.copy(point)
    object.rotation.y = Math.atan2(tangent.x, tangent.z)
  }

  return {
    group,
    update(delta, elapsed) {
      for (const route of routes) {
        for (const vehicle of route.vehicles) {
          vehicle.distance += route.speed * delta
          place(route, vehicle.group, vehicle.distance)
          vehicle.carts.forEach((cart, i) => place(route, cart.group, vehicle.distance - (i + 1) * CART_SPACING - 0.6))
          // Rotating amber beacons read as a quick double flash.
          const phase = (elapsed * 1.6 + vehicle.phase) % 1
          if (vehicle.beacon) vehicle.beacon.visible = phase < 0.12 || (phase > 0.25 && phase < 0.33)
        }
      }
    },
  }
}
