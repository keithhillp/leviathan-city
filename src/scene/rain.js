import * as THREE from 'three'

// Rain streaks in a box that wraps around the camera, so it never runs out.
export function createRain({ count = 8000, area = 100, height = 60, speed = 45 } = {}) {
  const drops = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    drops[i * 3] = Math.random() * area
    drops[i * 3 + 1] = Math.random() * height
    drops[i * 3 + 2] = Math.random() * area
  }

  const positions = new Float32Array(count * 6)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const lines = new THREE.LineSegments(
    geometry,
    new THREE.LineBasicMaterial({ color: 0x9fb0ba, transparent: true, opacity: 0.25 }),
  )
  lines.frustumCulled = false

  const wrap = (value, center) => center - area / 2 + ((((value - center) % area) + area) % area)

  return {
    object: lines,
    update(delta, center) {
      for (let i = 0; i < count; i++) {
        const j = i * 3
        drops[j + 1] -= speed * delta
        if (drops[j + 1] < 0) drops[j + 1] += height

        const x = wrap(drops[j], center.x)
        const z = wrap(drops[j + 2], center.z)
        const y = drops[j + 1]
        const k = i * 6
        positions[k] = x
        positions[k + 1] = y
        positions[k + 2] = z
        positions[k + 3] = x + 0.12
        positions[k + 4] = y + 0.9
        positions[k + 5] = z
      }
      geometry.attributes.position.needsUpdate = true
    },
  }
}
