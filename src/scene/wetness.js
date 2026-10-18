import * as THREE from 'three'

// Rain-soaked road surfaces. A low-res cube camera sits at the mirror image of
// the view camera below the road (y = 0), so looking up from there through a
// point on the road gives what that point would reflect. The result is used as
// a plain environment map on the road materials, so there's no special floor
// object to fight the PS1 snapping.
const RESOLUTION = 128 // per cube face
// One face is re-rendered per frame, so the cost is spread evenly instead of
// six scene renders landing on the same frame.
const FACES = 6 // +x, -x, +y, -y, +z, -z
// Only reflections of things above the road are ever looked up, so the face
// looking down is just filled with the sky colour (all it would see anyway).
const DOWN = 3
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
// `skip` are other objects left out of the reflections.
export function createWetness({ renderer, scene, surfaces, skip = [] }) {
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

  // Left out of the reflections: the surfaces themselves (they'd block the view
  // up from below the road) and anything in `skip`.
  const hidden = [...surfaces.map(({ mesh }) => mesh), ...skip]
  const empty = new THREE.Scene()
  let face = 0
  return {
    update(camera) {
      if (cubeCamera.coordinateSystem !== renderer.coordinateSystem) {
        cubeCamera.coordinateSystem = renderer.coordinateSystem
        cubeCamera.updateCoordinateSystem()
      }
      // Each sweep of the faces is taken from one position.
      if (face === 0) cubeCamera.position.set(camera.position.x, -camera.position.y, camera.position.z)
      const previous = renderer.getRenderTarget()
      renderer.setRenderTarget(target, face)
      if (face === DOWN) {
        empty.background = scene.background
        renderer.render(empty, cubeCamera.children[face])
      } else {
        const visible = hidden.map((object) => object.visible)
        for (const object of hidden) object.visible = false
        renderer.render(scene, cubeCamera.children[face])
        hidden.forEach((object, i) => (object.visible = visible[i]))
      }
      renderer.setRenderTarget(previous)
      face = (face + 1) % FACES
      // Re-filter for the rough surfaces once the sweep is complete.
      if (face === 0) target.texture.needsPMREMUpdate = true
    },
    dispose() {
      target.dispose()
    },
  }
}
