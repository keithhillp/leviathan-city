import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { mulberry32 } from '../random.js'
import { fbm3, noise3 } from './noise.js'

// Everything off-world: stars and nebulae ride along with the camera
// (they're "infinitely" far), while the planets and the station keep their
// places so the free camera still sees them shift a little.
export const SUN_DIRECTION = new THREE.Vector3(-0.72, 0.3, -0.62).normalize()
const SKY_RADIUS = 9000

const STARS = 7000
const BAND_SHARE = 0.55 // share of stars packed into the galactic band
const BAND_TILT = new THREE.Euler(0.5, 0.3, 0.9)
const STAR_COLOURS = [0x9bb0ff, 0xaabfff, 0xcad7ff, 0xf8f7ff, 0xfff4ea, 0xffd2a1, 0xffcc6f]

const GIANT = { position: new THREE.Vector3(1600, 520, -4400), radius: 1050, tilt: 0.38, spin: 0.006 }
const OCEAN = { position: new THREE.Vector3(900, 2600, -3600), radius: 220, spin: 0.02 }
const MOON = { position: new THREE.Vector3(-1100, 1450, -3900), radius: 150, spin: 0.01 }
const STATION = { position: new THREE.Vector3(-700, 900, -2200), radius: 170, spin: 0.05 }

const random = (rng, min, max) => min + rng() * (max - min)

// ---- Stars ------------------------------------------------------------------

const starVertex = /* glsl */ `
attribute float size;
attribute float phase;
attribute vec3 starColour;
uniform float uTime;
uniform float uScale;
uniform float uTwinkle; // hats / light percussion
varying vec3 vColour;
void main() {
  float shimmer = 0.8 + 0.2 * sin(uTime * (0.7 + phase * 2.5) + phase * 40.0);
  // About a third of the stars catch the hats.
  float sparkle = step(0.66, fract(phase * 7.31)) * uTwinkle * 1.6;
  vColour = starColour * (shimmer + sparkle);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * uScale * (1.0 + sparkle * 0.4);
}`

const starFragment = /* glsl */ `
varying vec3 vColour;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float alpha = smoothstep(0.5, 0.1, d);
  gl_FragColor = vec4(vColour * alpha, 1.0);
}`

function createStars(rng) {
  const positions = new Float32Array(STARS * 3)
  const colours = new Float32Array(STARS * 3)
  const sizes = new Float32Array(STARS)
  const phases = new Float32Array(STARS)
  const point = new THREE.Vector3()
  const colour = new THREE.Color()
  const tilt = new THREE.Matrix4().makeRotationFromEuler(BAND_TILT)
  for (let i = 0; i < STARS; i++) {
    if (rng() < BAND_SHARE) {
      // Clustered around a great circle, thicker in places.
      const angle = rng() * Math.PI * 2
      const spread = (rng() + rng() + rng() - 1.5) * 0.18 * (0.6 + noise3(angle * 2, 0, 0))
      point.set(Math.cos(angle), spread, Math.sin(angle)).normalize().applyMatrix4(tilt)
    } else {
      point.randomDirection()
    }
    point.multiplyScalar(SKY_RADIUS).toArray(positions, i * 3)
    colour.setHex(STAR_COLOURS[Math.floor(rng() * STAR_COLOURS.length)])
    // Most are faint; a few are bright enough to bloom.
    const brightness = 0.25 + rng() ** 6 * 2.4
    colour.multiplyScalar(brightness).toArray(colours, i * 3)
    sizes[i] = 1 + rng() ** 4 * 2.5
    phases[i] = rng()
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('starColour', new THREE.BufferAttribute(colours, 3))
  geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1))
  geometry.setAttribute('phase', new THREE.BufferAttribute(phases, 1))
  const material = new THREE.ShaderMaterial({
    vertexShader: starVertex,
    fragmentShader: starFragment,
    uniforms: { uTime: { value: 0 }, uScale: { value: 1 }, uTwinkle: { value: 0 } },
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
  })
  const stars = new THREE.Points(geometry, material)
  stars.frustumCulled = false
  return stars
}

// ---- Nebulae ----------------------------------------------------------------

function cloudTexture(rng, size = 256) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')
  const image = ctx.createImageData(size, size)
  const seed = rng() * 100
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size - 0.5
      const v = y / size - 0.5
      const falloff = Math.max(0, 1 - Math.hypot(u, v) * 2) ** 1.6
      const n = fbm3(u * 4 + seed, v * 4, seed, 5)
      const wisps = Math.max(0, n - 0.38) * 2.6
      const value = Math.min(1, wisps * falloff) * 255
      const i = (y * size + x) * 4
      image.data[i] = image.data[i + 1] = image.data[i + 2] = value
      image.data[i + 3] = 255
    }
  }
  ctx.putImageData(image, 0, 0)
  return new THREE.CanvasTexture(canvas)
}

function createNebulae(rng) {
  const group = new THREE.Group()
  const tints = [
    [0.55, 0.12, 0.6],
    [0.1, 0.3, 0.7],
    [0.7, 0.18, 0.25],
    [0.1, 0.5, 0.55],
  ]
  const textures = Array.from({ length: 3 }, () => cloudTexture(rng))
  const tilt = new THREE.Matrix4().makeRotationFromEuler(BAND_TILT)
  const clouds = []
  for (let i = 0; i < 9; i++) {
    // Along the galactic band, like the real thing.
    const angle = rng() * Math.PI * 2
    const direction = new THREE.Vector3(Math.cos(angle), random(rng, -0.15, 0.15), Math.sin(angle))
      .normalize()
      .applyMatrix4(tilt)
    const tint = tints[Math.floor(rng() * tints.length)]
    const material = new THREE.MeshBasicMaterial({
      map: textures[i % textures.length],
      color: new THREE.Color(...tint),
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      fog: false,
    })
    const size = random(rng, 2600, 5200)
    const cloud = new THREE.Mesh(new THREE.PlaneGeometry(size, size), material)
    cloud.position.copy(direction).multiplyScalar(SKY_RADIUS * 0.95)
    cloud.lookAt(0, 0, 0)
    cloud.rotateZ(rng() * Math.PI * 2)
    group.add(cloud)
    clouds.push({ material, base: material.color.clone(), phase: rng() * 10 })
  }
  return { group, clouds }
}

// ---- Planets ----------------------------------------------------------------

// Equirectangular texture: `colourAt` gets a point on the unit sphere and
// fills `out` with 0..255 RGB. Sampling the sphere keeps the seam invisible.
function planetTexture(width, height, colourAt) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  const image = ctx.createImageData(width, height)
  const out = [0, 0, 0]
  for (let y = 0; y < height; y++) {
    const lat = (0.5 - (y + 0.5) / height) * Math.PI
    for (let x = 0; x < width; x++) {
      const lon = ((x + 0.5) / width) * Math.PI * 2
      // Matches SphereGeometry's uv layout.
      colourAt(-Math.cos(lon) * Math.cos(lat), Math.sin(lat), Math.sin(lon) * Math.cos(lat), out)
      const i = (y * width + x) * 4
      image.data[i] = out[0]
      image.data[i + 1] = out[1]
      image.data[i + 2] = out[2]
      image.data[i + 3] = 255
    }
  }
  ctx.putImageData(image, 0, 0)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

function gradient(stops, t, out) {
  t = THREE.MathUtils.clamp(t, 0, 1) * (stops.length - 1)
  const i = Math.min(stops.length - 2, Math.floor(t))
  const f = t - i
  for (let c = 0; c < 3; c++) out[c] = stops[i][c] + (stops[i + 1][c] - stops[i][c]) * f
}

const GIANT_BANDS = [
  [62, 34, 24],
  [140, 82, 48],
  [214, 168, 112],
  [236, 214, 176],
  [176, 112, 70],
  [98, 54, 38],
]
const STORM_CENTRE = new THREE.Vector3().setFromSphericalCoords(1, Math.PI / 2 + 0.38, 1.2)

function gasGiantTexture() {
  return planetTexture(1024, 512, (x, y, z, out) => {
    // Bands are mostly latitude, pushed around by turbulence.
    const swirl = (fbm3(x * 3, y * 3, z * 3, 4) - 0.5) * 0.16
    const band = y + swirl
    const t = 0.5 * noise3(band * 9, 1.7, 0.2) + 0.35 * noise3(band * 26, 3.1, 0.7) + 0.15 * noise3(band * 70, 5, 1)
    gradient(GIANT_BANDS, t * 1.25 - 0.1, out)
    // A great storm, squashed into an oval.
    const dx = x - STORM_CENTRE.x
    const dy = (y - STORM_CENTRE.y) * 2.2
    const dz = z - STORM_CENTRE.z
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz)
    if (d < 0.2) {
      const core = 1 - d / 0.2
      const rings = 0.5 + 0.5 * Math.sin(d * 110 + swirl * 40)
      const k = THREE.MathUtils.smoothstep(core, 0, 0.5)
      out[0] += (190 + rings * 30 - out[0]) * k
      out[1] += (70 + rings * 20 - out[1]) * k
      out[2] += (40 - out[2]) * k
    }
  })
}

function oceanTexture() {
  return planetTexture(512, 256, (x, y, z, out) => {
    const land = fbm3(x * 2.2 + 7, y * 2.2, z * 2.2, 5)
    if (land > 0.54) {
      gradient([[70, 96, 48], [120, 104, 70], [170, 160, 140]], (land - 0.54) * 5, out)
    } else {
      gradient([[8, 24, 70], [18, 62, 120], [40, 120, 150]], land * 1.9 - 0.1, out)
    }
    const ice = THREE.MathUtils.smoothstep(Math.abs(y), 0.82, 0.9)
    const cloud = THREE.MathUtils.smoothstep(fbm3(x * 4 + 20, y * 6, z * 4, 4), 0.5, 0.68)
    const white = Math.max(ice, cloud * 0.9)
    for (let c = 0; c < 3; c++) out[c] += (235 - out[c]) * white
  })
}

function rockTexture() {
  return planetTexture(256, 128, (x, y, z, out) => {
    const base = fbm3(x * 3, y * 3, z * 3, 5)
    const pits = Math.abs(noise3(x * 14, y * 14, z * 14) - 0.5) * 2
    const value = 60 + base * 110 - (1 - pits) ** 6 * 40
    out[0] = value * 1.02
    out[1] = value
    out[2] = value * 0.95
  })
}

// A soft rim of light on the sunlit edge.
function atmosphere(radius, colour, strength) {
  const material = new THREE.ShaderMaterial({
    uniforms: { uSun: { value: SUN_DIRECTION }, uColour: { value: new THREE.Color(colour) }, uStrength: { value: strength } },
    vertexShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vWorld;
      void main() {
        vNormal = normalize(mat3(modelMatrix) * normal);
        vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uSun;
      uniform vec3 uColour;
      uniform float uStrength;
      varying vec3 vNormal;
      varying vec3 vWorld;
      void main() {
        vec3 view = normalize(cameraPosition - vWorld);
        float rim = pow(1.0 - max(dot(vNormal, view), 0.0), 3.0);
        float lit = smoothstep(-0.3, 0.6, dot(vNormal, uSun));
        gl_FragColor = vec4(uColour * rim * lit * uStrength, 1.0);
      }`,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
  })
  return new THREE.Mesh(new THREE.SphereGeometry(radius * 1.04, 64, 32), material)
}

function ringTexture(rng) {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 4
  const ctx = canvas.getContext('2d')
  for (let x = 0; x < 512; x++) {
    const t = x / 512
    // Dense bands with a couple of clean gaps.
    let alpha = 0.25 + noise3(t * 40, 0.5, 0.5) * 0.5 + noise3(t * 160, 2, 2) * 0.25
    if (Math.abs(t - 0.62) < 0.035 || Math.abs(t - 0.2) < 0.012) alpha *= 0.08
    alpha *= THREE.MathUtils.smoothstep(t, 0, 0.06) * (1 - THREE.MathUtils.smoothstep(t, 0.92, 1))
    const shade = 150 + rng() * 60
    ctx.fillStyle = `rgba(${shade + 30}, ${shade + 5}, ${shade - 25}, ${alpha})`
    ctx.fillRect(x, 0, 1, 4)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

function createRings(rng, inner, outer) {
  const geometry = new THREE.RingGeometry(inner, outer, 160, 1)
  // Radial uvs, so the band texture runs from the inside edge out.
  const position = geometry.attributes.position
  const uv = geometry.attributes.uv
  for (let i = 0; i < position.count; i++) {
    const r = Math.hypot(position.getX(i), position.getY(i))
    uv.setXY(i, (r - inner) / (outer - inner), 0.5)
  }
  const material = new THREE.MeshBasicMaterial({
    map: ringTexture(rng),
    color: new THREE.Color(0.9, 0.85, 0.8),
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
  })
  const rings = new THREE.Mesh(geometry, material)
  rings.rotation.x = -Math.PI / 2
  return rings
}

function createPlanet({ radius, map, segments = 64, roughness = 1 }) {
  return new THREE.Mesh(
    new THREE.SphereGeometry(radius, segments, segments / 2),
    new THREE.MeshStandardMaterial({ map, roughness, metalness: 0 }),
  )
}

function createGiant(rng) {
  const group = new THREE.Group()
  const planet = createPlanet({ radius: GIANT.radius, map: gasGiantTexture(), segments: 96 })
  const rings = createRings(rng, GIANT.radius * 1.35, GIANT.radius * 2.3)
  group.add(planet, rings, atmosphere(GIANT.radius, 0xffc890, 1.4))
  group.position.copy(GIANT.position)
  group.rotation.set(GIANT.tilt, 0, 0.22)
  return { group, planet }
}

// ---- Orbital station ----------------------------------------------------------

function createStation() {
  const group = new THREE.Group()
  const spinner = new THREE.Group()
  const hull = new THREE.MeshStandardMaterial({ color: 0x8a9096, roughness: 0.5, metalness: 0.6 })
  const r = STATION.radius
  const parts = [
    new THREE.TorusGeometry(r, r * 0.07, 10, 64),
    new THREE.CylinderGeometry(r * 0.12, r * 0.12, r * 0.6, 16).rotateX(Math.PI / 2),
    new THREE.CylinderGeometry(r * 0.05, r * 0.05, r * 1.4, 8).rotateX(Math.PI / 2), // docking spine
  ]
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2
    parts.push(
      new THREE.CylinderGeometry(r * 0.025, r * 0.025, r, 6)
        .translate(0, r / 2, 0)
        .rotateZ(angle),
    )
  }
  spinner.add(new THREE.Mesh(mergeGeometries(parts.map((p) => p.toNonIndexed())), hull))
  // Lit windows round the outside of the ring.
  const windowStrips = []
  for (let i = 0; i < 48; i++) {
    const angle = (i / 48) * Math.PI * 2
    windowStrips.push(
      new THREE.BoxGeometry(r * 0.07, r * 0.02, r * 0.06).translate(0, r * 1.07, 0).rotateZ(angle),
    )
  }
  const windows = new THREE.Mesh(
    mergeGeometries(windowStrips),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.9, 1.3) }),
  )
  spinner.add(windows)
  const beacons = new THREE.Mesh(
    new THREE.SphereGeometry(r * 0.03, 6, 4).translate(0, 0, r * 0.7),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 0.4, 0.2) }),
  )
  group.add(spinner, beacons)
  group.position.copy(STATION.position)
  group.rotation.set(0.9, 0.5, 0.2)
  return { group, spinner, windows, beacons }
}

// ---- All together -------------------------------------------------------------

export function createSpace({ seed = 3 } = {}) {
  const rng = mulberry32(seed)
  const group = new THREE.Group() // fixed in the world
  const sky = new THREE.Group() // follows the camera

  const stars = createStars(rng)
  const nebulae = createNebulae(rng)
  sky.add(nebulae.group, stars)
  // Drawn first, behind everything else.
  sky.traverse((object) => (object.renderOrder = -1))

  const sunlight = new THREE.DirectionalLight(0xfff0dc, 2.6)
  sunlight.position.copy(SUN_DIRECTION).multiplyScalar(1000)
  group.add(sunlight, sunlight.target)

  const giant = createGiant(rng)
  const ocean = createPlanet({ radius: OCEAN.radius, map: oceanTexture(), roughness: 0.7 })
  ocean.position.copy(OCEAN.position)
  ocean.add(atmosphere(OCEAN.radius, 0x6ab0ff, 2.2))
  const moon = createPlanet({ radius: MOON.radius, map: rockTexture(), segments: 32 })
  moon.position.copy(MOON.position)
  const station = createStation()
  group.add(giant.group, ocean, moon, station.group)

  let nebulaGlow = 0
  return {
    group,
    sky,
    // Points are sized in render-target pixels, so they follow the render scale.
    setPixelScale(scale) {
      stars.material.uniforms.uScale.value = scale
    },
    update(delta, elapsed, analysis, camera) {
      sky.position.copy(camera.position)
      const { uniforms } = stars.material
      uniforms.uTime.value = elapsed
      uniforms.uTwinkle.value = analysis.drums.hat


      // Nebulae swell on the heaviest hits and with the drop.
      if (analysis.surge) nebulaGlow = 1
      nebulaGlow = Math.max(0, nebulaGlow - delta * 0.8)
      for (const cloud of nebulae.clouds) {
        const level = 0.75 + Math.sin(elapsed * 0.1 + cloud.phase) * 0.15 + analysis.energy * 0.4 + nebulaGlow * 0.9
        cloud.material.color.copy(cloud.base).multiplyScalar(level)
      }

      giant.planet.rotation.y += GIANT.spin * delta
      ocean.rotation.y += OCEAN.spin * delta
      moon.rotation.y += MOON.spin * delta
      station.spinner.rotation.z += STATION.spin * delta
      station.beacons.visible = elapsed % 1.6 < 0.15
      station.windows.material.color.setRGB(2.2, 1.9, 1.3).multiplyScalar(0.7 + analysis.levels.bass * 0.8)
    },
  }
}
