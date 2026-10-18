import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

// Every so often a VTOL flies in and lands on a rooftop that's in view of the
// current camera, sits for a while, then takes off and flies away.
const INTERVAL = [45, 90] // seconds between visits
const FIRST_DELAY = 20
const RETRY = 5 // seconds before looking again if no rooftop was in view

const MIN_ROOF = 10 // roof width/depth needed to land
const ROOF_HEIGHT = [12, 120]
const VIEW_DISTANCE = [35, 200] // rooftops nearer or further aren't picked
const VIEW_MARGIN = [0.8, 0.75] // how far towards the screen edges (x, y) a roof can be

const INBOUND_TIME = 7
const DESCEND_TIME = 3
const LANDED_TIME = [8, 14]
const ASCEND_TIME = 2.5
const OUTBOUND_TIME = 7
const SPAWN_DISTANCE = 170 // where it appears from / leaves to, out of shot
const SPAWN_HEIGHT = 60 // above the roof (and at least SAFE_HEIGHT)
const SAFE_HEIGHT = 110
const HOVER_HEIGHT = 12 // above the roof before descending
const SKID_HEIGHT = 1.4

const ROTOR_FLYING = 30 // radians per second
const ROTOR_IDLE = 6
const SEARCHLIGHT = 700
const PAD_LIGHTS = 8
const PAD_RADIUS = 3.2

const COCKPIT = new THREE.Color(0.5, 1.6, 2)
const NAV_RED = new THREE.Color(5, 0.2, 0.1)
const NAV_GREEN = new THREE.Color(0.2, 5, 0.6)
const STROBE = new THREE.Color(6, 6, 6)
const PAD = new THREE.Color(4, 1.8, 0.3)

const box = (w, h, d, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y, z)
const ease = (t) => t * t * (3 - 2 * t)
const clamp01 = (t) => Math.min(1, Math.max(0, t))
const random = ([min, max]) => min + Math.random() * (max - min)

function createVtol() {
  const group = new THREE.Group()
  const hull = new THREE.MeshStandardMaterial({ color: 0x33373c, roughness: 0.35, metalness: 0.75 })
  const basic = (color) => new THREE.MeshBasicMaterial({ color })
  group.add(
    new THREE.Mesh(
      mergeGeometries([
        box(1.8, 1.4, 5, 0, 0, 0.5), // fuselage
        box(1.4, 1, 1.6, 0, -0.1, 3.6), // nose
        box(0.5, 0.5, 4, 0, 0.3, -3.6), // tail boom
        box(0.1, 1.2, 1, -0.4, 0.9, -5.2), // twin fins
        box(0.1, 1.2, 1, 0.4, 0.9, -5.2),
        box(5.6, 0.18, 1.2, 0, 0.2, 0.3), // stub wings
        box(0.12, 0.12, 3.4, -0.7, -1, 0.5), // skids
        box(0.12, 0.12, 3.4, 0.7, -1, 0.5),
        box(0.1, 0.6, 0.1, -0.7, -0.7, -0.5),
        box(0.1, 0.6, 0.1, 0.7, -0.7, -0.5),
        box(0.1, 0.6, 0.1, -0.7, -0.7, 1.5),
        box(0.1, 0.6, 0.1, 0.7, -0.7, 1.5),
        ...[-1, 1].map((side) => new THREE.TorusGeometry(1.1, 0.14, 6, 18).rotateX(Math.PI / 2).translate(side * 3.4, 0.2, 0.3)),
      ]),
      hull,
    ),
    new THREE.Mesh(box(1.3, 0.5, 1.2, 0, 0.35, 2.6), basic(COCKPIT)), // canopy
  )
  // Ducted fans: three blades spinning inside each ring.
  const rotors = [-1, 1].map((side) => {
    const rotor = new THREE.Group()
    rotor.position.set(side * 3.4, 0.2, 0.3)
    rotor.add(new THREE.Mesh(mergeGeometries([0, 1, 2].map((i) => box(0.12, 0.04, 2).rotateY((i * Math.PI * 2) / 3))), hull))
    group.add(rotor)
    return rotor
  })
  const navRed = new THREE.Mesh(box(0.2, 0.2, 0.2, -4.6, 0.2, 0.3), basic(NAV_RED))
  const navGreen = new THREE.Mesh(box(0.2, 0.2, 0.2, 4.6, 0.2, 0.3), basic(NAV_GREEN))
  const strobe = new THREE.Mesh(box(0.2, 0.2, 0.2, 0, 1.6, -5.3), basic(STROBE))
  group.add(navRed, navGreen, strobe)
  const searchlight = new THREE.SpotLight(0xeef4ff, 0, 60, 0.45, 0.6, 1.4)
  searchlight.position.set(0, -0.8, 3)
  group.add(searchlight, searchlight.target)
  group.visible = false
  return { group, rotors, navRed, navGreen, strobe, searchlight }
}

// `rooftops` are { x, z, w, d, y } (centre, size, roof height).
export function createHelicopter({ rooftops }) {
  const group = new THREE.Group()
  const vtol = createVtol()
  const pad = new THREE.Group()
  const padLights = Array.from({ length: PAD_LIGHTS }, (_, i) => {
    const angle = (i / PAD_LIGHTS) * Math.PI * 2
    const light = new THREE.Mesh(box(0.35, 0.15, 0.35), new THREE.MeshBasicMaterial({ color: PAD }))
    light.position.set(Math.sin(angle) * PAD_RADIUS, 0.1, Math.cos(angle) * PAD_RADIUS)
    pad.add(light)
    return light
  })
  pad.visible = false
  group.add(vtol.group, pad)

  const landable = rooftops.filter(
    (roof) => roof.w >= MIN_ROOF && roof.d >= MIN_ROOF && roof.y >= ROOF_HEIGHT[0] && roof.y <= ROOF_HEIGHT[1],
  )

  let phase = 'idle'
  let phaseTime = 0
  let wait = FIRST_DELAY
  let landedTime = 0
  let rotorSpeed = 0
  const roof = new THREE.Vector3() // landing point (skids on the roof)
  const hover = new THREE.Vector3()
  const start = new THREE.Vector3()
  const control = new THREE.Vector3()
  const exit = new THREE.Vector3()
  const previous = new THREE.Vector3()
  const projected = new THREE.Vector3()
  const curve = new THREE.QuadraticBezierCurve3(start, control, hover)

  // A landable rooftop the camera can currently see (centre on screen, in range).
  function pickRoof(camera) {
    const visible = landable.filter((r) => {
      projected.set(r.x, r.y + 2, r.z)
      const distance = projected.distanceTo(camera.position)
      if (distance < VIEW_DISTANCE[0] || distance > VIEW_DISTANCE[1]) return false
      projected.project(camera)
      return (
        projected.z < 1 && Math.abs(projected.x) < VIEW_MARGIN[0] && Math.abs(projected.y) < VIEW_MARGIN[1]
      )
    })
    return visible[Math.floor(Math.random() * visible.length)] ?? null
  }

  function begin(camera) {
    const target = pickRoof(camera)
    if (!target) return false
    roof.set(target.x, target.y + SKID_HEIGHT, target.z)
    hover.copy(roof).setY(roof.y + HOVER_HEIGHT)
    // Come in from a random direction, high and far, out of shot.
    const angle = Math.random() * Math.PI * 2
    const height = Math.max(roof.y + SPAWN_HEIGHT, SAFE_HEIGHT)
    start.set(roof.x + Math.sin(angle) * SPAWN_DISTANCE, height, roof.z + Math.cos(angle) * SPAWN_DISTANCE)
    control.lerpVectors(start, hover, 0.6).setY(height)
    const exitAngle = angle + Math.PI * (0.5 + Math.random())
    exit.set(roof.x + Math.sin(exitAngle) * SPAWN_DISTANCE, height, roof.z + Math.cos(exitAngle) * SPAWN_DISTANCE)
    vtol.group.position.copy(start)
    vtol.group.rotation.set(0, 0, 0)
    vtol.group.visible = true
    pad.position.set(target.x, target.y, target.z)
    pad.visible = true
    rotorSpeed = ROTOR_FLYING
    landedTime = random(LANDED_TIME)
    phase = 'inbound'
    phaseTime = 0
    return true
  }

  // Yaw towards travel, nose down and bank with speed.
  function orient(delta, velocity) {
    const g = vtol.group
    const speed = Math.hypot(velocity.x, velocity.z)
    if (speed > 0.5) {
      const yaw = Math.atan2(velocity.x, velocity.z)
      let diff = yaw - g.rotation.y
      diff = Math.atan2(Math.sin(diff), Math.cos(diff))
      g.rotation.y += diff * Math.min(1, delta * 2)
      g.rotation.z = THREE.MathUtils.lerp(g.rotation.z, -diff * 0.6, Math.min(1, delta * 3))
    } else {
      g.rotation.z = THREE.MathUtils.lerp(g.rotation.z, 0, Math.min(1, delta * 3))
    }
    g.rotation.x = THREE.MathUtils.lerp(g.rotation.x, Math.min(0.35, speed * 0.012), Math.min(1, delta * 3))
  }

  return {
    group,
    // Calls one in now (if one isn't already about and a roof is in view).
    trigger(camera) {
      if (phase === 'idle') begin(camera)
    },
    update(delta, elapsed, camera) {
      const g = vtol.group
      if (phase === 'idle') {
        if ((wait -= delta) <= 0) wait = begin(camera) ? random(INTERVAL) : RETRY
        return
      }
      phaseTime += delta
      previous.copy(g.position)

      if (phase === 'inbound') {
        curve.getPoint(ease(clamp01(phaseTime / INBOUND_TIME)), g.position)
        if (phaseTime >= INBOUND_TIME) [phase, phaseTime] = ['descend', 0]
      } else if (phase === 'descend') {
        g.position.lerpVectors(hover, roof, ease(clamp01(phaseTime / DESCEND_TIME)))
        if (phaseTime >= DESCEND_TIME) [phase, phaseTime] = ['landed', 0]
      } else if (phase === 'landed') {
        g.position.copy(roof)
        if (phaseTime >= landedTime) [phase, phaseTime] = ['ascend', 0]
      } else if (phase === 'ascend') {
        g.position.lerpVectors(roof, hover, ease(clamp01(phaseTime / ASCEND_TIME)))
        if (phaseTime >= ASCEND_TIME) [phase, phaseTime] = ['outbound', 0]
      } else if (phase === 'outbound') {
        g.position.lerpVectors(hover, exit, ease(clamp01(phaseTime / OUTBOUND_TIME)))
        if (phaseTime >= OUTBOUND_TIME) {
          g.visible = pad.visible = false
          vtol.searchlight.intensity = 0
          phase = 'idle'
          return
        }
      }

      const velocity = previous.subVectors(g.position, previous).divideScalar(Math.max(delta, 1e-4))
      orient(delta, velocity)
      // Hover bob once near the roof.
      if (phase !== 'inbound' && phase !== 'outbound') g.position.y += Math.sin(elapsed * 2) * 0.05

      // Rotors idle while landed; landing light on near the roof.
      const target = phase === 'landed' ? ROTOR_IDLE : ROTOR_FLYING
      rotorSpeed += (target - rotorSpeed) * Math.min(1, delta * 0.8)
      for (const rotor of vtol.rotors) rotor.rotation.y += rotorSpeed * delta
      const nearRoof = phase === 'descend' || phase === 'ascend' || (phase === 'inbound' && phaseTime > INBOUND_TIME * 0.7)
      vtol.searchlight.intensity += ((nearRoof ? SEARCHLIGHT : 0) - vtol.searchlight.intensity) * Math.min(1, delta * 4)
      g.updateMatrixWorld()
      vtol.searchlight.target.position.copy(g.worldToLocal(projected.copy(roof)))

      const blink = elapsed % 1
      vtol.navRed.visible = vtol.navGreen.visible = blink < 0.5
      vtol.strobe.visible = blink < 0.06 || (blink > 0.14 && blink < 0.2)
      // Pad lights chase round the roof while it's coming and going.
      padLights.forEach((light, i) => {
        light.visible = Math.floor(elapsed * 10) % PAD_LIGHTS === i || phase === 'landed'
      })
    },
  }
}
