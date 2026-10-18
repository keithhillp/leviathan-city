import * as THREE from 'three'

// Chase view: this far behind the vehicle's tail and above the road, looking
// at a point ahead of it. LAG is how tightly it follows (higher is stiffer);
// at speed it trails a little further back, which sells the motion.
const CHASE = { back: 6, up: 3, lookAhead: 14, lookUp: 1.2, lag: 5 }
// Bonnet view: just ahead of the nose, this share of the vehicle's height up.
const DASH = { up: 0.75, forward: 0.1 }

const UP = new THREE.Vector3(0, 1, 0)
// Cameras look down -z; vehicles face +z.
const FACE_FORWARD = new THREE.Quaternion().setFromAxisAngle(UP, Math.PI)

// Camera rig for riding a vehicle. Each frame takes the vehicle's pose
// (`position` on the ground at its centre, `quaternion` facing +z) and its
// size ({ length, height }), and places the camera.
export function createRideCam() {
  const eye = new THREE.Vector3()
  const look = new THREE.Vector3()
  const offset = new THREE.Vector3()
  const heading = new THREE.Quaternion()
  const euler = new THREE.Euler()
  let snap = true

  return {
    // Jump straight to the next pose instead of easing there (a new vehicle).
    reset() {
      snap = true
    },
    chase(camera, position, quaternion, { length }, delta) {
      // Yaw only, so a tumbling wreck doesn't spin the camera with it.
      heading.setFromAxisAngle(UP, euler.setFromQuaternion(quaternion, 'YXZ').y)
      offset.set(0, CHASE.up, -(length / 2 + CHASE.back)).applyQuaternion(heading)
      const targetEye = offset.add(position)
      const ease = snap ? 1 : 1 - Math.exp(-CHASE.lag * delta)
      eye.lerp(targetEye, ease)
      offset.set(0, CHASE.lookUp, CHASE.lookAhead).applyQuaternion(heading).add(position)
      look.lerp(offset, snap ? 1 : Math.min(1, ease * 2))
      snap = false
      camera.position.copy(eye)
      camera.lookAt(look)
    },
    dash(camera, position, quaternion, { length, height }) {
      snap = true // so cutting back to the chase view doesn't ease across
      camera.position.set(0, height * DASH.up, length / 2 + DASH.forward).applyQuaternion(quaternion).add(position)
      camera.quaternion.copy(quaternion).multiply(FACE_FORWARD)
    },
  }
}
