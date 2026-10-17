import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

const CARS = 10
const CAR_LENGTH = 16
const CAR_GAP = 0.5
const NOSE_LENGTH = 5
const BODY = { height: 3.2, width: 3, clearance: 0.4 }
const SPEED = 150 // units per second
const WAIT = { min: 10, max: 30 } // seconds between passes
const FIRST_WAIT = { min: 3, max: 8 }
const TRAIN_LIGHT = 150

const FRONT_LIGHT = new THREE.Color(6, 5.8, 5)
const REAR_LIGHT = new THREE.Color(5, 0.2, 0.1)
const WINDOWS = new THREE.Color(1.2, 1.4, 1.5)

const CARS_LENGTH = CARS * CAR_LENGTH + (CARS - 1) * CAR_GAP
const TRAIN_LENGTH = CARS_LENGTH + NOSE_LENGTH * 2

const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z)

// Four-sided pyramid pointing along +x (or -x), squashed to the body's section.
function nose(direction) {
  const half = CARS_LENGTH / 2
  return new THREE.ConeGeometry(1, NOSE_LENGTH, 4)
    .rotateY(Math.PI / 4)
    .rotateZ(-direction * (Math.PI / 2))
    .scale(1, BODY.height / Math.SQRT2, BODY.width / Math.SQRT2)
    .translate(direction * (half + NOSE_LENGTH / 2), BODY.clearance + BODY.height / 2, 0)
}

// Each car's centre along x, front of the train at +x.
const carCentres = Array.from(
  { length: CARS },
  (_, i) => -CARS_LENGTH / 2 + CAR_LENGTH / 2 + i * (CAR_LENGTH + CAR_GAP),
)

function endLights(direction) {
  const x = direction * (CARS_LENGTH / 2 + 1.2)
  const y = BODY.clearance + 1.1
  return mergeGeometries([box(0.3, 0.3, 0.6, x, y, -0.8), box(0.3, 0.3, 0.6, x, y, 0.8)])
}

// A basic high-speed train crossing the bridge along x, alternating direction
// and track. `clipX` hides it beyond the bridge ends, so it appears out of
// one building and disappears into the other.
export function createTrain({ deckY, tracks, clipX }) {
  const group = new THREE.Group()
  const clippingPlanes = [
    new THREE.Plane(new THREE.Vector3(1, 0, 0), clipX),
    new THREE.Plane(new THREE.Vector3(-1, 0, 0), clipX),
  ]
  const material = (params, Type = THREE.MeshBasicMaterial) => new Type({ ...params, clippingPlanes })

  const body = new THREE.Mesh(
    mergeGeometries([
      ...carCentres.map((x) => box(CAR_LENGTH, BODY.height, BODY.width, x, BODY.clearance + BODY.height / 2, 0)),
      nose(1),
      nose(-1),
    ]),
    material({ color: 0x8d9296, roughness: 0.45, metalness: 0.6 }, THREE.MeshStandardMaterial),
  )
  const trim = new THREE.Mesh(
    mergeGeometries([
      // Dark skirt between the bogies, and a red stripe along the side.
      ...carCentres.map((x) => box(CAR_LENGTH - 2, BODY.clearance, BODY.width - 0.4, x, BODY.clearance / 2, 0)),
      ...carCentres.map((x) => box(CAR_LENGTH, 0.22, BODY.width + 0.04, x, BODY.clearance + 1.2, 0)),
    ]),
    material({ color: 0x3a1210 }),
  )
  const windows = new THREE.Mesh(
    mergeGeometries(
      carCentres.map((x) => box(CAR_LENGTH - 2, 0.7, BODY.width + 0.06, x, BODY.clearance + 2.3, 0)),
    ),
    material({ color: WINDOWS }),
  )
  const lightsA = new THREE.Mesh(endLights(1), material({ color: FRONT_LIGHT }))
  const lightsB = new THREE.Mesh(endLights(-1), material({ color: REAR_LIGHT }))
  const train = new THREE.Group()
  train.add(body, trim, windows, lightsA, lightsB)
  train.visible = false
  group.add(train)

  const light = new THREE.PointLight(0xcfe4ff, 0, 40, 2)
  group.add(light)

  const offscreen = clipX + TRAIN_LENGTH / 2 + 2
  const random = ({ min, max }) => min + Math.random() * (max - min)
  let wait = random(FIRST_WAIT)
  let direction = 1
  let trackIndex = 0

  return {
    group,
    update(delta) {
      if (wait > 0) {
        wait -= delta
        if (wait <= 0) {
          direction = -direction
          trackIndex = (trackIndex + 1) % tracks.length
          train.position.set(-direction * offscreen, deckY, tracks[trackIndex])
          train.rotation.y = direction > 0 ? 0 : Math.PI
          train.visible = true
        }
        return
      }

      train.position.x += direction * SPEED * delta
      if (Math.abs(train.position.x) > offscreen) {
        train.visible = false
        light.intensity = 0
        wait = random(WAIT)
        return
      }
      // Light the facades around the visible part of the train.
      light.position.set(
        THREE.MathUtils.clamp(train.position.x, -clipX, clipX),
        deckY + 3,
        tracks[trackIndex] + 4,
      )
      light.intensity = Math.abs(train.position.x) < clipX + TRAIN_LENGTH / 2 ? TRAIN_LIGHT : 0
    },
  }
}
