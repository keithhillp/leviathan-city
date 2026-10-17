import * as THREE from 'three'

// Atmosphere for the heavy parts of a track: the sky and haze bleed red with
// the bass, and the biggest hits bring lightning.
const STORM_RED = new THREE.Color(0x4a0c10)
const RED_STRENGTH = 0.85 // how far the haze can go towards STORM_RED
const RED_RISE = 6 // per second, how fast the red follows a hit...
const RED_FALL = 0.8 // ...and how slowly it fades
const BASS_FROM = 0.3 // bass level where the red starts...
const BASS_FULL = 0.8 // ...and where it's at full strength

const FLASH_SKY = new THREE.Color(0xc8c0ff)
const FLASH_LIGHT = 6
const STRIKE_COOLDOWN = 1.5 // seconds
const KICK_STRIKE_CHANCE = 0.12 // on kicks in heavy sections, besides surges
// A strike is a few quick flashes: [start, length] in seconds.
const FLASHES = [
  [0, 0.06],
  [0.1, 0.05],
  [0.2, 0.09],
]
const STRIKE_LENGTH = 0.3

// Behind the tower, high over the city.
const BOLT = { distance: [260, 420], spread: 320, top: 320, bottom: 50, width: 1.6 }

// A jagged ribbon from the sky down towards the skyline, with a few branches,
// built flat facing the plaza.
function boltGeometry() {
  const positions = []
  const segment = (a, b, width) => {
    const dx = b.x - a.x
    const dy = b.y - a.y
    const length = Math.hypot(dx, dy)
    const nx = (-dy / length) * (width / 2)
    const ny = (dx / length) * (width / 2)
    positions.push(
      a.x - nx, a.y - ny, 0, a.x + nx, a.y + ny, 0, b.x + nx, b.y + ny, 0,
      a.x - nx, a.y - ny, 0, b.x + nx, b.y + ny, 0, b.x - nx, b.y - ny, 0,
    )
  }
  const branch = (start, height, width, depth) => {
    let point = start
    const steps = Math.ceil(height / 18)
    for (let i = 0; i < steps; i++) {
      const next = { x: point.x + (Math.random() - 0.5) * 30, y: point.y - height / steps }
      segment(point, next, width)
      if (depth < 2 && Math.random() < 0.25) branch(next, height * 0.4, width * 0.6, depth + 1)
      point = next
    }
  }
  branch({ x: 0, y: BOLT.top }, BOLT.top - BOLT.bottom, BOLT.width, 0)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  return geometry
}

export function createSky(scene) {
  const group = new THREE.Group()
  const haze = scene.background.clone()

  const bolt = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 6, 9), fog: false, side: THREE.DoubleSide }),
  )
  bolt.visible = false
  bolt.frustumCulled = false
  group.add(bolt)

  const lightning = new THREE.DirectionalLight(0xd8d0ff, 0)
  lightning.position.set(0, 200, -200)
  group.add(lightning, lightning.target)

  let red = 0
  let strikeTime = Infinity // seconds since the current strike began
  let sinceStrike = STRIKE_COOLDOWN

  function strike() {
    bolt.geometry.dispose()
    bolt.geometry = boltGeometry()
    const [near, far] = BOLT.distance
    bolt.position.set((Math.random() - 0.5) * BOLT.spread * 2, 0, -(near + Math.random() * (far - near)))
    strikeTime = 0
    sinceStrike = 0
  }

  return {
    group,
    update(delta, analysis) {
      const heavy = 1 - analysis.calm
      const target = heavy * THREE.MathUtils.smoothstep(analysis.levels.bass, BASS_FROM, BASS_FULL)
      red += (target - red) * Math.min(1, delta * (target > red ? RED_RISE : RED_FALL))

      sinceStrike += delta
      const kickStrike = analysis.beat && heavy > 0.6 && Math.random() < KICK_STRIKE_CHANCE
      if ((analysis.surge || kickStrike) && sinceStrike > STRIKE_COOLDOWN) strike()

      strikeTime += delta
      const flash = FLASHES.some(([start, length]) => strikeTime >= start && strikeTime < start + length) ? 1 : 0
      bolt.visible = strikeTime < STRIKE_LENGTH && flash > 0
      lightning.intensity = flash * FLASH_LIGHT

      scene.background.copy(haze).lerp(STORM_RED, red * RED_STRENGTH).lerp(FLASH_SKY, flash * 0.5)
      scene.fog.color.copy(scene.background)
    },
  }
}
