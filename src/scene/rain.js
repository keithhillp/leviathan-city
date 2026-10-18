import * as THREE from 'three'

// Rain streaks in a box that wraps around the camera, so it never runs out.
// The drops never change on the CPU: the vertex shader moves each one down by
// how far the rain has fallen and wraps it into the box around the camera.
export function createRain({ count = 8000, area = 100, height = 60, speed = 45 } = {}) {
  // Both ends of a streak carry the drop's position; aEnd marks the top one.
  const positions = new Float32Array(count * 6)
  const ends = new Float32Array(count * 2)
  for (let i = 0; i < count; i++) {
    const x = Math.random() * area
    const y = Math.random() * height
    const z = Math.random() * area
    positions.set([x, y, z, x, y, z], i * 6)
    ends[i * 2 + 1] = 1
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('aEnd', new THREE.BufferAttribute(ends, 1))

  const uniforms = {
    uRainCenter: { value: new THREE.Vector3() },
    uRainFall: { value: 0 },
  }
  const material = new THREE.LineBasicMaterial({ color: 0x9fb0ba, transparent: true, opacity: 0.25 })
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRainCenter;\nuniform float uRainFall;\nattribute float aEnd;')
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `
        vec3 transformed = vec3(
          uRainCenter.x - ${(area / 2).toFixed(1)} + mod(position.x - uRainCenter.x, ${area.toFixed(1)}),
          mod(position.y - uRainFall, ${height.toFixed(1)}),
          uRainCenter.z - ${(area / 2).toFixed(1)} + mod(position.z - uRainCenter.z, ${area.toFixed(1)})
        ) + aEnd * vec3(0.12, 0.9, 0.0);`,
      )
  }
  const lines = new THREE.LineSegments(geometry, material)
  lines.frustumCulled = false

  return {
    object: lines,
    update(delta, center) {
      // Kept within one box height so the shader's maths stays precise.
      uniforms.uRainFall.value = (uniforms.uRainFall.value + speed * delta) % height
      uniforms.uRainCenter.value.copy(center)
    },
  }
}
