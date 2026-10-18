import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { streamFor } from './plan.js'
import { bezier, buildLanes, connector, importanceOf, isGreen } from './lanes.js'

// Vehicles per unit of lane, by kind of road, when the city starts.
const DENSITY = { skyway: 1 / 40, highway: 1 / 38, radial: 1 / 35, express: 1 / 45 }
const ACCEL = 12 // units per second per second
const DECEL = 25 // hardest braking, for stopping behind something
// Vehicles slow for curves: through one, no faster than gives this much
// sideways acceleration, easing down to that speed beforehand.
const CORNERING = 10
const EASE = 10
const REROUTE = 6 // seconds stuck at a green light before trying another way
// Drawn as full vehicles this close to the camera; further, out to the fog,
// just their head and tail lights.
const NEAR = 180
const FAR = 380
const NEAR_CAPACITY = 400 // per vehicle type
const FAR_CAPACITY = 3000
const LIGHT_SIZE = 1.3 // of the distant head and tail lights
// Straight on is this much likelier than a turn, on top of traffic heading
// for the bigger roads (importanceOf): the radials and express decks.
const STRAIGHT_WEIGHT = 3

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

const LANE_CELL = 64 // spatial index of lanes, for finding the ones near a point
const GROUND_REACH = 3 // vehicles this low are on the ground, where incidents can reach them

// Traffic on the city plan's elevated roads (plan.js): lanes (lanes.js) round
// the rings, along the radials and express decks to the tower. Vehicles
// follow the one ahead, stop at red lights and pick a way on at each junction.
// All of them are simulated everywhere, so any one can be followed; near the
// camera they're drawn in full, further out as head and tail lights.
export function createTraffic({ plan, seed = 17 }) {
  const group = new THREE.Group()
  const { lanes } = buildLanes(plan)
  for (const lane of lanes) {
    lane.queue = [] // vehicles on it, front first
    lane.barriers = null // positions along it to stop short of (the mech, wrecks)
    lane.mid = [(lane.start[0] + lane.end[0]) / 2, (lane.start[2] + lane.end[2]) / 2]
  }

  // Lanes by area, for finding those near a point.
  const cells = new Map()
  const cellKey = (x, z) => `${Math.floor(x / LANE_CELL)},${Math.floor(z / LANE_CELL)}`
  for (const lane of lanes) {
    const [x0, x1] = [Math.min(lane.start[0], lane.end[0]), Math.max(lane.start[0], lane.end[0])]
    const [z0, z1] = [Math.min(lane.start[2], lane.end[2]), Math.max(lane.start[2], lane.end[2])]
    for (let x = Math.floor(x0 / LANE_CELL); x <= Math.floor(x1 / LANE_CELL); x++) {
      for (let z = Math.floor(z0 / LANE_CELL); z <= Math.floor(z1 / LANE_CELL); z++) {
        const key = `${x},${z}`
        if (!cells.has(key)) cells.set(key, [])
        cells.get(key).push(lane)
      }
    }
  }
  const lanesNear = (x, z, radius) => {
    const found = new Set()
    for (let cx = Math.floor((x - radius) / LANE_CELL); cx <= Math.floor((x + radius) / LANE_CELL); cx++) {
      for (let cz = Math.floor((z - radius) / LANE_CELL); cz <= Math.floor((z + radius) / LANE_CELL); cz++) {
        for (const lane of cells.get(`${cx},${cz}`) ?? []) found.add(lane)
      }
    }
    return found
  }

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

  // One set of instanced meshes per vehicle type, filled each frame with the
  // vehicles near the camera.
  const types = Object.values(VEHICLES).map((spec) => {
    const { width, length: poolLength } = spec.pool
    const geometries = {
      pool: new THREE.PlaneGeometry(width, poolLength)
        .rotateX(-Math.PI / 2)
        .translate(0, 0.1, spec.length / 2 + poolLength / 2), // just above the road
    }
    for (const part of PARTS) if (spec[part]) geometries[part] = spec[part]()
    const parts = {}
    for (const [part, geometry] of Object.entries(geometries)) {
      const mesh = new THREE.InstancedMesh(geometry, materials[part], NEAR_CAPACITY)
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      mesh.frustumCulled = false
      mesh.count = 0
      group.add(mesh)
      parts[part] = mesh
    }
    parts.body.setColorAt(0, new THREE.Color()) // creates its colour buffer
    return { spec, parts }
  })
  const police = types.find((type) => type.spec === VEHICLES.police)

  // Distant vehicles: a head light and a tail light each.
  const lightPositions = new Float32Array(FAR_CAPACITY * 2 * 3)
  const lightColours = new Float32Array(FAR_CAPACITY * 2 * 3)
  const lightGeometry = new THREE.BufferGeometry()
  lightGeometry.setAttribute('position', new THREE.BufferAttribute(lightPositions, 3).setUsage(THREE.DynamicDrawUsage))
  lightGeometry.setAttribute('color', new THREE.BufferAttribute(lightColours, 3).setUsage(THREE.DynamicDrawUsage))
  const lights = new THREE.Points(
    lightGeometry,
    new THREE.PointsMaterial({
      size: LIGHT_SIZE,
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  )
  lights.frustumCulled = false
  group.add(lights)

  // Vehicles: each on a lane at `s` along it (negative while still crossing
  // the junction onto it, on the curve `turn`), or tumbling as a wreck.
  const vehicles = []
  const spawnRng = streamFor(seed, 'traffic')
  const pickType = (rng) => {
    let roll = rng()
    return types.find((type) => (roll -= type.spec.chance) < 0) ?? types[0]
  }
  for (const lane of lanes) {
    const density = DENSITY[lane.kind] ?? 0
    let s = lane.length - spawnRng() * 10
    let count = Math.floor(lane.length * density + spawnRng())
    while (count-- > 0) {
      const rng = streamFor(seed, `vehicle:${vehicles.length}`)
      const type = pickType(rng)
      const half = type.spec.length / 2
      if (s - half < 0) break
      const vehicle = {
        id: vehicles.length,
        rng,
        type,
        colour: new THREE.Color(type.spec.colours[Math.floor(rng() * type.spec.colours.length)]),
        length: type.spec.length,
        lane,
        s,
        speed: lane.speed * 0.8,
        turn: null, // the curve it's crossing onto this lane by
        next: null, // the lane it'll go on to, and the curve there
        nextTurn: null,
        wait: 0,
        turnSpeed: Infinity, // for the curve onto `next`
        curveSpeed: Infinity, // for the curve it's on
        wreck: null,
        position: new THREE.Vector3(),
        heading: new THREE.Vector3(0, 0, 1),
      }
      vehicles.push(vehicle)
      lane.queue.push(vehicle)
      s -= type.spec.length + QUEUE_GAP + 4 + spawnRng() * 40
    }
  }

  function chooseNext(vehicle) {
    const { lane, rng } = vehicle
    const options = lane.next.map((id) => lanes[id])
    const weights = options.map((next) => {
      const along = lane.dir[0] * next.dir[0] + lane.dir[1] * next.dir[1]
      if (along < -0.7) return 0.05 // back the way it came: only if there's nothing else
      return importanceOf(next) * (along > 0.7 ? STRAIGHT_WEIGHT : 1)
    })
    let roll = rng() * weights.reduce((a, b) => a + b, 0)
    vehicle.next = options.find((_, i) => (roll -= weights[i]) < 0) ?? options[0]
    const turn = connector(lane, vehicle.next)
    vehicle.nextTurn = turn
    // How fast it can take the curve: by its radius, its length over how far it turns.
    vehicle.turnSpeed = Infinity
    if (turn) {
      const along = lane.dir[0] * vehicle.next.dir[0] + lane.dir[1] * vehicle.next.dir[1]
      const angle = Math.acos(THREE.MathUtils.clamp(along, -1, 1))
      if (angle > 0.05) vehicle.turnSpeed = Math.sqrt((CORNERING * turn.length) / angle)
    }
  }

  // Where a vehicle is, and which way it faces (its slope included).
  const onCurve = [0, 0, 0]
  const curveTangent = [0, 0, 0]
  function place(vehicle) {
    const { lane, s, turn } = vehicle
    if (s < 0 && turn) {
      bezier(turn, Math.max(0, 1 + s / turn.length), onCurve, curveTangent)
      vehicle.position.fromArray(onCurve)
      vehicle.heading.fromArray(curveTangent)
      if (vehicle.heading.lengthSq() < 1e-6) vehicle.heading.set(lane.dir[0], 0, lane.dir[1])
      vehicle.heading.normalize()
    } else {
      const t = Math.min(Math.max(s, 0), lane.length) / lane.length
      vehicle.position.set(
        lane.start[0] + (lane.end[0] - lane.start[0]) * t,
        lane.start[1] + (lane.end[1] - lane.start[1]) * t,
        lane.start[2] + (lane.end[2] - lane.start[2]) * t,
      )
      vehicle.heading.set(lane.dir[0], (lane.end[1] - lane.start[1]) / lane.length, lane.dir[1]).normalize()
    }
  }

  const euler = new THREE.Euler(0, 0, 0, 'YXZ')
  const orient = (heading, quaternion) =>
    quaternion.setFromEuler(
      euler.set(-Math.asin(THREE.MathUtils.clamp(heading.y, -1, 1)), Math.atan2(heading.x, heading.z), 0, 'YXZ'),
    )

  let time = 0
  let block = null // the mech's position ({ x, z }): lanes near it stop short of it
  let barrierLanes = []

  // Stopping places along lanes near the mech and any wrecks lying in the road.
  function updateBarriers() {
    for (const lane of barrierLanes) lane.barriers = null
    barrierLanes = []
    const add = (x, z, reach) => {
      for (const lane of lanesNear(x, z, LANE_CELL)) {
        if (lane.start[1] > 1) continue // not up on the highway
        const dx = x - lane.start[0]
        const dz = z - lane.start[2]
        const along = dx * lane.dir[0] + dz * lane.dir[1]
        const across = Math.abs(dx * lane.dir[1] - dz * lane.dir[0])
        if (across > reach || along < -10 || along > lane.length + 10) continue
        if (!lane.barriers) {
          lane.barriers = []
          barrierLanes.push(lane)
        }
        lane.barriers.push(along)
      }
    }
    if (block) add(block.x, block.z, BLOCK_LANES)
    for (const vehicle of vehicles) {
      if (vehicle.wreck?.landed) add(vehicle.wreck.position.x, vehicle.wreck.position.z, LANE_HALF)
    }
  }

  function drive(delta) {
    for (const lane of lanes) {
      const queue = lane.queue
      for (let i = 0; i < queue.length; i++) {
        const vehicle = queue[i]
        let limit = Infinity
        let green = true
        if (i > 0) {
          const ahead = queue[i - 1]
          limit = ahead.s - (ahead.length + vehicle.length) / 2 - QUEUE_GAP
        } else {
          // At the front: follow whoever's last onto the lane it's going on to,
          // and stop at the line on red (unless it's already over it).
          if (!vehicle.next) chooseNext(vehicle)
          const tail = vehicle.next.queue.at(-1)
          if (tail && tail !== vehicle) {
            const across = vehicle.nextTurn ? vehicle.nextTurn.length : 0
            limit = lane.length + across + tail.s - (tail.length + vehicle.length) / 2 - QUEUE_GAP
          }
          green = isGreen(lane, time)
          if (!green && vehicle.s + vehicle.length / 2 <= lane.length + 0.01) {
            limit = Math.min(limit, lane.length - vehicle.length / 2)
          }
        }
        if (lane.barriers) {
          for (const at of lane.barriers) if (at > vehicle.s) limit = Math.min(limit, at - vehicle.length / 2 - STOP_GAP)
        }
        const room = limit - vehicle.s
        const braking = room > 0 ? Math.sqrt(2 * DECEL * room) : 0
        // Easing down for the curve ahead, and holding that speed round one.
        if (!vehicle.next) chooseNext(vehicle)
        const toCurve = Math.max(0, lane.length - vehicle.s)
        const cornering = Math.min(
          Math.sqrt(vehicle.turnSpeed ** 2 + 2 * EASE * toCurve),
          vehicle.s < 0 ? vehicle.curveSpeed : Infinity,
        )
        vehicle.speed = Math.min(lane.speed, braking, cornering, vehicle.speed + ACCEL * delta)
        vehicle.s = Math.max(vehicle.s, Math.min(vehicle.s + vehicle.speed * delta, limit))
        // Stuck behind a lane that never clears: try another way.
        if (i === 0 && green && vehicle.speed < 0.5) {
          if ((vehicle.wait += delta) > REROUTE) {
            vehicle.next = null
            vehicle.wait = 0
          }
        } else {
          vehicle.wait = 0
        }
      }
    }
    // Over the end of the lane: on to the next.
    for (const lane of lanes) {
      const queue = lane.queue
      while (queue.length && queue[0].s >= lane.length) {
        const vehicle = queue.shift()
        if (!vehicle.next) chooseNext(vehicle)
        const turn = vehicle.nextTurn
        vehicle.s -= lane.length + (turn ? turn.length : 0)
        vehicle.turn = turn
        vehicle.curveSpeed = vehicle.turnSpeed
        vehicle.lane = vehicle.next
        vehicle.lane.queue.push(vehicle)
        chooseNext(vehicle) // now, so it can slow in good time for its next turn
      }
    }
  }

  // Wrecks waiting to rejoin traffic, once there's room for them.
  const rejoining = []
  function rejoin() {
    for (let i = rejoining.length - 1; i >= 0; i--) {
      const vehicle = rejoining[i]
      const lane = lanes[Math.floor(Math.random() * lanes.length)]
      const tail = lane.queue.at(-1)
      if (tail && tail.s < vehicle.length + 8) continue
      Object.assign(vehicle, { lane, s: 0, speed: 0, turn: null, next: null, nextTurn: null, curveSpeed: Infinity })
      vehicle.type = pickType(Math.random)
      vehicle.length = vehicle.type.spec.length
      vehicle.colour.set(vehicle.type.spec.colours[Math.floor(Math.random() * vehicle.type.spec.colours.length)])
      lane.queue.push(vehicle)
      rejoining.splice(i, 1)
    }
  }

  const matrix = new THREE.Matrix4()
  const quaternion = new THREE.Quaternion()
  const one = new THREE.Vector3(1, 1, 1)
  const spin = new THREE.Quaternion()
  const policeLight = new THREE.PointLight(0xffffff, 0, 30, 2)
  group.add(policeLight)

  function updateWreck(wreck, restY, delta) {
    if (!wreck.settled) {
      wreck.velocity.y -= GRAVITY * delta
      wreck.position.addScaledVector(wreck.velocity, delta)
      spin.setFromEuler(euler.set(wreck.spin.x * delta, wreck.spin.y * delta, wreck.spin.z * delta, 'XYZ'))
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
  }

  // Positions of every vehicle on the road ([x, z] pairs), for the map.
  const positions = new Float32Array(vehicles.length * 2)

  return {
    group,
    lanes,
    positions,
    // Blocks the lanes near `point` ({ x, z }, e.g. the mech), or null. The
    // point is read every frame, so a moving one can be passed once.
    setBlock(point) {
      block = point
    },
    // A driving vehicle down on the ground within `radius` of `point` (x/z),
    // or null (all traffic is up on the elevated roads now).
    findNear(point, radius) {
      let best = null
      let bestDistance = radius
      for (const vehicle of vehicles) {
        if (!vehicle.lane || vehicle.s < 0 || vehicle.position.y > GROUND_REACH) continue
        const distance = Math.hypot(vehicle.position.x - point.x, vehicle.position.z - point.z)
        if (distance < bestDistance) {
          best = vehicle
          bestDistance = distance
        }
      }
      return best
    },
    position(vehicle, out) {
      return out.copy(vehicle.wreck ? vehicle.wreck.position : vehicle.position).setY(0)
    },
    // Throws a vehicle out of traffic: it tumbles with `velocity` and `spin`
    // (radians/s per axis), calls onLand(position) on first impact, and comes to
    // rest on its roof, charred. False if there are too many wrecks already.
    wreck(vehicle, velocity, spinRates, onLand) {
      if (vehicles.filter((v) => v.wreck).length >= MAX_WRECKS || !vehicle.lane) return false
      const { queue } = vehicle.lane
      queue.splice(queue.indexOf(vehicle), 1)
      vehicle.lane = null
      vehicle.wreck = {
        position: vehicle.position.clone().setY(0.6),
        quaternion: orient(vehicle.heading, new THREE.Quaternion()),
        velocity: velocity.clone(),
        spin: spinRates.clone(),
        landed: false,
        settled: false,
        rest: null,
        onLand,
      }
      return true
    },
    // Clears every wreck; their vehicles rejoin traffic somewhere.
    clearWrecks() {
      for (const vehicle of vehicles) {
        if (!vehicle.wreck) continue
        vehicle.wreck = null
        rejoining.push(vehicle)
      }
    },
    // A vehicle for a camera to ride: `current` while it's still driving (or
    // tumbling as a wreck); otherwise, or with `next`, one of those nearest
    // `viewer`. Null if there are none.
    follow(current, next = false, viewer = null) {
      if (!next && current && (current.lane || (current.wreck && !current.wreck.settled))) return current
      if (!viewer) viewer = current?.position ?? new THREE.Vector3()
      const nearest = vehicles
        .filter((vehicle) => vehicle.lane && vehicle !== current && vehicle.s >= 0)
        .map((vehicle) => [vehicle, vehicle.position.distanceToSquared(viewer)])
        .sort((a, b) => a[1] - b[1])
        .slice(0, next ? 8 : 1)
      return nearest.length ? nearest[Math.floor(Math.random() * nearest.length)][0] : null
    },
    // Where a vehicle is (on the road at its centre) and which way it faces
    // (+z forward); returns its size ({ length, height }).
    pose(vehicle, position, out) {
      if (vehicle.wreck) {
        position.copy(vehicle.wreck.position)
        out.copy(vehicle.wreck.quaternion)
      } else {
        position.copy(vehicle.position)
        orient(vehicle.heading, out)
      }
      return vehicle.type.spec
    },
    // `viewer` (the camera position) decides what's drawn in full, and which
    // police car gets the real light.
    update(delta, viewer) {
      time += delta
      // Double flash: two red pulses, then two blue.
      const phase = (time * FLASH_RATE) % 1
      const pulse = (start) => phase >= start && phase < start + 0.25 && (phase - start) % 0.125 < 0.08
      const red = pulse(0)
      const blue = pulse(0.5)
      materials.beaconRed.color.copy(BEACON_RED).multiplyScalar(red ? 1 : BEACON_OFF)
      materials.beaconBlue.color.copy(BEACON_BLUE).multiplyScalar(blue ? 1 : BEACON_OFF)
      policeLight.color.set(red ? 0xff2010 : 0x2050ff)
      policeLight.intensity = 0

      updateBarriers()
      drive(delta)
      if (rejoining.length) rejoin()

      const counts = new Map()
      const add = (mesh, m) => {
        const index = counts.get(mesh) ?? 0
        if (index >= NEAR_CAPACITY) return -1
        mesh.setMatrixAt(index, m)
        counts.set(mesh, index + 1)
        return index
      }
      let lightCount = 0
      let nearestPolice = Infinity
      const nearSq = NEAR * NEAR
      const farSq = FAR * FAR
      vehicles.forEach((vehicle, i) => {
        if (vehicle.wreck) {
          updateWreck(vehicle.wreck, vehicle.type.spec.height, delta)
          matrix.compose(vehicle.wreck.position, vehicle.wreck.quaternion, one)
          for (const part of BODYWORK) {
            const mesh = vehicle.type.parts[part]
            if (!mesh) continue
            const index = add(mesh, matrix)
            if (part === 'body' && index >= 0) mesh.setColorAt(index, CHARRED)
          }
          return
        }
        if (!vehicle.lane) return // waiting to rejoin
        place(vehicle)
        const { position, heading } = vehicle
        positions[i * 2] = position.x
        positions[i * 2 + 1] = position.z
        const distance = position.distanceToSquared(viewer)
        if (distance < nearSq) {
          matrix.compose(position, orient(heading, quaternion), one)
          for (const [part, mesh] of Object.entries(vehicle.type.parts)) {
            const index = add(mesh, matrix)
            if (part === 'body' && index >= 0) mesh.setColorAt(index, vehicle.colour)
          }
          if (vehicle.type === police && distance < nearestPolice) {
            nearestPolice = distance
            policeLight.position.set(position.x, position.y + 2.2, position.z)
            policeLight.intensity = red || blue ? POLICE_LIGHT : 0
          }
        } else if (distance < farSq && lightCount < FAR_CAPACITY) {
          const half = vehicle.length / 2
          const k = lightCount * 6
          lightPositions[k] = position.x + heading.x * half
          lightPositions[k + 1] = position.y + 0.8
          lightPositions[k + 2] = position.z + heading.z * half
          lightPositions[k + 3] = position.x - heading.x * half
          lightPositions[k + 4] = position.y + 0.85
          lightPositions[k + 5] = position.z - heading.z * half
          HEADLIGHT.toArray(lightColours, k)
          TAILLIGHT.toArray(lightColours, k + 3)
          lightCount++
        }
      })

      for (const { parts } of types) {
        for (const mesh of Object.values(parts)) {
          mesh.count = counts.get(mesh) ?? 0
          mesh.instanceMatrix.needsUpdate = true
          if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
        }
      }
      lightGeometry.setDrawRange(0, lightCount * 2)
      lightGeometry.attributes.position.needsUpdate = true
      lightGeometry.attributes.color.needsUpdate = true
    },
  }
}
