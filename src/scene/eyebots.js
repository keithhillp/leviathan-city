import * as THREE from 'three'

const RADIUS = 0.8
const SPEED = 8 // units per second, top speed between stops
const TURN_RATE = 3 // how quickly a bot turns to face where it's going
const SCAN_TIME = [3, 6] // seconds spent scanning at each stop
const STANDOFF = [4, 7] // distance from the wall while scanning
const BOB = 0.3 // hover bob height
const SCAN_SWEEP = 1.8 // how far the scan line sweeps up and down the wall
const BEAM_SPREAD = 0.3 // beam radius per unit of length
const BEAM_FADE = 4 // per second

const EYE = new THREE.Color(3, 3.4, 3.6)
const BEACON = new THREE.Color(6, 0.2, 0.1)
const BEACON_OFF = 0.05
const BEAM = new THREE.Color(0.35, 0.7, 0.8)

const random = ([min, max]) => min + Math.random() * (max - min)

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

const additive = (color) =>
  new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  })

// Spherical eyebots flying between the plaza's building faces and scanning
// them. `patrol` is { wallX, z: [min, max], y: [min, max] }: walls at ±wallX,
// facing the street.
export function createEyebots({ patrol, count = 5 }) {
  const group = new THREE.Group()
  const metal = new THREE.MeshStandardMaterial({ color: 0x2a2e33, roughness: 0.35, metalness: 0.8 })
  const eyeMaterial = new THREE.MeshBasicMaterial({ color: EYE })

  function pickStop(bot) {
    bot.side = Math.random() < 0.5 ? -1 : 1
    const wallX = bot.side * patrol.wallX
    bot.target.set(wallX - bot.side * random(STANDOFF), random(patrol.y), random(patrol.z))
    bot.scanning = false
  }

  const bots = Array.from({ length: count }, () => {
    const body = new THREE.Group()
    const beaconMaterial = new THREE.MeshBasicMaterial({ color: BEACON })
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
      position: new THREE.Vector3(),
      target: new THREE.Vector3(),
      look: new THREE.Vector3(),
      facing: new THREE.Quaternion(),
      side: 1,
      scanning: false,
      scanLeft: 0,
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

  return {
    group,
    update(delta, elapsed) {
      for (const bot of bots) {
        toTarget.subVectors(bot.target, bot.position)
        const distance = toTarget.length()
        if (!bot.scanning) {
          if (distance < 0.3) {
            bot.scanning = true
            bot.scanLeft = random(SCAN_TIME)
          } else {
            const step = Math.min(distance, Math.min(SPEED, distance * 1.2) * delta)
            bot.position.addScaledVector(toTarget.normalize(), step)
            bot.look.copy(bot.target) // face where it's going
          }
        }
        if (bot.scanning) {
          bot.look.set(bot.side * patrol.wallX, bot.position.y, bot.position.z) // face the wall
          if ((bot.scanLeft -= delta) <= 0) pickStop(bot)
        }

        // Turn smoothly towards what it's looking at (ignoring tiny distances).
        if (bot.look.distanceToSquared(bot.position) > 0.01) {
          lookMatrix.lookAt(bot.look, bot.position, up)
          bot.facing.setFromRotationMatrix(lookMatrix)
          bot.body.quaternion.slerp(bot.facing, Math.min(1, delta * TURN_RATE))
        }
        bot.body.position.copy(bot.position)
        bot.body.position.y += Math.sin(elapsed * 1.5 + bot.phase) * BOB

        // Scan beam from the eye to the wall, plus a line sweeping the facade.
        const wallDistance = Math.abs(bot.side * patrol.wallX - bot.position.x) - RADIUS
        bot.beamLevel = THREE.MathUtils.clamp(bot.beamLevel + (bot.scanning ? 1 : -1) * delta * BEAM_FADE, 0, 1)
        bot.beam.visible = bot.scanLine.visible = bot.beamLevel > 0
        bot.beam.scale.setScalar(Math.max(0.01, wallDistance))
        bot.beam.material.opacity = bot.beamLevel * 0.18
        bot.scanLine.material.opacity = bot.beamLevel * 0.9
        bot.scanLine.position.set(
          bot.side * (patrol.wallX - 0.3),
          bot.body.position.y + Math.sin(elapsed * 3 + bot.phase) * SCAN_SWEEP,
          bot.position.z,
        )
        bot.scanLine.rotation.y = -bot.side * (Math.PI / 2) // flat on the wall, facing the street

        // Red antenna light: a quick double blink, each bot on its own rhythm.
        const blink = (elapsed * bot.blinkRate + bot.phase) % 1
        const lit = blink < 0.08 || (blink > 0.16 && blink < 0.24)
        bot.beaconMaterial.color.copy(BEACON).multiplyScalar(lit ? 1 : BEACON_OFF)
      }
    },
  }
}
