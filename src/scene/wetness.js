import * as THREE from 'three'

// Rain-soaked road surfaces. A low-res cube camera sits at the mirror image of
// the view camera below the road (y = 0), so looking up from there through a
// point on the road gives what that point would reflect. The result is used as
// a plain environment map on the road materials, so there's no special floor
// object to fight the PS1 snapping.
const RESOLUTION = 128 // per cube face
const CAPTURE_EVERY = 3 // frames (~20 per second)
const PUDDLE_TILE = 24 // world units per repeat of the puddle pattern
const REFLECTION_STRENGTH = 1

// Roughness map: dry-ish wet tarmac with glossy puddles (green channel).
function createPuddleTexture(repeat) {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = 'rgb(115, 115, 115)' // wet tarmac: roughness ~0.45
  ctx.fillRect(0, 0, size, size)
  for (let i = 0; i < 40; i++) {
    const x = Math.random() * size
    const y = Math.random() * size
    const r = 8 + Math.random() * 40
    const puddle = ctx.createRadialGradient(x, y, 0, x, y, r)
    puddle.addColorStop(0, 'rgba(25, 25, 25, 0.95)') // puddle: roughness ~0.1
    puddle.addColorStop(1, 'rgba(25, 25, 25, 0)')
    ctx.fillStyle = puddle
    // Drawn at each wrapped offset so the pattern tiles seamlessly.
    for (const dx of [-size, 0, size]) {
      for (const dy of [-size, 0, size]) {
        ctx.fillRect(x - r + dx, y - r + dy, r * 2, r * 2)
      }
    }
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(repeat, repeat)
  return texture
}

// `surfaces` are { mesh, roughness?, puddles? }: puddles uses the puddle
// pattern (for big flat ground planes); otherwise a flat wet roughness.
export function createWetness({ renderer, scene, surfaces }) {
  const target = new THREE.WebGLCubeRenderTarget(RESOLUTION, { type: THREE.HalfFloatType })
  const cubeCamera = new THREE.CubeCamera(0.5, 1500, target)
  scene.add(cubeCamera)

  for (const { mesh, roughness = 0.3, puddles = false } of surfaces) {
    const material = mesh.material
    material.envMap = target.texture
    material.envMapIntensity = REFLECTION_STRENGTH
    if (puddles) {
      const width = mesh.geometry.parameters.width
      material.roughnessMap = createPuddleTexture(width / PUDDLE_TILE)
      material.roughness = 1
    } else {
      material.roughness = roughness
    }
    material.needsUpdate = true
  }

  let frame = 0
  return {
    update(camera) {
      if (frame++ % CAPTURE_EVERY !== 0) return
      cubeCamera.position.set(camera.position.x, -camera.position.y, camera.position.z)
      // The surfaces themselves would block the view up from below the road.
      for (const { mesh } of surfaces) mesh.visible = false
      cubeCamera.update(renderer, scene)
      for (const { mesh } of surfaces) mesh.visible = true
    },
    dispose() {
      target.dispose()
    },
  }
}
