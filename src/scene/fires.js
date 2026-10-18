import * as THREE from 'three'

const MAX_FIRES = 6 // at most this many burning at once; the oldest is reused
const BURN_TIME = 10 // seconds, the last FADE_TIME of which it dies down
const FADE_TIME = 2.5
const FLAMES = 7
const EMBERS = 10
const SMOKE = 5
const WIDTH = 2.6 // spread of the flames across the wall
const FIRE_LIGHT = 90
// Every light in the scene costs every lit pixel, even when it's off, so the
// fires share a couple of lights, given to whichever are burning brightest.
const FIRE_LIGHTS = 2

const FLAME_COLOUR = new THREE.Color(2.6, 1.3, 0.45) // HDR so the flames bloom
const EMBER_COLOUR = new THREE.Color(3, 1.2, 0.3)

function gradientTexture(width, height, stops) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  ctx.setTransform(1, 0, 0, height / width, 0, 0) // circle stretched upwards
  const gradient = ctx.createRadialGradient(width / 2, width * 0.62, 0, width / 2, width * 0.62, width / 2)
  for (const [at, colour] of stops) gradient.addColorStop(at, colour)
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, width, width)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

const flameTexture = gradientTexture(64, 128, [
  [0, 'rgba(255, 250, 220, 1)'],
  [0.35, 'rgba(255, 170, 50, 0.9)'],
  [0.7, 'rgba(220, 60, 10, 0.4)'],
  [1, 'rgba(120, 20, 0, 0)'],
])
const smokeTexture = gradientTexture(64, 64, [
  [0, 'rgba(30, 28, 28, 0.8)'],
  [1, 'rgba(30, 28, 28, 0)'],
])

const sprite = (map, colour, additive) =>
  new THREE.Sprite(
    new THREE.SpriteMaterial({
      map,
      color: colour,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    }),
  )

// Fires on building facades: flickering flame sprites, rising embers, drifting
// smoke and a flickering orange light.
export function createFires() {
  const group = new THREE.Group()
  const lights = Array.from({ length: FIRE_LIGHTS }, () => {
    const light = new THREE.PointLight(0xff7a2a, 0, 26, 2)
    group.add(light)
    return light
  })

  const fires = Array.from({ length: MAX_FIRES }, () => {
    const fire = new THREE.Group()
    fire.visible = false
    const flames = Array.from({ length: FLAMES }, () => {
      const flame = sprite(flameTexture, FLAME_COLOUR, true)
      flame.userData = { x: (Math.random() - 0.5) * WIDTH, size: 1 + Math.random() * 1.2, seed: Math.random() * 10 }
      fire.add(flame)
      return flame
    })
    const embers = Array.from({ length: EMBERS }, () => {
      const ember = sprite(flameTexture, EMBER_COLOUR, true)
      ember.scale.setScalar(0.12)
      ember.userData = { age: Math.random(), life: 1 + Math.random(), drift: (Math.random() - 0.5) * 1.5 }
      fire.add(ember)
      return ember
    })
    const smoke = Array.from({ length: SMOKE }, () => {
      const puff = sprite(smokeTexture, 0xffffff, false)
      puff.userData = { age: Math.random() * 3, life: 3 }
      fire.add(puff)
      return puff
    })
    group.add(fire)
    return {
      group: fire,
      flames,
      embers,
      smoke,
      glow: 0, // how bright its light would be
      age: Infinity,
      normal: new THREE.Vector3(),
      along: new THREE.Vector3(), // across the wall
    }
  })

  return {
    group,
    // Starts a fire at `position` on a wall facing along `normal`.
    ignite(position, normal) {
      const fire = fires.reduce((oldest, f) => (f.age > oldest.age ? f : oldest))
      fire.group.position.copy(position)
      fire.normal.copy(normal)
      fire.along.set(-normal.z, 0, normal.x)
      fire.age = 0
      fire.group.visible = true
    },
    update(delta, elapsed) {
      for (const fire of fires) {
        if (!fire.group.visible) continue
        fire.age += delta
        const strength = THREE.MathUtils.clamp((BURN_TIME - fire.age) / FADE_TIME, 0, 1) * Math.min(1, fire.age * 4)
        if (fire.age > BURN_TIME) {
          fire.group.visible = false
          fire.glow = 0
          continue
        }
        // Flames along the wall, licking upwards and flickering.
        const { along } = fire
        for (const flame of fire.flames) {
          const { x, size, seed } = flame.userData
          const flicker = 0.75 + 0.25 * Math.sin(elapsed * 13 + seed) * Math.sin(elapsed * 7.3 + seed * 2)
          const height = size * flicker * strength
          flame.scale.set(height * 0.7, height * 1.4, 1)
          flame.position.copy(along).multiplyScalar(x * strength).addScaledVector(fire.normal, 0.3)
          flame.position.y = height * 0.5
        }
        for (const ember of fire.embers) {
          const data = ember.userData
          data.age += delta
          if (data.age > data.life) data.age = 0
          const t = data.age / data.life
          ember.position.copy(along).multiplyScalar(data.drift * t).addScaledVector(fire.normal, 0.5 + t)
          ember.position.y = 0.5 + t * 4
          ember.material.opacity = (1 - t) * strength
        }
        for (const puff of fire.smoke) {
          const data = puff.userData
          data.age += delta
          if (data.age > data.life) data.age = 0
          const t = data.age / data.life
          puff.position.copy(fire.normal).multiplyScalar(0.8 + t * 1.5)
          puff.position.y = 1.5 + t * 7
          puff.scale.setScalar(1.5 + t * 3)
          puff.material.opacity = Math.sin(t * Math.PI) * 0.45 * strength
        }
        fire.glow = FIRE_LIGHT * strength * (0.7 + Math.random() * 0.3)
      }
      const brightest = fires.filter((fire) => fire.glow > 0).sort((a, b) => b.glow - a.glow)
      lights.forEach((light, i) => {
        const fire = brightest[i]
        light.intensity = fire ? fire.glow : 0
        if (fire) light.position.copy(fire.group.position).y += 1
      })
    },
  }
}
