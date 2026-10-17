import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { mulberry32 } from './random.js'
import { CELLS, createFacadeTextures } from './textures.js'
import { SignBuilder } from './signs.js'
import { SQUARE } from './square.js'

const BLOCK = 30
const STREET = 14
const PITCH = BLOCK + STREET // streets run along x = k * PITCH and z = k * PITCH
const BLOCKS_PER_SIDE = 6
const EXTENT = BLOCKS_PER_SIDE * PITCH
const FLOOR_H = 3.5
const WINDOW_W = 3
const LAMP_SPACING = 22

const SODIUM = new THREE.Color(1, 0.6, 0.25)
// How much windows follow the kick rather than their own band (0..1).
const WINDOW_SYNC = 0.65
const CALM_WINDOW_SYNC = 0.15 // in quiet passages windows follow their own band
// Windows take their colour from the palette (colours.js) by the frequency
// they listen to; only the hue is used, so each keeps its own brightness.
// The heaviest bass pushes still turn everything storm red.
const STORM = new THREE.Color(1, 0.08, 0.04)
const glsl = (colour) => `vec3(${colour.r.toFixed(2)}, ${colour.g.toFixed(2)}, ${colour.b.toFixed(2)})`
const storm = STORM.clone().multiplyScalar(1 / (STORM.r * 0.299 + STORM.g * 0.587 + STORM.b * 0.114))

function solidColor(geometry, color) {
  const count = geometry.attributes.position.count
  const colors = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) color.toArray(colors, i * 3)
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return geometry
}

function box(w, h, d, x, y, z) {
  return new THREE.BoxGeometry(w, h, d).translate(x, y, z)
}

// Box whose side UVs are scaled so window cells keep a real-world size.
function facadeGeometry(rng, x, z, w, d, floors, tint) {
  const h = floors * FLOOR_H
  const geometry = new THREE.BoxGeometry(w, h, d)
  const uv = geometry.attributes.uv
  const offsetU = Math.floor(rng() * CELLS) / CELLS
  const offsetV = Math.floor(rng() * CELLS) / CELLS

  // BoxGeometry faces, 4 vertices each: +x, -x, +y, -y, +z, -z
  for (let face = 0; face < 6; face++) {
    const span = face < 2 ? d : w
    for (let i = face * 4; i < face * 4 + 4; i++) {
      if (face === 2 || face === 3) {
        uv.setXY(i, 0.001, 0.001)
      } else {
        uv.setXY(
          i,
          offsetU + (uv.getX(i) * span) / (CELLS * WINDOW_W),
          offsetV + (uv.getY(i) * h) / (CELLS * FLOOR_H),
        )
      }
    }
  }
  return solidColor(geometry.translate(x, h / 2, z), tint)
}

function concreteTint(rng) {
  return new THREE.Color().setHSL(0.2 + rng() * 0.3, 0.04 + rng() * 0.08, 0.26 + rng() * 0.2)
}

function addRoofClutter(rng, geometries, x, z, w, d, h) {
  const count = Math.floor(rng() * 4)
  for (let i = 0; i < count; i++) {
    const s = 1 + rng() * 3
    const px = x + (rng() - 0.5) * (w - s)
    const pz = z + (rng() - 0.5) * (d - s)
    geometries.push(box(s, 0.8 + rng() * 1.5, s * (0.6 + rng()), px, h + 0.7, pz))
  }
  if (rng() < 0.25) {
    // Water tank on legs
    const px = x + (rng() - 0.5) * (w - 4)
    const pz = z + (rng() - 0.5) * (d - 4)
    geometries.push(new THREE.CylinderGeometry(1.6, 1.6, 3, 10).translate(px, h + 4, pz))
    geometries.push(box(2.6, 2.5, 0.2, px, h + 1.25, pz))
  }
  if (rng() < 0.35) {
    const antennaH = 4 + rng() * 10
    geometries.push(
      new THREE.CylinderGeometry(0.06, 0.1, antennaH, 4).translate(x, h + antennaH / 2, z),
    )
  }
}

function fillBlock(rng, cx, cz, addBuilding) {
  // Blocks are split into a 1 or 2 by 1 or 2 grid of lots inside a 2-unit sidewalk.
  const usable = 24
  const splitsX = rng() < 0.6 ? 2 : 1
  const splitsZ = rng() < 0.6 ? 2 : 1
  const lotW = usable / splitsX
  const lotD = usable / splitsZ
  for (let i = 0; i < splitsX; i++) {
    for (let j = 0; j < splitsZ; j++) {
      const x = cx - usable / 2 + lotW * (i + 0.5)
      const z = cz - usable / 2 + lotD * (j + 0.5)
      const shrink = rng() < 0.3 ? WINDOW_W : 0
      const distance = Math.hypot(cx, cz)
      const towerBias = distance > 80 ? 1 : 0.55
      const floors = 3 + Math.floor(rng() ** 2.2 * 26 * towerBias)
      // Sides on the block's edge face a street; inner sides face neighbours.
      const faces = []
      if (i === 0) faces.push('-x')
      if (i === splitsX - 1) faces.push('+x')
      if (j === 0) faces.push('-z')
      if (j === splitsZ - 1) faces.push('+z')
      addBuilding(x, z, lotW - shrink, lotD - shrink, floors, faces)
    }
  }
}

function addLamp(geometries, bulbs, x, z, armDir) {
  const [ax, az] = armDir
  geometries.push(new THREE.CylinderGeometry(0.1, 0.16, 7, 6).translate(x, 3.5, z))
  geometries.push(
    box(ax ? 1.8 : 0.12, 0.12, az ? 1.8 : 0.12, x + ax * 0.9, 6.9, z + az * 0.9),
  )
  geometries.push(box(0.9, 0.22, 0.9, x + ax * 1.8, 6.85, z + az * 1.8))
  bulbs.push(box(0.6, 0.05, 0.6, x + ax * 1.8, 6.72, z + az * 1.8))
}

function insideSquare(x0, x1, z0, z1, margin = 0) {
  const b = SQUARE.bounds
  return x1 > b.x0 - margin && x0 < b.x1 + margin && z1 > b.z0 - margin && z0 < b.z1 + margin
}

function placeLamps(plainGeometries, bulbGeometries) {
  const curb = STREET / 2 - 0.8
  for (let k = -BLOCKS_PER_SIDE; k <= BLOCKS_PER_SIDE; k++) {
    const line = k * PITCH
    for (const side of [-1, 1]) {
      const stagger = side > 0 ? 0 : LAMP_SPACING / 2
      for (let t = -EXTENT + stagger; t < EXTENT; t += LAMP_SPACING) {
        const local = ((t % PITCH) + PITCH) % PITCH
        if (local < STREET / 2 + 1 || local > PITCH - STREET / 2 - 1) continue // intersection
        // Streets along z, then streets along x
        const placements = [
          [line + side * curb, t, [-side, 0]],
          [t, line + side * curb, [0, -side]],
        ]
        for (const [x, z, dir] of placements) {
          if (insideSquare(x, x, z, z, 2)) continue
          addLamp(plainGeometries, bulbGeometries, x, z, dir)
        }
      }
    }
  }
}

function createCitadel() {
  const group = new THREE.Group()
  const material = new THREE.MeshBasicMaterial({ color: 0x1f262b, fog: false })
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(4, 38, 720, 9, 1), material)
  tower.position.y = 360
  group.add(tower)

  const beacon = new THREE.Mesh(
    new THREE.SphereGeometry(3, 12, 8),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.4, 0.2), fog: false }),
  )
  beacon.position.y = 722
  group.add(beacon)

  group.position.set(-260, 0, -640)
  return {
    group,
    update(elapsed) {
      beacon.visible = Math.sin(elapsed * 2.2) > 0.4
    },
  }
}

export function createCity({ audioField, seed = 17, maxAnisotropy = 1 } = {}) {
  const rng = mulberry32(seed)
  const group = new THREE.Group()
  const facadeTextures = createFacadeTextures(rng, maxAnisotropy)
  const facadeGeometries = facadeTextures.map(() => [])
  const plainGeometries = []
  const bulbGeometries = []
  // Own random stream, so adding or tuning signs doesn't reshuffle the layout.
  const signs = new SignBuilder(mulberry32(seed + 1), maxAnisotropy)

  const addBuilding = (x, z, w, d, floors, faces) => {
    const variant = Math.floor(rng() * facadeTextures.length)
    facadeGeometries[variant].push(facadeGeometry(rng, x, z, w, d, floors, concreteTint(rng)))
    addRoofClutter(rng, plainGeometries, x, z, w, d, floors * FLOOR_H)
    signs.decorate({ x, z, w, d, height: floors * FLOOR_H, faces }, plainGeometries, FLOOR_H)
  }

  for (let bx = -BLOCKS_PER_SIDE; bx < BLOCKS_PER_SIDE; bx++) {
    for (let bz = -BLOCKS_PER_SIDE; bz < BLOCKS_PER_SIDE; bz++) {
      const cx = (bx + 0.5) * PITCH
      const cz = (bz + 0.5) * PITCH
      // The square replaces any block its buildings overlap.
      if (insideSquare(cx - BLOCK / 2, cx + BLOCK / 2, cz - BLOCK / 2, cz + BLOCK / 2)) continue
      plainGeometries.push(box(BLOCK, 0.2, BLOCK, cx, 0.1, cz)) // sidewalk
      fillBlock(rng, cx, cz, addBuilding)
    }
  }

  // The square's buildings get screens instead of signs.
  for (const { x0, x1, z0, z1, floors } of SQUARE.buildings) {
    addBuilding((x0 + x1) / 2, (z0 + z1) / 2, x1 - x0, z1 - z0, floors, [])
  }

  placeLamps(plainGeometries, bulbGeometries)

  facadeTextures.forEach(({ map, emissiveMap, triggerMap, bandMap }, i) => {
    const material = new THREE.MeshStandardMaterial({
      map,
      emissiveMap,
      emissive: 0xffffff,
      emissiveIntensity: 1.2,
      vertexColors: true,
      roughness: 0.9,
    })
    audioField.patch(material, {
      after: '#include <emissivemap_fragment>',
      apply: /* glsl */ `
        vec3 audioCell = texture2D(uBandMap, vEmissiveMapUv).rgb;
        // Mostly the kick (band 0), so each beat sweeps down the street as one
        // wave, with the window's own band adding variety. In quiet passages
        // (build-ups, often no kick) windows follow their own band instead.
        float windowSync = mix(${WINDOW_SYNC.toFixed(2)}, ${CALM_WINDOW_SYNC.toFixed(2)}, audioCalm());
        float windowLevel = mix(audioLevel(audioCell.r), audioLevel(0.0), windowSync);
        windowLevel *= audioStereoGain();
        totalEmissiveRadiance *= audioGainFor(windowLevel);
        // Dark windows that switch on when the level passes their threshold.
        if (audioCell.g > 0.0) {
          totalEmissiveRadiance += texture2D(uTriggerMap, vEmissiveMapUv).rgb
            * emissive * audioTriggerFor(windowLevel, audioCell.g);
        }
        // Palette colour for this window, by its band.
        float windowGlow = dot(totalEmissiveRadiance, vec3(0.299, 0.587, 0.114));
        totalEmissiveRadiance = mix(totalEmissiveRadiance, paletteAt(audioCell.r) * windowGlow, uPaletteTint * uAudioActive);
        // Drum windows: snares flash a near-white palette accent (alternating
        // sides), hats twinkle another. Role is in blue: ~0.5 snare, 1 hat.
        if (audioCell.b > 0.3) {
          totalEmissiveRadiance += audioCell.b > 0.75
            ? paletteAt(0.75) * 1.3 * audioHat()
            : (paletteAt(0.5) + vec3(1.2)) * audioSnare();
        }
        // The heaviest bass pushes: storm red, same brightness.
        float glow = dot(totalEmissiveRadiance, vec3(0.299, 0.587, 0.114));
        totalEmissiveRadiance = mix(totalEmissiveRadiance, ${glsl(storm)} * glow, audioUnify());`,
      uniforms: { uBandMap: { value: bandMap }, uTriggerMap: { value: triggerMap } },
      declarations: 'uniform sampler2D uBandMap;\nuniform sampler2D uTriggerMap;',
    })
    group.add(new THREE.Mesh(mergeGeometries(facadeGeometries[i]), material))
  })

  const signMesh = signs.build(audioField)
  group.add(signMesh.mesh)

  group.add(
    new THREE.Mesh(
      mergeGeometries(plainGeometries),
      new THREE.MeshStandardMaterial({ color: 0x3d4241, roughness: 0.85, metalness: 0.1 }),
    ),
  )
  const bulbMaterial = new THREE.MeshBasicMaterial({ color: SODIUM.clone().multiplyScalar(6) })
  audioField.patch(bulbMaterial, {
    after: '#include <color_fragment>',
    apply: 'diffuseColor.rgb *= audioGain(0.0);', // band 0 = bass
  })
  group.add(new THREE.Mesh(mergeGeometries(bulbGeometries), bulbMaterial))

  // Asphalt; made wet (puddles and reflections) by createWetness
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(EXTENT * 4, EXTENT * 4),
    new THREE.MeshStandardMaterial({ color: 0x1a1d1f, roughness: 0.95, metalness: 0 }),
  )
  ground.rotation.x = -Math.PI / 2
  group.add(ground)

  const citadel = createCitadel()
  group.add(citadel.group)

  return {
    group,
    wetSurfaces: [{ mesh: ground, puddles: true }],
    update(elapsed) {
      citadel.update(elapsed)
      signMesh.update(elapsed)
    },
  }
}
