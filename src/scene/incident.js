import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

// A scripted street incident: a demon rises from the road, a hovercraft flies
// in and lights it up, troopers rope down and kill it, its body is winched
// aboard and the craft leaves. Runs every so often (or on demand via trigger()).
const INTERVAL = [70, 130] // seconds between incidents
const FIRST_DELAY = 40

const SUMMON_TIME = 2.5
const FLIGHT_TIME = 6 // approach and departure
const DOOR_TIME = 0.8
const ROPE_STAGGER = 0.5 // between troopers going down (and back up)
const ROPE_TIME = 1.6
const WALK_SPEED = 3.5
const DEMON_HEALTH = 100
const LUNGE_EVERY = 2.5
const DYING_TIME = 1.5
const LIFT_TIME = 2.5
const BOB = 0.25

const FIRE_RATE = 4 // shots per second per trooper while in a burst
const BURST = [1, 0.6] // seconds firing, seconds pausing
const TRACER_SPEED = 120
const MAX_TRACERS = 40

const DEMON_EYES = new THREE.Color(6, 1.6, 0.2)
const DEMON_GLOW = 60
const PORTAL = new THREE.Color(3, 0.15, 0.05)
const VISOR = new THREE.Color(0.6, 2.4, 3)
const TRACER = new THREE.Color(4, 5, 6)
const ENGINE = new THREE.Color(1.2, 2.4, 4)
const BEAM = new THREE.Color(0.9, 0.95, 1)
const TRACTOR = new THREE.Color(0.2, 0.9, 1)
const SEARCHLIGHT = 900
const MUZZLE_LIGHT = 40

// Where troopers stand during the fight, relative to the demon (x, z).
const FORMATION = [
  [-1.2, 7],
  [1.2, 10],
  [1.2, -7],
  [-1.2, -10],
]
// Rope points under the craft, local to it (x, z), one per trooper.
const ROPES = [
  [-1.2, 3],
  [1.2, 3],
  [1.2, -3],
  [-1.2, -3],
]

// Helmet cam: just in front of the visor, looking ahead (troopers face +z,
// cameras look down -z) and tilted slightly down.
const HELMET = new THREE.Vector3(0, 1.93, 0.3)
const HELMET_VIEW = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.12, Math.PI, 0, 'YXZ'))

const ease = (t) => t * t * (3 - 2 * t)
const clamp01 = (t) => Math.min(1, Math.max(0, t))
const random = ([min, max]) => min + Math.random() * (max - min)
const box = (w, h, d, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y, z)

function additive(color) {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
}

// Unit cone with its tip at the origin, opening downwards (-y); scaled to length.
const downCone = (radius) => new THREE.ConeGeometry(radius, 1, 20, 1, true).translate(0, -0.5, 0)

function createDemon() {
  const group = new THREE.Group()
  const skin = new THREE.MeshStandardMaterial({ color: 0x2a0505, roughness: 0.55, emissive: 0x300000 })
  const horn = new THREE.MeshStandardMaterial({ color: 0x150c08, roughness: 0.4 })
  const eyes = new THREE.MeshBasicMaterial({ color: DEMON_EYES })
  const body = new THREE.Mesh(
    mergeGeometries([
      new THREE.SphereGeometry(1, 12, 10).scale(1.3, 1.6, 1).translate(0, 2.4, 0), // torso
      new THREE.SphereGeometry(0.55, 10, 8).translate(0, 3.9, 0.5), // head
      box(0.6, 1.8, 0.6, -0.6, 0.9, 0), // legs
      box(0.6, 1.8, 0.6, 0.6, 0.9, 0),
    ]),
    skin,
  )
  const horns = new THREE.Mesh(
    mergeGeometries(
      [-1, 1].map((side) =>
        new THREE.ConeGeometry(0.16, 1.1, 6).rotateZ(-side * 0.5).rotateX(-0.4).translate(side * 0.45, 4.6, 0.3),
      ),
    ),
    horn,
  )
  const eyeMeshes = new THREE.Mesh(
    mergeGeometries([-1, 1].map((side) => new THREE.SphereGeometry(0.09, 6, 4).translate(side * 0.2, 4, 1))),
    eyes,
  )
  // Arms hang from the shoulders so they can swing up to lunge.
  const arms = [-1, 1].map((side) => {
    const shoulder = new THREE.Group()
    shoulder.position.set(side * 1.35, 3.1, 0.2)
    shoulder.add(new THREE.Mesh(mergeGeometries([box(0.45, 2.4, 0.45, 0, -1.2, 0), box(0.6, 0.25, 0.7, 0, -2.45, 0.15)]), skin))
    group.add(shoulder)
    return shoulder
  })
  group.add(body, horns, eyeMeshes)
  const light = new THREE.PointLight(0xff3010, 0, 18, 2)
  light.position.set(0, 2.5, 1.5)
  group.add(light)
  group.visible = false
  return { group, skin, eyes, arms, light }
}

function createTrooper() {
  const group = new THREE.Group()
  const armour = new THREE.MeshStandardMaterial({ color: 0x23282c, roughness: 0.45, metalness: 0.5 })
  const legs = [-1, 1].map((side) => {
    const hip = new THREE.Group()
    hip.position.set(side * 0.16, 0.95, 0)
    hip.add(new THREE.Mesh(box(0.24, 0.95, 0.28, 0, -0.475, 0), armour))
    group.add(hip)
    return hip
  })
  group.add(
    new THREE.Mesh(mergeGeometries([box(0.62, 0.75, 0.4, 0, 1.33, 0), new THREE.SphereGeometry(0.21, 8, 6).translate(0, 1.92, 0)]), armour),
    new THREE.Mesh(box(0.28, 0.07, 0.05, 0, 1.94, 0.19), new THREE.MeshBasicMaterial({ color: VISOR })),
    new THREE.Mesh(box(0.09, 0.12, 0.95, 0.18, 1.35, 0.45), armour), // rifle
  )
  const flash = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 4), new THREE.MeshBasicMaterial({ color: TRACER }))
  flash.position.set(0.18, 1.35, 1)
  flash.visible = false
  group.add(flash)
  group.visible = false
  return {
    group,
    legs,
    flash,
    rope: null,
    state: 'aboard', // aboard -> descending -> walking -> fighting -> ... -> ascending -> aboard
    target: new THREE.Vector3(),
    burstTime: Math.random() * BURST[0],
    nextShot: 0,
    flashTime: 0,
  }
}

function createCraft() {
  const group = new THREE.Group()
  const hull = new THREE.MeshStandardMaterial({ color: 0x2b3036, roughness: 0.4, metalness: 0.7 })
  group.add(
    new THREE.Mesh(
      mergeGeometries([
        box(6, 2.5, 14), // hull
        box(4.6, 1.4, 3, 0, -0.3, 8), // cockpit nose
        box(9, 0.3, 4, 0, 0.6, -2), // stub wings
        ...[-1, 1].flatMap((side) => [
          new THREE.CylinderGeometry(1, 1, 2.4, 10).translate(side * 4.6, 0.2, 2),
          new THREE.CylinderGeometry(1, 1, 2.4, 10).translate(side * 4.6, 0.2, -5),
        ]),
      ]),
      hull,
    ),
    // Cockpit glass and downward engine glow
    new THREE.Mesh(box(4, 0.6, 0.1, 0, 0, 9.5), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 1.2, 1.6) })),
  )
  const engines = new THREE.Mesh(
    mergeGeometries(
      [-1, 1].flatMap((side) => [
        new THREE.CircleGeometry(0.85, 12).rotateX(Math.PI / 2).translate(side * 4.6, -1.02, 2),
        new THREE.CircleGeometry(0.85, 12).rotateX(Math.PI / 2).translate(side * 4.6, -1.02, -5),
      ]),
    ),
    new THREE.MeshBasicMaterial({ color: ENGINE, side: THREE.DoubleSide }),
  )
  const navRed = new THREE.Mesh(box(0.3, 0.3, 0.3, -4.5, 0.75, -2), new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 0.2, 0.1) }))
  const navGreen = new THREE.Mesh(box(0.3, 0.3, 0.3, 4.5, 0.75, -2), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 5, 0.6) }))
  group.add(engines, navRed, navGreen)

  // Belly doors hinge along the hull's lower edges.
  const doors = [-1, 1].map((side) => {
    const hinge = new THREE.Group()
    hinge.position.set(side * 2.6, -1.25, 0)
    hinge.add(new THREE.Mesh(box(2.6, 0.12, 9, -side * 1.3, 0, 0), hull))
    group.add(hinge)
    return { hinge, side }
  })

  const searchlight = new THREE.SpotLight(0xe8f2ff, 0, 70, 0.32, 0.6, 1.4)
  searchlight.position.set(0, -1.4, 5)
  group.add(searchlight, searchlight.target)
  const beam = new THREE.Mesh(downCone(0.42), additive(BEAM))
  beam.position.copy(searchlight.position)
  beam.visible = false
  group.add(beam)
  const tractor = new THREE.Mesh(downCone(0.35), additive(TRACTOR))
  tractor.position.set(0, -1.3, 0)
  tractor.visible = false
  group.add(tractor)

  group.visible = false
  return { group, engines, navRed, navGreen, doors, searchlight, beam, tractor }
}

export function createIncident({ fires, location }) {
  const group = new THREE.Group()
  const demon = createDemon()
  const craft = createCraft()
  const troopers = Array.from({ length: FORMATION.length }, createTrooper)
  const ropeMaterial = new THREE.MeshBasicMaterial({ color: 0x0c0c0c })
  for (const trooper of troopers) {
    trooper.rope = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1, 4), ropeMaterial)
    trooper.rope.visible = false
    group.add(trooper.group, trooper.rope)
  }
  const portal = new THREE.Mesh(new THREE.RingGeometry(1.6, 2.6, 32).rotateX(-Math.PI / 2), additive(PORTAL))
  portal.visible = false
  const tracers = Array.from({ length: MAX_TRACERS }, () => {
    const mesh = new THREE.Mesh(box(0.06, 0.06, 1), new THREE.MeshBasicMaterial({ color: TRACER }))
    mesh.visible = false
    group.add(mesh)
    return { mesh, target: new THREE.Vector3() }
  })
  const muzzleLight = new THREE.PointLight(0xcfe6ff, 0, 15, 2)
  group.add(demon.group, craft.group, portal, muzzleLight)

  let phase = 'idle'
  let phaseTime = 0
  let wait = FIRST_DELAY
  let health = DEMON_HEALTH
  let hitFlash = 0
  let lungeTime = 0
  let liftTime = 0
  const site = new THREE.Vector3() // where the demon stands
  const hover = new THREE.Vector3() // where the craft hovers
  const from = new THREE.Vector3()
  const to = new THREE.Vector3()
  const scratch = new THREE.Vector3()
  const chest = new THREE.Vector3()

  function setPhase(name) {
    phase = name
    phaseTime = 0
  }

  function start() {
    site.set(location.x, 0, random(location.z))
    hover.set(site.x, location.hoverHeight, site.z)
    health = DEMON_HEALTH
    demon.group.position.set(site.x, -5, site.z)
    demon.group.rotation.set(0, 0, 0)
    demon.group.scale.setScalar(1)
    demon.eyes.color.copy(DEMON_EYES)
    demon.group.visible = true
    portal.position.set(site.x, 0.3, site.z)
    portal.visible = true
    fires.ignite(scratch.set(site.x, 0, site.z), new THREE.Vector3(0, 0, 1))
    setPhase('summon')
  }

  // Craft world position of a rope point (local x, z under the belly).
  function ropeTop(index, out) {
    const [x, z] = ROPES[index]
    return craft.group.localToWorld(out.set(x, -1.3, z))
  }

  function face(object, point, delta, rate = 8) {
    const yaw = Math.atan2(point.x - object.position.x, point.z - object.position.z)
    let diff = yaw - object.rotation.y
    diff = Math.atan2(Math.sin(diff), Math.cos(diff))
    object.rotation.y += diff * Math.min(1, delta * rate)
  }

  // Walks a trooper towards its target; true once it's there.
  function walk(trooper, delta, elapsed) {
    scratch.subVectors(trooper.target, trooper.group.position).setY(0)
    const distance = scratch.length()
    const moving = distance > 0.1
    if (moving) {
      trooper.group.position.addScaledVector(scratch.normalize(), Math.min(distance, WALK_SPEED * delta))
      face(trooper.group, trooper.target, delta)
    }
    const swing = moving ? Math.sin(elapsed * 10) * 0.5 : 0
    trooper.legs[0].rotation.x = swing
    trooper.legs[1].rotation.x = -swing
    return !moving
  }

  function shoot(trooper) {
    const tracer = tracers.find((t) => !t.mesh.visible)
    if (!tracer) return
    trooper.group.localToWorld(tracer.mesh.position.set(0.18, 1.35, 1))
    demon.group.localToWorld(chest.set(0, 2.6, 0))
    tracer.target.copy(chest).add(scratch.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(1.2))
    tracer.mesh.lookAt(tracer.target)
    tracer.mesh.visible = true
    trooper.flashTime = 0.05
    muzzleLight.position.copy(tracer.mesh.position)
    muzzleLight.intensity = MUZZLE_LIGHT
  }

  function updateTracers(delta) {
    for (const tracer of tracers) {
      if (!tracer.mesh.visible) continue
      scratch.subVectors(tracer.target, tracer.mesh.position)
      const step = TRACER_SPEED * delta
      if (scratch.length() <= step) {
        tracer.mesh.visible = false
        if (phase === 'fight') {
          health--
          hitFlash = 0.06
        }
      } else {
        tracer.mesh.position.addScaledVector(scratch.normalize(), step)
      }
    }
  }

  function updateCraft(delta, elapsed) {
    const g = craft.group
    if (phase === 'approach') {
      const t = ease(clamp01(phaseTime / FLIGHT_TIME))
      g.position.lerpVectors(from, hover, t)
      face(g, hover, delta, 2)
    } else if (phase === 'depart') {
      const t = ease(clamp01((phaseTime - DOOR_TIME) / FLIGHT_TIME))
      g.position.lerpVectors(hover, to, t)
      if (t > 0) face(g, to, delta, 2)
      if (t >= 1) g.visible = false
    } else if (g.visible) {
      g.position.copy(hover)
    }
    g.position.y += Math.sin(elapsed * 1.3) * BOB
    g.updateMatrixWorld()
    craft.engines.material.color.copy(ENGINE).multiplyScalar(0.85 + Math.random() * 0.3)
    const blink = elapsed % 1 < 0.1
    craft.navRed.visible = craft.navGreen.visible = blink

    // Doors open for deploying and boarding, closed in flight.
    const open = ['deploy', 'fight', 'dying', 'secure', 'board'].includes(phase) ? 1 : 0
    for (const { hinge, side } of craft.doors) {
      const angle = open * side * (Math.PI / 2) * 0.9
      hinge.rotation.z += (angle - hinge.rotation.z) * Math.min(1, delta / DOOR_TIME * 3)
    }

    // Searchlight on the demon from late in the approach until it leaves.
    const lit =
      (phase === 'approach' && phaseTime > FLIGHT_TIME * 0.6) ||
      ['deploy', 'fight', 'dying', 'secure', 'board'].includes(phase) ||
      (phase === 'depart' && phaseTime < DOOR_TIME)
    craft.searchlight.intensity += ((lit ? SEARCHLIGHT : 0) - craft.searchlight.intensity) * Math.min(1, delta * 6)
    demon.group.localToWorld(chest.set(0, 1.5, 0))
    craft.searchlight.target.position.copy(g.worldToLocal(scratch.copy(chest)))
    craft.beam.visible = craft.searchlight.intensity > 20
    if (craft.beam.visible) {
      const origin = g.localToWorld(scratch.copy(craft.searchlight.position))
      const length = origin.distanceTo(chest)
      craft.beam.scale.set(length, length, length)
      craft.beam.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, -1, 0),
        g.worldToLocal(chest.clone()).sub(craft.searchlight.position).normalize(),
      )
      craft.beam.material.opacity = 0.12 * (craft.searchlight.intensity / SEARCHLIGHT)
    }
  }

  function updateDemon(delta, elapsed) {
    const d = demon.group
    if (!d.visible) return
    const alive = ['summon', 'approach', 'deploy', 'fight'].includes(phase)
    if (phase === 'summon') d.position.y = THREE.MathUtils.lerp(-5, 0, ease(clamp01(phaseTime / SUMMON_TIME)))
    if (alive) {
      // Breathing, a menacing sway, and glowing.
      d.scale.setScalar(1 + Math.sin(elapsed * 3) * 0.03)
      const nearest = troopers.filter((t) => t.group.visible).sort(
        (a, b) => a.group.position.distanceTo(d.position) - b.group.position.distanceTo(d.position),
      )[0]
      face(d, nearest ? nearest.group.position : scratch.set(site.x, 0, site.z + 10), delta, 2)
      demon.light.intensity = DEMON_GLOW * (0.8 + Math.sin(elapsed * 9) * 0.2)
      // Lunge at the nearest trooper every so often during the fight.
      let lunge = 0
      if (phase === 'fight' && nearest) {
        lungeTime += delta
        const cycle = lungeTime % LUNGE_EVERY
        lunge = cycle < 0.4 ? cycle / 0.4 : cycle < 1 ? 1 - (cycle - 0.4) / 0.6 : 0
        scratch.subVectors(nearest.group.position, site).setY(0).normalize()
        d.position.set(site.x, d.position.y, site.z).addScaledVector(scratch, lunge * 2)
      }
      for (const arm of demon.arms) arm.rotation.x = -0.3 - lunge * 1.4 + Math.sin(elapsed * 2) * 0.1
    }
    if (phase === 'dying') {
      const t = ease(clamp01(phaseTime / DYING_TIME))
      d.rotation.x = t * Math.PI * 0.47 // keels over forwards
      demon.eyes.color.copy(DEMON_EYES).multiplyScalar(1 - t)
      demon.light.intensity = DEMON_GLOW * (1 - t)
    }
    d.updateMatrixWorld()
    hitFlash -= delta
    demon.skin.emissive.setRGB(hitFlash > 0 ? 1.5 : 0.19, hitFlash > 0 ? 1.4 : 0, hitFlash > 0 ? 1.3 : 0)
    portal.material.opacity = alive ? 0.7 + Math.sin(elapsed * 6) * 0.3 : Math.max(0, portal.material.opacity - delta)
    portal.visible = portal.material.opacity > 0
  }

  function updateTroopers(delta, elapsed) {
    troopers.forEach((trooper, i) => {
      const g = trooper.group
      const top = ropeTop(i, new THREE.Vector3())
      if (trooper.state === 'descending' && trooper.ropeTime < 0) {
        // Waiting aboard for the doors / their turn.
        g.visible = trooper.rope.visible = false
        trooper.ropeTime += delta
      } else if (trooper.state === 'descending' || trooper.state === 'ascending') {
        g.visible = true
        const t = clamp01(trooper.ropeTime / ROPE_TIME)
        const y = trooper.state === 'descending' ? THREE.MathUtils.lerp(top.y - 2, 0, ease(t)) : THREE.MathUtils.lerp(0, top.y - 2, ease(t))
        g.position.set(top.x, y, top.z)
        trooper.rope.visible = true
        // Rope from the door down to the trooper's head.
        trooper.rope.position.set(top.x, (top.y + y + 2) / 2, top.z)
        trooper.rope.scale.y = Math.max(0.01, top.y - (y + 2))
        trooper.ropeTime += delta
        if (t >= 1) {
          trooper.rope.visible = false
          if (trooper.state === 'descending') {
            trooper.state = 'walking'
            trooper.target.set(site.x + FORMATION[i][0], 0, site.z + FORMATION[i][1])
          } else {
            trooper.state = 'aboard'
            g.visible = false
          }
        }
      } else if (trooper.state === 'walking' || trooper.state === 'gathering' || trooper.state === 'returning') {
        if (walk(trooper, delta, elapsed) && trooper.state === 'returning') {
          trooper.state = 'ascending'
          trooper.ropeTime = -i * ROPE_STAGGER
        }
      } else if (trooper.state === 'fighting') {
        walk(trooper, delta, elapsed)
        demon.group.localToWorld(chest.set(0, 2.6, 0))
        face(g, chest, delta)
        trooper.burstTime = (trooper.burstTime + delta) % (BURST[0] + BURST[1])
        trooper.nextShot -= delta
        if (trooper.burstTime < BURST[0] && trooper.nextShot <= 0) {
          shoot(trooper)
          trooper.nextShot = 1 / FIRE_RATE
        }
      }
      trooper.flashTime -= delta
      trooper.flash.visible = trooper.flashTime > 0
    })
  }

  return {
    group,
    // First-person view from trooper `index`'s helmet into a camera's position
    // and quaternion; false while they're aboard (no signal).
    viewpoint(index, position, quaternion) {
      const trooper = troopers[index % troopers.length]
      if (!trooper.group.visible) return false
      trooper.group.updateMatrixWorld()
      trooper.group.localToWorld(position.copy(HELMET))
      quaternion.copy(trooper.group.quaternion).multiply(HELMET_VIEW)
      return true
    },
    // Starts an incident now, if one isn't already running.
    trigger() {
      if (phase === 'idle') start()
    },
    update(delta, elapsed) {
      phaseTime += delta
      if (phase === 'idle') {
        if ((wait -= delta) <= 0) start()
        return
      }

      if (phase === 'summon' && phaseTime >= SUMMON_TIME) {
        from.set(site.x - 30, 130, site.z - 60) // drops in from the sky, clear of the tower
        craft.group.position.copy(from)
        craft.group.rotation.set(0, 0, 0)
        craft.group.visible = true
        setPhase('approach')
      } else if (phase === 'approach' && phaseTime >= FLIGHT_TIME) {
        setPhase('deploy')
        troopers.forEach((trooper, i) => {
          trooper.state = 'descending'
          trooper.ropeTime = -DOOR_TIME - i * ROPE_STAGGER // wait for the doors, then one by one
          trooper.group.rotation.set(0, 0, 0)
        })
      } else if (phase === 'deploy' && troopers.every((t) => t.state === 'walking' && walk(t, 0, 0))) {
        troopers.forEach((t) => (t.state = 'fighting'))
        lungeTime = 0
        setPhase('fight')
      } else if (phase === 'fight' && health <= 0) {
        setPhase('dying')
      } else if (phase === 'dying' && phaseTime >= DYING_TIME) {
        // Gather round the body.
        troopers.forEach((trooper, i) => {
          trooper.state = 'gathering'
          const angle = (i / troopers.length) * Math.PI * 2
          trooper.target.set(site.x + Math.sin(angle) * 2.2, 0, site.z + 1.5 + Math.cos(angle) * 2.2)
        })
        liftTime = 0
        setPhase('secure')
      } else if (phase === 'secure') {
        // Once gathered (and a beat to secure it), winch the body up into the craft.
        const gathered = troopers.every((t) => walk(t, 0, 0))
        if (gathered) {
          liftTime += delta
          const t = clamp01((liftTime - 1) / LIFT_TIME)
          craft.tractor.visible = t > 0 && t < 1
          if (t > 0) {
            const belly = craft.group.localToWorld(scratch.set(0, -1.3, 0))
            demon.group.position.lerpVectors(new THREE.Vector3(site.x, 0, site.z), belly, ease(t))
            demon.group.scale.setScalar(1 - ease(t) * 0.6)
            craft.tractor.scale.setScalar(Math.max(0.01, belly.y - demon.group.position.y))
          }
          if (t >= 1) {
            demon.group.visible = false
            troopers.forEach((trooper, i) => {
              trooper.state = 'returning'
              trooper.target.set(ropeTop(i, scratch).x, 0, ropeTop(i, scratch).z)
            })
            setPhase('board')
          }
        }
      } else if (phase === 'board' && troopers.every((t) => t.state === 'aboard')) {
        to.set(hover.x + 40, 140, hover.z - 40) // climbs away over the rooftops
        setPhase('depart')
      } else if (phase === 'depart' && phaseTime >= DOOR_TIME + FLIGHT_TIME) {
        craft.group.visible = false
        wait = random(INTERVAL)
        setPhase('idle')
      }

      updateDemon(delta, elapsed)
      updateCraft(delta, elapsed)
      updateTroopers(delta, elapsed)
      updateTracers(delta)
      muzzleLight.intensity = Math.max(0, muzzleLight.intensity - delta * MUZZLE_LIGHT * 15)
    },
  }
}
