import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

const VEHICLES_PER_LANE = 6
const MIN_GAP = 9 // nose to tail, so vehicles in a lane never overlap
const SPAWN_SPREAD = 70 // random extra gap, so traffic doesn't look periodic

const HEADLIGHT = new THREE.Color(6, 5.6, 4.6) // HDR so they bloom
const TAILLIGHT = new THREE.Color(5, 0.25, 0.1)
const HEAD_POOL = new THREE.Color(0.35, 0.33, 0.3) // headlight spill on the road ahead
const MARKER = new THREE.Color(4, 1.8, 0.2)
const BEACON_RED = new THREE.Color(7, 0.3, 0.2)
const BEACON_BLUE = new THREE.Color(0.3, 0.7, 7)
const BEACON_OFF = 0.04 // fraction of full brightness between flashes
const FLASH_RATE = 1.6 // red/blue cycles per second
const POLICE_LIGHT = 80 // the one real light that follows the nearest police car

// Queueing and wrecks (from the mech attacks).
const QUEUE_GAP = 1.5 // bumper to bumper in a queue
const STOP_GAP = 2.5 // stopping short of a blockage
const BLOCK_LANES = 6 // lanes within this (sideways) of the mech stop for it
const LANE_HALF = 2.2 // a wreck blocks lanes it's within this of
const MAX_WRECKS = 6
const GRAVITY = 30
const BOUNCE = 0.3
const SETTLE_SPEED = 2 // below this a wreck comes to rest
const CHARRED = new THREE.Color(0x0d0b0a)
// Parts that go dark on a wreck (lights, glow) and parts that stay (bodywork).
const BODYWORK = ['body', 'livery']

const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z)

function lightPair(spread, z, y, w, h) {
  return mergeGeometries([box(w, h, 0.06, -spread, y, z), box(w, h, 0.06, spread, y, z)])
}

const carBody = () =>
  mergeGeometries([box(1.9, 0.8, 4.4, 0, 0.7, 0), box(1.6, 0.55, 2.2, 0, 1.37, -0.3)])

// Every vehicle type is built from the same optional parts, centred on its
// length with the front facing +z. `body` takes per-vehicle colours from
// `colours`; `chance` is the share of traffic that is this type.
const VEHICLES = {
  car: {
    chance: 0.72,
    length: 4.4,
    height: 1.65,
    colours: ['#1b1d20', '#2a2d31', '#3b1f1c', '#1c2733', '#3e3e36', '#5c4c1c'],
    body: carBody,
    headlights: () => lightPair(0.65, 2.22, 0.8, 0.42, 0.16),
    taillights: () => lightPair(0.65, -2.22, 0.85, 0.36, 0.14),
    pool: { width: 3.2, length: 12 },
  },
  lorry: {
    chance: 0.2,
    length: 11,
    height: 4.3,
    colours: ['#8a8a82', '#4d5257', '#5e2f22', '#2f3a33', '#6b6250'],
    body: () =>
      mergeGeometries([
        box(2.3, 0.5, 11, 0, 0.75, 0), // chassis
        box(2.5, 2.4, 2.4, 0, 2.1, 4.3), // cab
        box(2.5, 3.3, 8.2, 0, 2.65, -1.3), // box trailer
      ]),
    headlights: () => lightPair(0.9, 5.52, 1.1, 0.5, 0.2),
    taillights: () => lightPair(1.0, -5.42, 1.1, 0.3, 0.3),
    markers: () =>
      mergeGeometries([-0.8, 0, 0.8].map((x) => box(0.25, 0.12, 0.12, x, 3.36, 5.3))),
    pool: { width: 4, length: 14 },
  },
  police: {
    chance: 0.08,
    length: 4.4,
    height: 1.8,
    colours: ['#0c0e12', '#141c2c'],
    body: carBody,
    livery: () => mergeGeometries([box(1.94, 0.22, 3.2, 0, 0.78, 0)]), // stripe along the doors
    beaconRed: () => box(0.6, 0.16, 0.3, -0.35, 1.72, -0.3),
    beaconBlue: () => box(0.6, 0.16, 0.3, 0.35, 1.72, -0.3),
    headlights: () => lightPair(0.65, 2.22, 0.8, 0.42, 0.16),
    taillights: () => lightPair(0.65, -2.22, 0.85, 0.36, 0.14),
    pool: { width: 3.2, length: 12 },
  },
}
const PARTS = ['body', 'livery', 'headlights', 'taillights', 'markers', 'beaconRed', 'beaconBlue']
const MAX_LENGTH = Math.max(...Object.values(VEHICLES).map((v) => v.length))

// Soft elongated glow for the headlight pool on the road: brightest at
// the top edge (the vehicle end of the plane), fading to nothing at every edge.
function createPoolTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 256
  const ctx = canvas.getContext('2d')
  ctx.setTransform(1, 0, 0, 4, 0, 0) // stretch a circle into a long ellipse
  const gradient = ctx.createRadialGradient(32, 0, 0, 32, 0, 32)
  gradient.addColorStop(0, 'rgba(255, 240, 210, 1)')
  gradient.addColorStop(0.4, 'rgba(255, 240, 210, 0.35)')
  gradient.addColorStop(1, 'rgba(255, 240, 210, 0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, 64, 64)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

// Simple box vehicles on straight lanes along z. Lanes are { x, dir, speed }
// with dir +1 heading towards +z; the road runs from `minZ` to `maxZ`, and both
// ends should be out of sight (inside a tunnel, behind the camera). Vehicles
// in a lane share a speed, so they never collide.
export function createTraffic({ lanes, minZ, maxZ }) {
  const group = new THREE.Group()
  const count = lanes.length * VEHICLES_PER_LANE
  const length = maxZ - minZ

  const materials = {
    body: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.6 }),
    headlights: new THREE.MeshBasicMaterial({ color: HEADLIGHT }),
    taillights: new THREE.MeshBasicMaterial({ color: TAILLIGHT }),
    markers: new THREE.MeshBasicMaterial({ color: MARKER }),
    livery: new THREE.MeshStandardMaterial({ color: 0xc8ccc8, roughness: 0.4, metalness: 0.3 }),
    beaconRed: new THREE.MeshBasicMaterial({ color: BEACON_RED }),
    beaconBlue: new THREE.MeshBasicMaterial({ color: BEACON_BLUE }),
    pool: new THREE.MeshBasicMaterial({
      map: createPoolTexture(),
      color: HEAD_POOL,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  }

  // One set of instanced meshes per vehicle type, each with a slot for every
  // vehicle; a vehicle is shown in its type's meshes and hidden in the rest.
  const types = Object.values(VEHICLES).map((spec) => {
    const { width, length: poolLength } = spec.pool
    const geometries = {
      pool: new THREE.PlaneGeometry(width, poolLength)
        .rotateX(-Math.PI / 2)
        .translate(0, 0.1, spec.length / 2 + poolLength / 2), // just above the lane markings
    }
    for (const part of PARTS) if (spec[part]) geometries[part] = spec[part]()
    const meshes = {}
    for (const [part, geometry] of Object.entries(geometries)) {
      const mesh = new THREE.InstancedMesh(geometry, materials[part], count)
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      mesh.frustumCulled = false
      group.add(mesh)
      meshes[part] = mesh
    }
    return { spec, meshes: Object.values(meshes), parts: meshes, body: meshes.body }
  })

  const colour = new THREE.Color()
  function assignType(vehicle) {
    let roll = Math.random()
    vehicle.type = types.find((type) => (roll -= type.spec.chance) < 0) ?? types[0]
    const { colours } = vehicle.type.spec
    colour.set(colours[Math.floor(Math.random() * colours.length)])
    vehicle.type.body.setColorAt(vehicle.index, colour)
    vehicle.type.body.instanceColor.needsUpdate = true
  }

  // Gap behind a vehicle before the next can follow; uses the longest type so
  // a re-rolled vehicle never overlaps its neighbours.
  const spacing = () => MAX_LENGTH + MIN_GAP + Math.random() * SPAWN_SPREAD

  // `s` is distance travelled along the lane; outside 0..length the vehicle is
  // waiting off-screen and hidden.
  const vehicles = []
  lanes.forEach((lane, l) => {
    let s = Math.random() * length
    for (let i = 0; i < VEHICLES_PER_LANE; i++) {
      const vehicle = { lane, s, index: l * VEHICLES_PER_LANE + i }
      assignType(vehicle)
      vehicles.push(vehicle)
      s -= spacing()
    }
  })

  const matrix = new THREE.Matrix4()
  const position = new THREE.Vector3()
  const forward = new THREE.Quaternion()
  const reversed = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI)
  const one = new THREE.Vector3(1, 1, 1)
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0)

  const police = types.find((type) => type.spec === VEHICLES.police)
  const policeLight = new THREE.PointLight(0xffffff, 0, 30, 2)
  group.add(policeLight)
  let time = 0
  let block = null // the mech's position ({ x, z }): lanes near it stop short of it

  const zOf = (vehicle) => (vehicle.lane.dir > 0 ? minZ + vehicle.s : maxZ - vehicle.s)
  const sOf = (lane, z) => (lane.dir > 0 ? z - minZ : maxZ - z)
  const spin = new THREE.Quaternion()
  const euler = new THREE.Euler()

  function placeWreck(vehicle) {
    const { wreck } = vehicle
    matrix.compose(wreck.position, wreck.quaternion, one)
    for (const type of types) {
      for (const [part, mesh] of Object.entries(type.parts)) {
        const shown = type === vehicle.type && BODYWORK.includes(part)
        mesh.setMatrixAt(vehicle.index, shown ? matrix : hidden)
      }
    }
  }

  function updateWreck(vehicle, delta) {
    const { wreck } = vehicle
    const restY = vehicle.type.spec.height
    if (!wreck.settled) {
      wreck.velocity.y -= GRAVITY * delta
      wreck.position.addScaledVector(wreck.velocity, delta)
      spin.setFromEuler(euler.set(wreck.spin.x * delta, wreck.spin.y * delta, wreck.spin.z * delta))
      wreck.quaternion.multiply(spin)
      if (wreck.position.y <= 0.6 && wreck.velocity.y < 0) {
        if (!wreck.landed) {
          wreck.landed = true
          wreck.onLand?.(wreck.position.clone())
        }
        wreck.velocity.multiplyScalar(BOUNCE)
        wreck.velocity.y = Math.abs(wreck.velocity.y)
        wreck.spin.multiplyScalar(0.4)
        wreck.position.y = 0.6
        if (wreck.velocity.length() < SETTLE_SPEED) {
          wreck.settled = true
          // Come to rest on its roof, facing wherever it ended up.
          const yaw = euler.setFromQuaternion(wreck.quaternion, 'YXZ').y
          wreck.rest = new THREE.Quaternion().setFromEuler(euler.set(0, yaw, Math.PI, 'YXZ'))
        }
      }
    } else {
      wreck.quaternion.slerp(wreck.rest, Math.min(1, delta * 6))
      wreck.position.y += (restY - wreck.position.y) * Math.min(1, delta * 6)
    }
    placeWreck(vehicle)
  }

  // Lane positions (s) that vehicles must stop short of: wrecks lying in the
  // lane, and the mech for the lanes nearest the street centre.
  function barriers(lane) {
    const list = []
    if (block && Math.abs(lane.x - block.x) < BLOCK_LANES) list.push(sOf(lane, block.z))
    for (const v of vehicles) {
      if (v.wreck && v.wreck.landed && Math.abs(v.wreck.position.x - lane.x) < LANE_HALF) {
        list.push(sOf(lane, v.wreck.position.z))
      }
    }
    return list
  }

  function drive(delta) {
    for (const lane of lanes) {
      const stops = barriers(lane)
      // Front of the queue first, so each vehicle can stop behind the one ahead.
      const queue = vehicles.filter((v) => v.lane === lane && !v.wreck).sort((a, b) => b.s - a.s)
      let ahead = null
      for (const vehicle of queue) {
        const half = vehicle.type.spec.length / 2
        let next = vehicle.s + lane.speed * delta
        for (const stop of stops) {
          if (vehicle.s < stop) next = Math.min(next, stop - half - STOP_GAP)
        }
        if (ahead) next = Math.min(next, ahead.s - ahead.type.spec.length / 2 - half - QUEUE_GAP)
        vehicle.s = Math.max(vehicle.s, next) // never reverse
        ahead = vehicle
      }
    }
  }

  return {
    group,
    // Blocks the lanes near `point` ({ x, z }, e.g. the mech) at its z, or null.
    // The point is read every frame, so a moving one can be passed once.
    setBlock(point) {
      block = point
    },
    // A driving, on-screen vehicle within `radius` of `point` (x/z), or null.
    findNear(point, radius) {
      let best = null
      let bestDistance = radius
      for (const vehicle of vehicles) {
        if (vehicle.wreck || vehicle.s < 0 || vehicle.s > length) continue
        const distance = Math.hypot(vehicle.lane.x - point.x, zOf(vehicle) - point.z)
        if (distance < bestDistance) {
          best = vehicle
          bestDistance = distance
        }
      }
      return best
    },
    position(vehicle, out) {
      return out.set(vehicle.lane.x, 0, zOf(vehicle))
    },
    // Throws a vehicle out of traffic: it tumbles with `velocity` and `spin`
    // (radians/s per axis), calls onLand(position) on first impact, and comes to
    // rest on its roof, charred. False if there are too many wrecks already.
    wreck(vehicle, velocity, spinRates, onLand) {
      if (vehicles.filter((v) => v.wreck).length >= MAX_WRECKS) return false
      vehicle.wreck = {
        position: new THREE.Vector3(vehicle.lane.x, 0.6, zOf(vehicle)),
        quaternion: (vehicle.lane.dir > 0 ? forward : reversed).clone(),
        velocity: velocity.clone(),
        spin: spinRates.clone(),
        landed: false,
        settled: false,
        rest: null,
        onLand,
      }
      vehicle.type.body.setColorAt(vehicle.index, CHARRED)
      vehicle.type.body.instanceColor.needsUpdate = true
      return true
    },
    // Clears every wreck; their vehicles rejoin the back of their lanes.
    clearWrecks() {
      for (const vehicle of vehicles) {
        if (!vehicle.wreck) continue
        vehicle.wreck = null
        const last = Math.min(...vehicles.filter((v) => v.lane === vehicle.lane && !v.wreck).map((v) => v.s), 0)
        vehicle.s = last - spacing()
        assignType(vehicle)
      }
    },
    // `viewer` (the camera position) decides which police car gets the real light.
    update(delta, viewer) {
      // Double flash: two red pulses, then two blue.
      time += delta
      const phase = (time * FLASH_RATE) % 1
      const pulse = (start) => phase >= start && phase < start + 0.25 && (phase - start) % 0.125 < 0.08
      const red = pulse(0)
      const blue = pulse(0.5)
      materials.beaconRed.color.copy(BEACON_RED).multiplyScalar(red ? 1 : BEACON_OFF)
      materials.beaconBlue.color.copy(BEACON_BLUE).multiplyScalar(blue ? 1 : BEACON_OFF)
      policeLight.color.set(red ? 0xff2010 : 0x2050ff)
      policeLight.intensity = 0
      let nearest = Infinity

      drive(delta)
      for (const vehicle of vehicles) {
        if (vehicle.wreck) {
          updateWreck(vehicle, delta)
          continue
        }
        if (vehicle.s > length) {
          // Re-queue behind the last vehicle in this lane, possibly as a different type.
          const last = Math.min(...vehicles.filter((v) => v.lane === vehicle.lane && !v.wreck).map((v) => v.s))
          vehicle.s = Math.min(0, last) - spacing()
          assignType(vehicle)
        }

        if (vehicle.s < 0) {
          matrix.copy(hidden)
        } else {
          const z = zOf(vehicle)
          position.set(vehicle.lane.x, 0, z)
          matrix.compose(position, vehicle.lane.dir > 0 ? forward : reversed, one)
          const distance = position.distanceToSquared(viewer)
          if (vehicle.type === police && distance < nearest) {
            nearest = distance
            policeLight.position.set(vehicle.lane.x, 2.2, z)
            policeLight.intensity = red || blue ? POLICE_LIGHT : 0
          }
        }
        for (const type of types) {
          for (const mesh of type.meshes) {
            mesh.setMatrixAt(vehicle.index, type === vehicle.type ? matrix : hidden)
          }
        }
      }
      for (const type of types) {
        for (const mesh of type.meshes) mesh.instanceMatrix.needsUpdate = true
      }
    },
  }
}
