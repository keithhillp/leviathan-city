import * as THREE from 'three'

const RADIUS = 0.8
const SPEED = 8 // units per second, top speed between stops
const TURN_RATE = 3 // how quickly a bot turns to face where it's going
const SCAN_TIME = [3, 6] // seconds spent scanning at each stop
const STANDOFF = [4, 7] // distance from the wall while scanning
const BOB = 0.3 // hover bob height
const SCAN_SWEEP = 1.2 // how far the scan line sweeps up and down over the window
const BEAM_SPREAD = 0.3 // beam radius per unit of length
const BEAM_FADE = 4 // per second

// A failed scan: the beam flashes red, then the bot fires on the spot it was
// scanning and sets it alight.
const FAIL_CHANCE = 0.05
const ALARM_TIME = 0.9 // seconds of red flashing before it opens fire
const SHOTS = 6
const SHOT_INTERVAL = 0.12
const SHOT_SPREAD = 0.8 // how far shots scatter around the target
const SHOT_SPEED = 60
const AFTER_FIRING = 0.8 // pause before moving on
const MAX_PROJECTILES = 24

// Swarming a target (the rogue mech during street incidents): circle it and
// open fire. Bots shot down fall and crash; they're rebuilt with reviveAll().
const SWARM_SPEED = 16
const SWARM_RADIUS = [7, 12]
const SWARM_HEIGHT = [5, 12] // above the ground
const SWARM_ORBIT = [0.4, 0.8] // radians per second, either way round
const SWARM_FIRE_EVERY = [0.3, 0.7] // seconds between bolts
const SWARM_SPREAD = 1.2
const SWARM_BOUNDS = 16 // stay this close to the street centre (clear of buildings)
const FALL_GRAVITY = 25

const EYE = new THREE.Color(3, 3.4, 3.6)
const EYE_ALARM = new THREE.Color(5, 0.3, 0.2)
const BEACON = new THREE.Color(6, 0.2, 0.1)
const BEACON_OFF = 0.05
const BEAM = new THREE.Color(0.35, 0.7, 0.8)
const BEAM_ALARM = new THREE.Color(1, 0.05, 0.03)
const PROJECTILE = new THREE.Color(6, 1.2, 0.3)

const random = ([min, max]) => min + Math.random() * (max - min)
const LENS_OFFSET = RADIUS + 0.15 // first-person camera sits just in front of the eye
const TURN_AROUND = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI)

// Shared geometry, all built with the bot facing +z.
const bodyGeometry = new THREE.SphereGeometry(RADIUS, 14, 10)
const bandGeometry = new THREE.TorusGeometry(RADIUS * 1.02, 0.06, 6, 20).rotateX(Math.PI / 2)
const eyeGeometry = new THREE.CylinderGeometry(0.28, 0.32, 0.25, 12)
  .rotateX(Math.PI / 2)
  .translate(0, 0, RADIUS * 0.92)
const antennaGeometry = new THREE.CylinderGeometry(0.03, 0.04, 1.2, 5).translate(0, RADIUS + 0.55, 0)
const beaconGeometry = new THREE.SphereGeometry(0.1, 8, 6).translate(0, RADIUS + 1.2, 0)
// Unit-length cone from the eye along +z; scaled to the distance to the wall.
const beamGeometry = new THREE.ConeGeometry(BEAM_SPREAD, 1, 16, 1, true)
  .translate(0, -0.5, 0)
  .rotateX(-Math.PI / 2)
const scanLineGeometry = new THREE.PlaneGeometry(3.5, 0.2)
const projectileGeometry = new THREE.BoxGeometry(0.12, 0.12, 1.4)

const additive = (color) =>
  new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  })

// Spherical eyebots flying between windows on the plaza's building faces and
// scanning them. `patrol.windows` is a list of { x, y, z, side }: window
// centres on walls facing the street (side -1 left, 1 right). A failed scan
// sets the window on fire via `fires`. They can also be set to swarm a target.
export function createEyebots({ patrol, fires, count = 5 }) {
  const group = new THREE.Group()
  const metal = new THREE.MeshStandardMaterial({ color: 0x2a2e33, roughness: 0.35, metalness: 0.8 })

  // Pool of bolts, reused as they land.
  const projectiles = Array.from({ length: MAX_PROJECTILES }, () => {
    const mesh = new THREE.Mesh(projectileGeometry, new THREE.MeshBasicMaterial({ color: PROJECTILE }))
    mesh.visible = false
    group.add(mesh)
    return { mesh, target: new THREE.Vector3(), bot: null, swarm: false }
  })

  // While set, every bot circles and shoots at this point (a live Vector3).
  let swarmTarget = null
  let swarmCallbacks = {}

  function pickStop(bot) {
    const spot = patrol.windows[Math.floor(Math.random() * patrol.windows.length)]
    bot.window = spot
    bot.side = spot.side
    bot.target.set(spot.x - spot.side * random(STANDOFF), spot.y, spot.z)
    bot.state = 'travel'
  }

  const bots = Array.from({ length: count }, () => {
    const body = new THREE.Group()
    const beaconMaterial = new THREE.MeshBasicMaterial({ color: BEACON })
    const eyeMaterial = new THREE.MeshBasicMaterial({ color: EYE })
    body.add(
      new THREE.Mesh(bodyGeometry, metal),
      new THREE.Mesh(bandGeometry, metal),
      new THREE.Mesh(eyeGeometry, eyeMaterial),
      new THREE.Mesh(antennaGeometry, metal),
      new THREE.Mesh(beaconGeometry, beaconMaterial),
    )
    const beam = new THREE.Mesh(beamGeometry, additive(BEAM))
    beam.position.z = RADIUS
    body.add(beam)
    const scanLine = new THREE.Mesh(scanLineGeometry, additive(BEAM))
    group.add(body, scanLine)

    const bot = {
      body,
      beam,
      scanLine,
      beaconMaterial,
      eyeMaterial,
      position: new THREE.Vector3(),
      target: new THREE.Vector3(),
      look: new THREE.Vector3(),
      facing: new THREE.Quaternion(),
      aim: new THREE.Vector3(), // the window a failed scan fires at
      window: null, // the window being visited
      side: 1,
      state: 'travel', // travel -> scan -> (alarm -> firing ->) travel; swarm; falling -> dead
      orbit: { angle: 0, radius: 0, height: 0, speed: 0 },
      fireTimer: 0,
      velocity: new THREE.Vector3(),
      timer: 0,
      shotsLeft: 0,
      litFire: false,
      beamLevel: 0,
      phase: Math.random() * 10,
      blinkRate: 0.8 + Math.random() * 0.6,
    }
    pickStop(bot)
    bot.position.copy(bot.target)
    pickStop(bot) // start somewhere, already heading somewhere else
    return bot
  })

  const toTarget = new THREE.Vector3()
  const lookMatrix = new THREE.Matrix4()
  const up = new THREE.Vector3(0, 1, 0)
  const eyeWorld = new THREE.Vector3()
  const wallNormal = new THREE.Vector3()

  function fire(bot, swarm = false) {
    const shot = projectiles.find((p) => !p.mesh.visible)
    if (!shot) return
    bot.body.localToWorld(eyeWorld.set(0, 0, RADIUS))
    shot.mesh.position.copy(eyeWorld)
    shot.target.copy(bot.aim)
    const spread = swarm ? SWARM_SPREAD : SHOT_SPREAD
    shot.target.x += swarm ? (Math.random() - 0.5) * spread : 0
    shot.target.y += (Math.random() - 0.5) * spread
    shot.target.z += (Math.random() - 0.5) * spread
    shot.mesh.lookAt(shot.target)
    shot.mesh.visible = true
    shot.bot = bot
    shot.swarm = swarm
  }

  function joinSwarm(bot) {
    bot.state = 'swarm'
    bot.orbit.angle = Math.random() * Math.PI * 2
    bot.orbit.radius = random(SWARM_RADIUS)
    bot.orbit.height = random(SWARM_HEIGHT)
    bot.orbit.speed = random(SWARM_ORBIT) * (Math.random() < 0.5 ? -1 : 1)
    bot.fireTimer = random(SWARM_FIRE_EVERY)
  }

  // Circles the swarm target, facing it and firing.
  function swarm(bot, delta) {
    const { orbit } = bot
    orbit.angle += orbit.speed * delta
    toTarget.set(
      THREE.MathUtils.clamp(swarmTarget.x + Math.cos(orbit.angle) * orbit.radius, -SWARM_BOUNDS, SWARM_BOUNDS),
      orbit.height,
      swarmTarget.z + Math.sin(orbit.angle) * orbit.radius,
    )
    toTarget.sub(bot.position)
    const distance = toTarget.length()
    if (distance > 0.01) bot.position.addScaledVector(toTarget.normalize(), Math.min(distance, SWARM_SPEED * delta))
    bot.look.copy(swarmTarget)
    if ((bot.fireTimer -= delta) <= 0) {
      bot.fireTimer = random(SWARM_FIRE_EVERY)
      bot.aim.copy(swarmTarget)
      fire(bot, true)
    }
  }

  // Shot down: tumbles out of the sky and crashes.
  function fall(bot, delta) {
    bot.velocity.y -= FALL_GRAVITY * delta
    bot.position.addScaledVector(bot.velocity, delta)
    bot.body.rotation.x += delta * 6
    bot.body.rotation.z += delta * 4
    if (bot.position.y <= RADIUS) {
      bot.state = 'dead'
      bot.body.visible = false
      swarmCallbacks.onCrash?.(bot.position.clone())
    }
  }

  function updateProjectiles(delta) {
    for (const shot of projectiles) {
      if (!shot.mesh.visible) continue
      toTarget.subVectors(shot.target, shot.mesh.position)
      const step = SHOT_SPEED * delta
      if (toTarget.length() <= step) {
        shot.mesh.visible = false
        if (shot.swarm) {
          swarmCallbacks.onHit?.(shot.target.clone())
          continue
        }
        // The first bolt of a volley to land starts the fire.
        if (!shot.bot.litFire) {
          shot.bot.litFire = true
          fires.ignite(shot.target, wallNormal.set(-shot.bot.side, 0, 0))
        }
      } else {
        shot.mesh.position.addScaledVector(toTarget.normalize(), step)
      }
    }
  }

  return {
    group,
    // Writes the first-person view from bot `index` into a camera's position
    // and quaternion (cameras look down -z, bots face +z).
    viewpoint(index, position, quaternion) {
      const { body } = bots[index % bots.length]
      quaternion.copy(body.quaternion).multiply(TURN_AROUND)
      position.set(0, 0, LENS_OFFSET).applyQuaternion(body.quaternion).add(body.position)
    },
    // Sends every bot to circle and shoot at `target` (a Vector3 that can keep
    // moving), or back to patrolling with null. onHit(point) is called as bolts
    // land on it; onCrash(point) when a bot that's been shot down hits the ground.
    setSwarm(target, callbacks = {}) {
      swarmTarget = target
      swarmCallbacks = callbacks
      for (const bot of bots) {
        if (target && bot.state !== 'falling' && bot.state !== 'dead') joinSwarm(bot)
        else if (!target && bot.state === 'swarm') pickStop(bot)
      }
    },
    // Bots currently swarming: [{ index, position }].
    swarmers() {
      return bots.flatMap((bot, index) => (bot.state === 'swarm' ? [{ index, position: bot.body.position }] : []))
    },
    // Knocks bot `index` out of the sky.
    shootDown(index) {
      const bot = bots[index]
      if (bot.state === 'falling' || bot.state === 'dead') return
      bot.state = 'falling'
      bot.velocity.set((Math.random() - 0.5) * 6, 4, (Math.random() - 0.5) * 6)
    },
    // Brings destroyed bots back on patrol (out of sight of the cleanup).
    reviveAll() {
      for (const bot of bots) {
        if (bot.state !== 'falling' && bot.state !== 'dead') continue
        pickStop(bot)
        bot.position.copy(bot.target)
        bot.body.rotation.set(0, 0, 0)
        bot.body.visible = true
        pickStop(bot)
      }
    },
    update(delta, elapsed) {
      for (const bot of bots) {
        if (bot.state === 'dead') {
          bot.beam.visible = bot.scanLine.visible = false
          continue
        }
        if (bot.state === 'falling') {
          fall(bot, delta)
          bot.body.position.copy(bot.position)
          bot.beam.visible = bot.scanLine.visible = false
          continue
        }
        toTarget.subVectors(bot.target, bot.position)
        const distance = toTarget.length()
        const wallX = bot.window.x

        if (bot.state === 'swarm') {
          swarm(bot, delta)
        } else if (bot.state === 'travel') {
          if (distance < 0.3) {
            bot.state = 'scan'
            bot.timer = random(SCAN_TIME)
          } else {
            const step = Math.min(distance, Math.min(SPEED, distance * 1.2) * delta)
            bot.position.addScaledVector(toTarget.normalize(), step)
            bot.look.copy(bot.target) // face where it's going
          }
        } else {
          bot.look.set(wallX, bot.window.y, bot.window.z) // face the window
          bot.timer -= delta
          if (bot.state === 'scan' && bot.timer <= 0) {
            if (Math.random() < FAIL_CHANCE) {
              bot.state = 'alarm'
              bot.timer = ALARM_TIME
              bot.aim.set(wallX, bot.window.y, bot.window.z)
            } else {
              pickStop(bot)
            }
          } else if (bot.state === 'alarm' && bot.timer <= 0) {
            bot.state = 'firing'
            bot.shotsLeft = SHOTS
            bot.litFire = false
            bot.timer = 0
          } else if (bot.state === 'firing' && bot.timer <= 0) {
            if (bot.shotsLeft > 0) {
              fire(bot)
              bot.shotsLeft--
              bot.timer = bot.shotsLeft > 0 ? SHOT_INTERVAL : AFTER_FIRING
            } else {
              pickStop(bot)
            }
          }
        }

        // Turn smoothly towards what it's looking at (ignoring tiny distances).
        if (bot.look.distanceToSquared(bot.position) > 0.01) {
          lookMatrix.lookAt(bot.look, bot.position, up)
          bot.facing.setFromRotationMatrix(lookMatrix)
          bot.body.quaternion.slerp(bot.facing, Math.min(1, delta * TURN_RATE))
        }
        bot.body.position.copy(bot.position)
        bot.body.position.y += Math.sin(elapsed * 1.5 + bot.phase) * BOB

        // Scan beam from the eye to the window, plus a line sweeping over it.
        // On a failed scan both flash red while the bot locks on.
        const alarm = bot.state === 'alarm'
        const beamOn = bot.state === 'scan' || alarm
        const flashOn = !alarm || Math.floor(elapsed * 10) % 2 === 0
        bot.beamLevel = THREE.MathUtils.clamp(bot.beamLevel + (beamOn ? 1 : -1) * delta * BEAM_FADE, 0, 1)
        bot.beam.visible = bot.scanLine.visible = bot.beamLevel > 0
        bot.beam.scale.setScalar(Math.max(0.01, Math.abs(wallX - bot.position.x) - RADIUS))
        const beamColour = alarm ? BEAM_ALARM : BEAM
        bot.beam.material.color.copy(beamColour)
        bot.scanLine.material.color.copy(beamColour)
        bot.beam.material.opacity = bot.beamLevel * (alarm ? 0.35 : 0.18) * (flashOn ? 1 : 0.2)
        bot.scanLine.material.opacity = bot.beamLevel * 0.9 * (flashOn ? 1 : 0.2)
        bot.scanLine.position.set(
          wallX - bot.side * 0.3,
          alarm ? bot.aim.y : bot.window.y + Math.sin(elapsed * 3 + bot.phase) * SCAN_SWEEP,
          bot.window.z,
        )
        bot.scanLine.rotation.y = -bot.side * (Math.PI / 2) // flat on the wall, facing the street
        const hostile = alarm || bot.state === 'firing' || bot.state === 'swarm'
        bot.eyeMaterial.color.copy(hostile ? EYE_ALARM : EYE)

        // Red antenna light: a quick double blink on its own rhythm, solid
        // while hostile.
        const blink = (elapsed * bot.blinkRate + bot.phase) % 1
        const lit = hostile || blink < 0.08 || (blink > 0.16 && blink < 0.24)
        bot.beaconMaterial.color.copy(BEACON).multiplyScalar(lit ? 1 : BEACON_OFF)
      }
      updateProjectiles(delta)
    },
  }
}
