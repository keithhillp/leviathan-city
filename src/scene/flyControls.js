import * as THREE from 'three'

const SPEED = 30 // units per second
const BOOST = 4 // with Shift held
const SPEED_RANGE = [4, 400] // the scroll wheel scales the speed within this
const LOOK = 0.004 // radians per pixel dragged
const DAMPING = 10 // how quickly movement starts and stops
const PITCH_LIMIT = Math.PI / 2 - 0.01

// Movement keys: [axis, direction] in the camera's frame (x right, y up, z back).
const KEYS = {
  w: ['z', -1],
  s: ['z', 1],
  a: ['x', -1],
  d: ['x', 1],
  e: ['y', 1],
  q: ['y', -1],
}

// Free-flying camera for roaming the city: WASD to move, Q/E down and up,
// drag to look around, Shift to go faster, scroll to change speed.
export class FlyControls {
  constructor(camera, element) {
    this.camera = camera
    this.element = element
    this.enabled = false
    this.speed = SPEED
    this.yaw = 0
    this.pitch = 0
    this.held = new Set()
    this.boost = false
    this.velocity = new THREE.Vector3()
    this.dragging = null // the pointer id while dragging to look

    this.onKeyDown = (event) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return
      this.boost = event.shiftKey
      const key = event.key.toLowerCase()
      if (KEYS[key]) this.held.add(key)
    }
    this.onKeyUp = (event) => {
      this.boost = event.shiftKey
      this.held.delete(event.key.toLowerCase())
    }
    this.onBlur = () => this.held.clear()
    this.onPointerDown = (event) => {
      if (!this.enabled) return
      this.dragging = event.pointerId
      element.setPointerCapture(event.pointerId)
    }
    this.onPointerMove = (event) => {
      if (event.pointerId !== this.dragging) return
      this.yaw -= event.movementX * LOOK
      this.pitch = THREE.MathUtils.clamp(this.pitch - event.movementY * LOOK, -PITCH_LIMIT, PITCH_LIMIT)
    }
    this.onPointerUp = (event) => {
      if (event.pointerId === this.dragging) this.dragging = null
    }
    this.onWheel = (event) => {
      if (!this.enabled) return
      event.preventDefault()
      this.speed = THREE.MathUtils.clamp(this.speed * Math.exp(-event.deltaY * 0.001), ...SPEED_RANGE)
    }

    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('blur', this.onBlur)
    element.addEventListener('pointerdown', this.onPointerDown)
    element.addEventListener('pointermove', this.onPointerMove)
    element.addEventListener('pointerup', this.onPointerUp)
    element.addEventListener('pointercancel', this.onPointerUp)
    element.addEventListener('wheel', this.onWheel, { passive: false })

    this.euler = new THREE.Euler(0, 0, 0, 'YXZ')
    this.move = new THREE.Vector3()
  }

  // Carry on from wherever the camera is looking now.
  setFrom(camera) {
    this.euler.setFromQuaternion(camera.quaternion, 'YXZ')
    this.yaw = this.euler.y
    this.pitch = this.euler.x
    this.velocity.set(0, 0, 0)
  }

  update(delta) {
    this.move.set(0, 0, 0)
    for (const key of this.held) {
      const [axis, direction] = KEYS[key]
      this.move[axis] += direction
    }
    if (this.move.lengthSq() > 0) this.move.normalize().multiplyScalar(this.speed * (this.boost ? BOOST : 1))

    this.camera.quaternion.setFromEuler(this.euler.set(this.pitch, this.yaw, 0, 'YXZ'))
    this.move.applyQuaternion(this.camera.quaternion)
    this.velocity.lerp(this.move, 1 - Math.exp(-DAMPING * delta))
    this.camera.position.addScaledVector(this.velocity, delta)
  }

  dispose() {
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('blur', this.onBlur)
    this.element.removeEventListener('pointerdown', this.onPointerDown)
    this.element.removeEventListener('pointermove', this.onPointerMove)
    this.element.removeEventListener('pointerup', this.onPointerUp)
    this.element.removeEventListener('pointercancel', this.onPointerUp)
    this.element.removeEventListener('wheel', this.onWheel)
  }
}
