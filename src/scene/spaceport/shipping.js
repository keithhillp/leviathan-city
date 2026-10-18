import * as THREE from 'three'
import { VARIANTS, createShip } from '../airTraffic.js'

// Ships coming and going: each pad takes landers in turn (a long braking
// approach, a hover and touchdown, a stay on the pad, then a climb out),
// while bigger traffic crosses the sky far above and the odd ship drops out
// of warp on the heaviest hits.
const HOVER = 26 // height above the pad where the vertical part starts and ends
const APPROACH = { distance: 1400, height: 650, seconds: [16, 20] }
const DESCENT_SECONDS = 6
const STAY_SECONDS = [12, 30]
const ASCENT_SECONDS = 4
const DEPART = { distance: 2000, height: 1400, seconds: 14 }
const PAD_COOLDOWN = [4, 14]
const MODELS_PER_VARIANT = 2

const TRANSITS = 7
const TRANSIT = { scale: 3, height: [350, 1100], offset: [500, 2500], halfLength: 4000, speed: [70, 140] }

const WARP = { seconds: 0.8, length: 1600, distance: [2500, 3500], idle: [12, 30], playing: [30, 60] }
const WARP_COLOUR = new THREE.Color(3, 4.5, 9)

const CHASE = { back: 34, up: 9, rate: 3 }

const random = ([min, max]) => min + Math.random() * (max - min)
const easeOut = (t) => 1 - (1 - t) ** 2
const easeIn = (t) => t * t

function quadratic(out, a, b, c, t) {
  const u = 1 - t
  return out.set(0, 0, 0).addScaledVector(a, u * u).addScaledVector(b, 2 * u * t).addScaledVector(c, t * t)
}

const scratch = new THREE.Vector3()
function quadraticTangent(out, a, b, c, t) {
  return out.subVectors(b, a).multiplyScalar(2 * (1 - t)).addScaledVector(scratch.subVectors(c, b), 2 * t)
}

// Turns `from` towards `to` (radians) the short way round.
function turn(from, to, amount) {
  const difference = Math.atan2(Math.sin(to - from), Math.cos(to - from))
  return from + difference * amount
}

function blink(ship, elapsed) {
  const phase = (elapsed + ship.phase) % 1
  ship.navRed.visible = ship.navGreen.visible = phase < 0.5
  ship.strobe.visible = phase < 0.06 || (phase > 0.14 && phase < 0.2)
}

// A downward exhaust cone under the hull, sized by `thrust`.
function createPlume(spec, bottom) {
  const material = new THREE.MeshBasicMaterial({
    color: spec.engine.clone(),
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
  const geometry = new THREE.ConeGeometry(spec.wingspan * 0.5, 1, 12, 1, true).rotateX(Math.PI).translate(0, -0.5, 0)
  const plume = new THREE.Mesh(geometry, material)
  plume.position.y = bottom
  return plume
}

function createLander(spec) {
  const ship = createShip(spec)
  const bounds = new THREE.Box3().setFromObject(ship.group)
  const plume = createPlume(spec, bounds.min.y)
  ship.group.add(plume)
  ship.group.rotation.order = 'YXZ'
  ship.group.visible = false
  return {
    ...ship,
    spec,
    plume,
    groundOffset: -bounds.min.y,
    phase: Math.random() * 10,
    pad: null,
    state: null,
    time: 0,
    duration: 0,
    heading: 0,
    exitHeading: 0,
    thrust: 0,
    path: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()],
  }
}

// A heading that doesn't come in over (or leave across) the terminal.
function fieldHeading() {
  return (Math.random() - 0.5) * Math.PI * 1.4
}

function createWarpFlash() {
  const material = new THREE.MeshBasicMaterial({
    color: WARP_COLOUR.clone(),
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    fog: false,
  })
  const streak = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material)
  streak.visible = false
  return { streak, material, time: Infinity }
}

export function createShipping({ pads }) {
  const group = new THREE.Group()
  const landers = Object.values(VARIANTS).flatMap((spec) =>
    Array.from({ length: MODELS_PER_VARIANT }, () => createLander(spec)),
  )
  for (const lander of landers) group.add(lander.group)

  const point = new THREE.Vector3()
  const tangent = new THREE.Vector3()
  const padState = pads.map(() => ({ lander: null, cooldown: random([0, 8]) }))

  function take(pad) {
    const free = landers.filter((lander) => !lander.state)
    if (!free.length) return null
    const lander = free[Math.floor(Math.random() * free.length)]
    lander.pad = pad
    lander.group.visible = true
    padState[pad.index].lander = lander
    return lander
  }

  function start(lander, state, duration) {
    lander.state = state
    lander.time = 0
    lander.duration = duration
  }

  function approach(lander) {
    const { position } = lander.pad
    const heading = fieldHeading()
    const away = new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading))
    const [a, b, c] = lander.path
    a.copy(position).addScaledVector(away, APPROACH.distance).setY(position.y + APPROACH.height)
    b.copy(position).addScaledVector(away, 300).setY(position.y + 70)
    c.copy(position).setY(position.y + HOVER)
    lander.heading = heading + Math.PI // facing the pad
    lander.thrust = 0.3
    start(lander, 'approach', random(APPROACH.seconds))
    lander.pad.status = 'inbound'
  }

  function land(lander, stay) {
    lander.group.position.copy(lander.pad.position).y += lander.groundOffset
    lander.heading = Math.random() * Math.PI * 2
    lander.group.rotation.set(0, lander.heading, 0)
    lander.thrust = 0
    start(lander, 'landed', stay)
    lander.pad.status = 'landed'
  }

  function release(lander) {
    padState[lander.pad.index].lander = null
    padState[lander.pad.index].cooldown = random(PAD_COOLDOWN)
    lander.pad.status = 'idle'
    lander.state = null
    lander.pad = null
    lander.group.visible = false
  }

  // Start with some ships already down, so the field isn't empty.
  for (const pad of pads) {
    if (Math.random() < 0.6) {
      const lander = take(pad)
      if (lander) land(lander, random([2, STAY_SECONDS[1]]))
    }
  }

  function updateLander(lander, delta, elapsed, analysis) {
    lander.time += delta
    const x = Math.min(1, lander.time / lander.duration)
    const { position } = lander.pad
    const [a, b, c] = lander.path
    const ship = lander.group
    let thrust = 0
    let pitch = 0

    if (lander.state === 'approach') {
      const t = easeOut(x)
      ship.position.copy(quadratic(point, a, b, c, t))
      quadraticTangent(tangent, a, b, c, t)
      if (x < 0.95) lander.heading = Math.atan2(tangent.x, tangent.z)
      // Nose up as it brakes.
      pitch = -Math.atan2(tangent.y, Math.hypot(tangent.x, tangent.z)) * 0.5 - 0.15 * x
      thrust = 0.3 + 0.7 * x
      if (x >= 1) start(lander, 'descend', DESCENT_SECONDS)
    } else if (lander.state === 'descend') {
      ship.position.copy(position)
      ship.position.y += lander.groundOffset + (HOVER - lander.groundOffset) * (1 - THREE.MathUtils.smootherstep(x, 0, 1))
      thrust = 0.9 - x * 0.3
      if (x >= 1) land(lander, random(STAY_SECONDS))
    } else if (lander.state === 'landed') {
      if (x >= 1) {
        lander.exitHeading = fieldHeading()
        start(lander, 'ascend', ASCENT_SECONDS)
        lander.pad.status = 'outbound'
      }
    } else if (lander.state === 'ascend') {
      ship.position.copy(position)
      ship.position.y += lander.groundOffset + (HOVER - lander.groundOffset) * easeIn(x)
      lander.heading = turn(lander.heading, lander.exitHeading, Math.min(1, delta * 1.2))
      thrust = 1.2
      if (x >= 1) {
        const away = new THREE.Vector3(Math.sin(lander.exitHeading), 0, Math.cos(lander.exitHeading))
        a.copy(ship.position)
        b.copy(position).addScaledVector(away, 120).setY(position.y + 110)
        c.copy(position).addScaledVector(away, DEPART.distance).setY(position.y + DEPART.height)
        start(lander, 'depart', DEPART.seconds)
      }
    } else if (lander.state === 'depart') {
      const t = easeIn(x)
      ship.position.copy(quadratic(point, a, b, c, t))
      quadraticTangent(tangent, a, b, c, Math.max(t, 0.05))
      lander.heading = turn(lander.heading, Math.atan2(tangent.x, tangent.z), Math.min(1, delta * 2))
      pitch = -Math.atan2(tangent.y, Math.hypot(tangent.x, tangent.z)) * 0.6
      thrust = 1
      if (lander.time > 5) lander.pad.status = 'idle'
      if (x >= 1) return release(lander)
    }

    if (lander.state !== 'landed') ship.rotation.set(THREE.MathUtils.lerp(ship.rotation.x, pitch, Math.min(1, delta * 3)), lander.heading, 0)
    lander.thrust += (thrust - lander.thrust) * Math.min(1, delta * 4)
    const length = lander.thrust * (5 + analysis.levels.bass * 4)
    lander.plume.visible = length > 0.2
    lander.plume.scale.set(1, Math.max(0.01, length), 1)
    lander.plume.material.color.copy(lander.spec.engine).multiplyScalar(0.5 * lander.thrust)
    blink(lander, elapsed)
  }

  // ---- High transits ----
  const transitSpecs = Object.values(VARIANTS)
  const transits = Array.from({ length: TRANSITS }, (_, i) => {
    const ship = createShip(transitSpecs[i % transitSpecs.length])
    ship.group.scale.setScalar(TRANSIT.scale)
    group.add(ship.group)
    return { ...ship, start: new THREE.Vector3(), direction: new THREE.Vector3(), travelled: 0, speed: 0, phase: Math.random() * 10 }
  })

  function route(ship, progress = 0) {
    const heading = Math.random() * Math.PI * 2
    ship.direction.set(Math.sin(heading), 0, Math.cos(heading))
    const side = new THREE.Vector3(ship.direction.z, 0, -ship.direction.x)
    const offset = random(TRANSIT.offset) * (Math.random() < 0.5 ? -1 : 1)
    ship.start
      .set(0, random(TRANSIT.height), 0)
      .addScaledVector(side, offset)
      .addScaledVector(ship.direction, -TRANSIT.halfLength)
    ship.speed = random(TRANSIT.speed)
    ship.travelled = progress
    ship.group.rotation.set(0, heading, 0)
  }
  for (const ship of transits) route(ship, Math.random() * TRANSIT.halfLength * 2)

  // ---- Warp arrivals ----
  const flashes = Array.from({ length: 3 }, createWarpFlash)
  for (const flash of flashes) group.add(flash.streak)
  let nextFlash = 0
  let untilWarp = random(WARP.idle)

  // A streak of light that snaps down to a point, leaving a ship behind it.
  function warp() {
    const flash = flashes[nextFlash++ % flashes.length]
    const azimuth = Math.random() * Math.PI * 2
    const elevation = THREE.MathUtils.degToRad(10 + Math.random() * 35)
    const at = new THREE.Vector3().setFromSphericalCoords(random(WARP.distance), Math.PI / 2 - elevation, azimuth)
    const heading = Math.random() * Math.PI * 2
    const direction = new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading))
    flash.streak.position.copy(at)
    flash.streak.lookAt(at.clone().add(direction))
    flash.direction = direction
    flash.time = 0
    flash.streak.visible = true

    // The transit furthest along its route arrives here.
    const ship = transits.reduce((best, s) => (s.travelled > best.travelled ? s : best))
    ship.direction.copy(direction)
    ship.start.copy(at)
    ship.travelled = 0
    ship.speed = random(TRANSIT.speed)
    ship.group.rotation.set(0, heading, 0)
  }

  // ---- Chase camera ----
  let followed = null
  const chasePosition = new THREE.Vector3()
  const chaseTarget = new THREE.Vector3()
  const look = new THREE.Matrix4()
  const up = new THREE.Vector3(0, 1, 0)

  return {
    group,
    warp,
    update(delta, elapsed, analysis) {
      for (const pad of pads) {
        const state = padState[pad.index]
        if (state.lander) continue
        state.cooldown -= delta
        if (state.cooldown <= 0) {
          const lander = take(pad)
          if (lander) approach(lander)
        }
      }
      for (const lander of landers) if (lander.state) updateLander(lander, delta, elapsed, analysis)

      for (const ship of transits) {
        ship.travelled += ship.speed * delta
        if (ship.travelled > TRANSIT.halfLength * 2) route(ship)
        ship.group.position.copy(ship.start).addScaledVector(ship.direction, ship.travelled)
        blink(ship, elapsed)
      }

      untilWarp -= delta
      if (analysis.surge || untilWarp <= 0) {
        warp()
        untilWarp = random(analysis.frame?.playing ? WARP.playing : WARP.idle)
      }
      for (const flash of flashes) {
        if (!flash.streak.visible) continue
        flash.time += delta
        const x = flash.time / WARP.seconds
        if (x >= 1) {
          flash.streak.visible = false
          continue
        }
        const fade = (1 - x) ** 3
        flash.streak.scale.set(3 + fade * 10, 3 + fade * 10, 4 + WARP.length * (1 - x) ** 4)
        flash.material.color.copy(WARP_COLOUR).multiplyScalar(0.3 + fade * 2)
      }
    },

    // Chase view behind a lander. Sticks with one ship through its whole visit,
    // then picks up the next arrival. False when nothing is flying.
    viewpoint(position, quaternion, delta) {
      if (!followed?.state) {
        const candidates = landers.filter((l) => l.state && l.state !== 'landed')
        followed = candidates.find((l) => l.state === 'approach') ?? candidates[0] ?? null
        if (!followed) return false
        chasePosition.set(Infinity, 0, 0) // cut, don't glide
      }
      const ship = followed.group
      const back = new THREE.Vector3(-Math.sin(followed.heading), 0, -Math.cos(followed.heading))
      const desired = ship.position.clone().addScaledVector(back, CHASE.back).add(new THREE.Vector3(0, CHASE.up, 0))
      if (!Number.isFinite(chasePosition.x)) chasePosition.copy(desired)
      else chasePosition.lerp(desired, Math.min(1, delta * CHASE.rate))
      chaseTarget.copy(ship.position).y += 2
      position.copy(chasePosition)
      quaternion.setFromRotationMatrix(look.lookAt(position, chaseTarget, up))
      return true
    },
  }
}
