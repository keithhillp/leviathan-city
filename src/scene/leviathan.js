import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { HUB, SKYWAYS } from './plan.js'

// Leviathan Labs: the megatower at the hub, where every avenue leads. A
// stepped octagonal podium, a shaft with eight light ribs up its corners, a
// dropship deck, and the Eye: a ring of screens round a glowing iris, with
// the spire above. Four satellite towers stand on skybridges round it. No
// windows: it's a near-black monolith cut by seams of light that play the
// music, unlike anything else in the city.
//
// Heights, and octagon apothems (centre to side).
const PODIUM = [
  { r: 118, h: 18 },
  { r: 100, h: 42 },
  { r: 82, h: 66 },
]
const PODIUM_TOP = PODIUM.reduce((y, { h }) => y + h, 0)
const SHAFT = [
  { r0: 58, r1: 52, y1: 450 },
  { r0: 46, r1: 40, y1: 760 },
]
const DECK = { r: 86, y: 760, thickness: 5, pads: 3, padRadius: 55 }
const NECK = { r: 30, y1: 817 }
const EYE = { outer: 72, inner: 54, y0: 817, y1: 863, iris: 16 }
const SPIRE = { y0: 863, y1: 1075, base: 7 }
const SATELLITES = { count: 4, distance: 135, size: 26, height: 470, bridge: { y: 446, width: 8, depth: 5 } }
const SEARCHLIGHTS = { count: 6, radius: 80, length: 520, spread: 46, tilt: [0.45, 0.85], speed: 0.12 }
const PLAZA = { r: 150, height: 0.12 }
const PORTAL = { width: 26, height: 14 }
const DECK_PORTAL = { width: 20, height: 14 } // where the radials and express decks go in
const SHAFT_BAND_SPACING = 70

// Fog thins with height: at y it's this much as thick as at the ground
// (THIN + (1 - THIN) * exp(-y / FOG_SCALE)), so the base sinks into the haze
// while the crown stands clear of it across the city.
const FOG_THIN = 0.07
const FOG_SCALE = 140

const MONOLITH = new THREE.Color(0x0b0d10)
// The seams: vertical ones up the corners and the middle of each face, and
// lines round it every LINE_SPACING; a scan band sweeps up it.
const SEAM_WIDTH = 0.35
const LINE_SPACING = 10.5
const SCAN = { speed: 110, span: 1150, width: 14 }
const STRUCTURE = new THREE.Color(0x1a1e22)
const PORTAL_BLACK = new THREE.Color(0x030304)
const PAVING = new THREE.Color(0x24282a)
const RIB = new THREE.Color(0.6, 1.6, 2.4) // cold cyan, HDR
const BAND = new THREE.Color(2.4, 1.3, 0.4) // sodium
const MARKER = new THREE.Color(3, 0.1, 0.06)
const IRIS = new THREE.Color(4, 0.5, 0.3)
const BEACON = new THREE.Color(8, 0.3, 0.2)
const STORM = new THREE.Color(1, 0.08, 0.04)
const SEARCHLIGHT = new THREE.Color(0.11, 0.12, 0.13)

// Glow roles (the shader's vRole).
const ROLE = { rib: 0, band: 1, marker: 2, iris: 3, beacon: 4 }
const RIB_CLIMB = 0.55 // share of the audio history a kick takes to climb the ribs

const TAN = Math.tan(Math.PI / 8)
const toRadius = (apothem) => apothem / Math.cos(Math.PI / 8)

// Patches a material's fog to thin with height (see FOG_THIN).
function heightFog(material) {
  const previous = material.onBeforeCompile
  const baseKey = material.customProgramCacheKey()
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vFogHeight;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvFogHeight = (modelMatrix * vec4(transformed, 1.0)).y;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vFogHeight;')
      .replace(
        '#include <fog_fragment>',
        /* glsl */ `
        #ifdef USE_FOG
          float fogThin = mix(${FOG_THIN.toFixed(3)}, 1.0, exp(-max(vFogHeight, 0.0) / ${FOG_SCALE.toFixed(1)}));
          float fogReach = fogDensity * vFogDepth * fogThin;
          gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, 1.0 - exp(-fogReach * fogReach));
        #endif`,
      )
  }
  material.customProgramCacheKey = () => `${baseKey}|heightfog`
}

const tinted = (geometry, colour) => {
  const colours = new Float32Array(geometry.attributes.position.count * 3)
  for (let i = 0; i < colours.length; i += 3) colour.toArray(colours, i)
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3))
  return geometry
}
const roled = (geometry, colour, role) => {
  tinted(geometry, colour)
  geometry.setAttribute('aRole', new THREE.BufferAttribute(new Float32Array(geometry.attributes.position.count).fill(role), 1))
  return geometry
}

// An octagonal prism (sides facing the avenues) from y0 to y1, apothem r0 at
// the bottom and r1 at the top.
function prism(r0, r1, y0, y1, { open = false } = {}) {
  return new THREE.CylinderGeometry(toRadius(r1), toRadius(r0), y1 - y0, 8, 1, open)
    .rotateY(Math.PI / 8)
    .translate(0, (y0 + y1) / 2, 0)
}

// A box `width` by `depth` whose top runs from a to b ([x, y, z]).
function beam(a, b, width, depth) {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const dz = b[2] - a[2]
  const run = Math.hypot(dx, dz)
  return new THREE.BoxGeometry(Math.hypot(run, dy), depth, width)
    .translate(0, -depth / 2, 0)
    .rotateZ(Math.atan2(dy, run))
    .rotateY(Math.atan2(-dz, dx))
    .translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2)
}

// The band of screens round the Eye: the company's name, scrolling round.
function createEyeTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 1024
  canvas.height = 64
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.font = 'bold 40px "Silkscreen", monospace'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#e8f4ff'
  ctx.shadowColor = '#8fd8ff'
  ctx.shadowBlur = 10
  const text = 'LEVIATHAN LABS  ◉  '
  const width = ctx.measureText(text).width
  for (let x = 0; x < canvas.width; x += width) ctx.fillText(text, x, canvas.height / 2 + 2)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.RepeatWrapping
  texture.repeat.set(3, 1) // three times round
  return texture
}

// `radials` is the plan's skyways.radials: which sectors' radials and express
// decks come in to the podium.
export function createLeviathan({ audioField, radials }) {
  const group = new THREE.Group()
  group.position.set(HUB.x, 0, HUB.z)
  const time = { value: 0 }
  const glsl = (c) => `vec3(${c.r.toFixed(3)}, ${c.g.toFixed(3)}, ${c.b.toFixed(3)})`
  const storm = STORM.clone().multiplyScalar(1 / (STORM.r * 0.299 + STORM.g * 0.587 + STORM.b * 0.114))

  // The monolith's walls: podium, shaft, neck and the satellite towers.
  const walls = []
  let y = 0
  for (const { r, h } of PODIUM) {
    walls.push(prism(r, r, y, y + h))
    y += h
  }
  let shaftBottom = PODIUM_TOP
  for (const { r0, r1, y1 } of SHAFT) {
    walls.push(prism(r0, r1, shaftBottom, y1))
    shaftBottom = y1
  }
  walls.push(prism(NECK.r, NECK.r, DECK.y + DECK.thickness, NECK.y1))
  const satelliteAngles = Array.from({ length: SATELLITES.count }, (_, i) => Math.PI / 8 + (i * 2 * Math.PI) / SATELLITES.count)
  for (const angle of satelliteAngles) {
    const [x, z] = [Math.sin(angle) * SATELLITES.distance, Math.cos(angle) * SATELLITES.distance]
    const { size, height } = SATELLITES
    walls.push(new THREE.BoxGeometry(size, height, size).rotateY(angle).translate(x, height / 2, z))
  }
  const wallMaterial = new THREE.MeshStandardMaterial({ color: MONOLITH, roughness: 0.35, metalness: 0.7, flatShading: true })
  const climbFrom = PODIUM_TOP
  const climbTo = SHAFT.at(-1).y1
  audioField.patch(wallMaterial, {
    declarations: 'uniform float uTime;',
    uniforms: { uTime: time },
    after: '#include <emissivemap_fragment>',
    apply: /* glsl */ `
      vec2 rel = vAudioWorld.xz - vec2(${HUB.x.toFixed(1)}, ${HUB.z.toFixed(1)});
      float height = vAudioWorld.y;
      float radius = length(rel);
      float around = atan(rel.x, rel.y); // 0 towards +z, as the city's sectors
      // How far this point is from the nearest vertical seam.
      float seam;
      if (radius > 112.0 && height > ${(PODIUM[0].h + 0.5).toFixed(1)}) {
        // A satellite: seams at its corners and down the middle of each face.
        float k = floor((around - ${(Math.PI / 8).toFixed(5)}) / ${(Math.PI / 2).toFixed(5)} + 0.5);
        float a = ${(Math.PI / 8).toFixed(5)} + k * ${(Math.PI / 2).toFixed(5)};
        vec2 local = rel - ${SATELLITES.distance.toFixed(1)} * vec2(sin(a), cos(a));
        vec2 l = vec2(local.x * cos(a) - local.y * sin(a), local.x * sin(a) + local.y * cos(a));
        float along = abs(l.x) > abs(l.y) ? l.y : l.x;
        seam = min(abs(along), ${(SATELLITES.size / 2).toFixed(1)} - abs(along));
      } else {
        // The tower: every eighth of a turn, corners and face middles.
        float seamStep = ${(Math.PI / 8).toFixed(5)};
        seam = abs(fract(around / seamStep + 0.5) - 0.5) * seamStep * radius;
      }
      // Smoothed by how much they span on screen, so thin lines far off
      // don't shimmer.
      float seamBlur = fwidth(seam);
      float vertical = 1.0 - smoothstep(${SEAM_WIDTH.toFixed(2)} - seamBlur, ${SEAM_WIDTH.toFixed(2)} + seamBlur, seam);
      float line = abs(fract(height / ${LINE_SPACING.toFixed(1)} + 0.5) - 0.5) * ${LINE_SPACING.toFixed(1)};
      float lineBlur = fwidth(height);
      float across = 1.0 - smoothstep(0.18 - lineBlur, 0.18 + lineBlur, line);

      // Each kick climbs the seams (older beats higher up), the mids light
      // the lines, and a scan band sweeps up the whole tower.
      float climb = clamp((height - ${climbFrom.toFixed(1)}) / ${(climbTo - climbFrom).toFixed(1)}, 0.0, 1.0);
      float kick = audioLevelAt(0.0, climb * ${RIB_CLIMB.toFixed(2)});
      float mids = audioLevelAt(0.45, climb * 0.25);
      float scan = 1.0 - smoothstep(0.0, ${SCAN.width.toFixed(1)}, abs(height - mod(uTime * ${SCAN.speed.toFixed(1)}, ${SCAN.span.toFixed(1)})));
      vec3 seamColour = mix(${glsl(RIB)}, paletteAt(climb) * 1.6, uPaletteTint * uAudioActive);
      float upward = vertical * (0.18 + mix(0.25, kick * 2.6, uAudioActive));
      float rings = across * (0.05 + mids * 1.1 * uAudioActive + scan * 1.4);
      vec3 seamLight = seamColour * (upward + rings);
      // The heaviest bass pushes: storm red, same brightness.
      seamLight = mix(seamLight, ${glsl(storm)} * dot(seamLight, vec3(0.299, 0.587, 0.114)), audioUnify());
      totalEmissiveRadiance += seamLight;`,
  })
  heightFog(wallMaterial)
  group.add(new THREE.Mesh(mergeGeometries(walls), wallMaterial))

  // Dark structure: the plaza, the deck, the Eye's ring, the spire, bridges
  // and the portals where the avenues meet the podium.
  const structure = [
    tinted(prism(PLAZA.r, PLAZA.r, 0, PLAZA.height), PAVING),
    tinted(prism(DECK.r, DECK.r, DECK.y, DECK.y + DECK.thickness), STRUCTURE),
    tinted(prism(EYE.outer, EYE.outer, EYE.y0, EYE.y1, { open: true }), STRUCTURE),
    tinted(prism(EYE.inner, EYE.inner, EYE.y0, EYE.y1, { open: true }), STRUCTURE),
    tinted(new THREE.RingGeometry(toRadius(EYE.inner), toRadius(EYE.outer), 8, 1, Math.PI / 8).rotateX(-Math.PI / 2).translate(0, EYE.y1, 0), STRUCTURE),
    tinted(new THREE.RingGeometry(toRadius(EYE.inner), toRadius(EYE.outer), 8, 1, Math.PI / 8).rotateX(Math.PI / 2).translate(0, EYE.y0, 0), STRUCTURE),
    tinted(new THREE.CylinderGeometry(0.6, SPIRE.base, SPIRE.y1 - SPIRE.y0, 8).translate(0, (SPIRE.y0 + SPIRE.y1) / 2, 0), STRUCTURE),
    // Struts holding the Eye's ring to the neck.
    ...Array.from({ length: 8 }, (_, i) => {
      const angle = Math.PI / 8 + (i * Math.PI) / 4
      const [sx, sz] = [Math.sin(angle), Math.cos(angle)]
      return tinted(beam([sx * NECK.r, EYE.y0 + 4, sz * NECK.r], [sx * EYE.inner, EYE.y0 + 4, sz * EYE.inner], 2, 3), STRUCTURE)
    }),
  ]
  for (let i = 0; i < 8; i++) {
    const angle = (i * Math.PI) / 4 // facing each avenue
    const [sx, sz] = [Math.sin(angle), Math.cos(angle)]
    const portal = new THREE.BoxGeometry(PORTAL.width, PORTAL.height, 2)
      .rotateY(angle)
      .translate(sx * (PODIUM[0].r + 0.5), PORTAL.height / 2, sz * (PODIUM[0].r + 0.5))
    structure.push(tinted(portal, PORTAL_BLACK))
  }
  // Where the radials (and, above them, the express decks) go in, on the
  // podium's top tier, facing their avenues.
  const top = PODIUM.at(-1).r + 0.5
  radials.forEach(({ express }, s) => {
    const angle = (s * Math.PI) / 4
    const heights = [SKYWAYS.tower.radialY, ...(express ? [SKYWAYS.tower.expressY] : [])]
    for (const centre of heights) {
      const portal = new THREE.BoxGeometry(DECK_PORTAL.width, DECK_PORTAL.height, 2)
        .rotateY(angle)
        .translate(Math.sin(angle) * top, centre + DECK_PORTAL.height / 2 - 4, Math.cos(angle) * top)
      structure.push(tinted(portal, PORTAL_BLACK))
    }
  })
  for (const angle of satelliteAngles) {
    const [sx, sz] = [Math.sin(angle), Math.cos(angle)]
    const { y: by, width, depth } = SATELLITES.bridge
    const from = [sx * (SHAFT[0].r1 - 2), by, sz * (SHAFT[0].r1 - 2)]
    const to = [sx * (SATELLITES.distance - SATELLITES.size / 2 + 1), by, sz * (SATELLITES.distance - SATELLITES.size / 2 + 1)]
    structure.push(tinted(beam(from, to, width, depth), STRUCTURE))
  }
  const structureMaterial = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.6,
    metalness: 0.4,
    flatShading: true,
    side: THREE.DoubleSide,
  })
  heightFog(structureMaterial)
  group.add(new THREE.Mesh(mergeGeometries(structure), structureMaterial))

  // Light: ribs up the shaft's corners, bands round the podium's tiers, the
  // deck's markers and landing pads, the iris, beacons on the spire and the
  // satellites, and strips under the bridges.
  const glow = []
  const corners = Array.from({ length: 8 }, (_, i) => Math.PI / 8 + (i * Math.PI) / 4) // the prisms' corners
  let ribBottom = PODIUM_TOP
  for (const { r0, r1, y1 } of SHAFT) {
    for (const angle of corners) {
      const [sx, sz] = [Math.sin(angle), Math.cos(angle)]
      const [a, b] = [toRadius(r0) + 0.4, toRadius(r1) + 0.4]
      glow.push(roled(beam([sx * a, ribBottom, sz * a], [sx * b, y1, sz * b], 1.2, 1.2), RIB, ROLE.rib))
    }
    ribBottom = y1
  }
  let bandY = 0
  for (const { r, h } of PODIUM) {
    bandY += h
    glow.push(roled(prism(r + 0.3, r + 0.3, bandY - 0.8, bandY - 0.2, { open: true }), BAND, ROLE.band))
  }
  // Rings of light up the shaft, for a sense of its height.
  for (let ringY = PODIUM_TOP + SHAFT_BAND_SPACING; ringY < DECK.y - 10; ringY += SHAFT_BAND_SPACING) {
    let from = PODIUM_TOP
    const section = SHAFT.find(({ y1 }) => {
      const inside = ringY < y1
      if (!inside) from = y1
      return inside
    })
    const r = section.r0 + ((section.r1 - section.r0) * (ringY - from)) / (section.y1 - from) + 0.3
    glow.push(roled(prism(r, r, ringY, ringY + 0.5, { open: true }), BAND, ROLE.band))
  }
  for (let i = 0; i < 32; i++) {
    const angle = (i / 32) * Math.PI * 2
    const r = toRadius(DECK.r) * 0.97
    glow.push(roled(new THREE.BoxGeometry(1, 0.6, 1).translate(Math.sin(angle) * r, DECK.y + DECK.thickness + 0.3, Math.cos(angle) * r), MARKER, ROLE.marker))
  }
  for (let i = 0; i < DECK.pads; i++) {
    const angle = (i / DECK.pads) * Math.PI * 2 + Math.PI / 6
    const pad = new THREE.RingGeometry(10, 11.2, 16)
      .rotateX(-Math.PI / 2)
      .translate(Math.sin(angle) * DECK.padRadius, DECK.y + DECK.thickness + 0.05, Math.cos(angle) * DECK.padRadius)
    glow.push(roled(pad, BAND, ROLE.band))
  }
  glow.push(roled(new THREE.SphereGeometry(EYE.iris, 8, 6).translate(0, (EYE.y0 + EYE.y1) / 2, 0), IRIS, ROLE.iris))
  glow.push(roled(new THREE.BoxGeometry(3, 3, 3).translate(0, SPIRE.y1 + 1.5, 0), BEACON, ROLE.beacon))
  for (const angle of satelliteAngles) {
    const [sx, sz] = [Math.sin(angle), Math.cos(angle)]
    const [x, z] = [sx * SATELLITES.distance, sz * SATELLITES.distance]
    glow.push(roled(new THREE.BoxGeometry(2, 2, 2).translate(x, SATELLITES.height + 1, z), BEACON, ROLE.beacon))
    const { y: by, depth } = SATELLITES.bridge
    const from = [sx * SHAFT[0].r1, by - depth - 0.1, sz * SHAFT[0].r1]
    const to = [sx * (SATELLITES.distance - SATELLITES.size / 2), by - depth - 0.1, sz * (SATELLITES.distance - SATELLITES.size / 2)]
    glow.push(roled(beam(from, to, 1, 0.3), RIB, ROLE.rib))
  }
  const glowMaterial = new THREE.MeshBasicMaterial({ vertexColors: true })
  audioField.patch(glowMaterial, {
    vertexDeclarations: 'attribute float aRole;\nvarying float vRole;',
    vertexApply: 'vRole = aRole;',
    declarations: 'uniform float uTime;\nvarying float vRole;',
    uniforms: { uTime: time },
    after: '#include <color_fragment>',
    apply: /* glsl */ `
      float glowGain = 1.0;
      float brightness = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
      if (vRole < 0.5) {
        // Ribs: each kick climbs the tower, older beats higher up.
        float climb = clamp((vAudioWorld.y - ${climbFrom.toFixed(1)}) / ${(climbTo - climbFrom).toFixed(1)}, 0.0, 1.0);
        float kick = audioLevelAt(0.0, climb * ${RIB_CLIMB.toFixed(2)});
        glowGain = mix(0.4, 0.2 + kick * 3.2, uAudioActive);
        diffuseColor.rgb = mix(diffuseColor.rgb, paletteAt(climb) * brightness, uPaletteTint * uAudioActive);
      } else if (vRole < 1.5) {
        glowGain = audioGain(0.0); // bands and pads: the bass
      } else if (vRole < 3.5 && vRole > 2.5) {
        // The iris: snares flash it (a side at a time), the bass swells it.
        glowGain = mix(0.7, 0.4 + audioLevel(0.0) * 1.5 + audioSnare() * 4.0, uAudioActive);
      } else if (vRole > 3.5) {
        // Beacons: a slow blink, and a strobe on the hats.
        glowGain = max(step(0.65, fract(uTime * 0.6)), audioHat() * 3.0);
      }
      diffuseColor.rgb *= glowGain;
      // The heaviest bass pushes: storm red, same brightness.
      float glowLevel = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
      diffuseColor.rgb = mix(diffuseColor.rgb, ${glsl(storm)} * glowLevel, audioUnify());`,
  })
  heightFog(glowMaterial)
  group.add(new THREE.Mesh(mergeGeometries(glow), glowMaterial))

  // The Eye's band of screens.
  const eyeTexture = createEyeTexture()
  const eyeMaterial = new THREE.MeshBasicMaterial({ map: eyeTexture })
  eyeMaterial.color.setScalar(3)
  audioField.patch(eyeMaterial, {
    after: '#include <map_fragment>',
    apply: /* glsl */ `
      float eyeGlow = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
      diffuseColor.rgb = mix(diffuseColor.rgb, paletteAt(0.5) * eyeGlow, uPaletteTint * uAudioActive);
      diffuseColor.rgb *= mix(1.0, audioGain(0.0), 0.6);
      diffuseColor.rgb = mix(diffuseColor.rgb, ${glsl(storm)} * eyeGlow, audioUnify());`,
  })
  heightFog(eyeMaterial)
  const band = prism(EYE.outer + 0.3, EYE.outer + 0.3, EYE.y0 + 8, EYE.y1 - 8, { open: true })
  group.add(new THREE.Mesh(band, eyeMaterial))

  // Searchlights sweeping the sky from the deck: additive cones, brightest
  // at the lamp, out of the fog so they're seen across the city.
  const cone = new THREE.ConeGeometry(SEARCHLIGHTS.spread, SEARCHLIGHTS.length, 16, 1, true).translate(0, -SEARCHLIGHTS.length / 2, 0)
  const position = cone.attributes.position
  const fade = new Float32Array(position.count * 3)
  for (let i = 0; i < position.count; i++) {
    const along = -position.getY(i) / SEARCHLIGHTS.length // 0 at the lamp, 1 at the far end
    SEARCHLIGHT.clone().multiplyScalar((1 - along) ** 2).toArray(fade, i * 3)
  }
  cone.setAttribute('color', new THREE.BufferAttribute(fade, 3))
  const searchlights = new THREE.InstancedMesh(
    cone,
    new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    }),
    SEARCHLIGHTS.count,
  )
  searchlights.frustumCulled = false
  group.add(searchlights)
  const matrix = new THREE.Matrix4()
  const quaternion = new THREE.Quaternion()
  const down = new THREE.Vector3(0, -1, 0)
  const aim = new THREE.Vector3()
  const lamp = new THREE.Vector3()
  const one = new THREE.Vector3(1, 1, 1)

  return {
    group,
    // The top of the spire, for lightning to strike.
    spire: new THREE.Vector3(HUB.x, SPIRE.y1 + 3, HUB.z),
    // Where the music's ripples can start from.
    centre: new THREE.Vector3(HUB.x, PODIUM_TOP + 200, HUB.z),
    update(delta, elapsed) {
      time.value = elapsed
      eyeTexture.offset.x = (elapsed * 0.02) % 1
      const [low, high] = SEARCHLIGHTS.tilt
      for (let i = 0; i < SEARCHLIGHTS.count; i++) {
        const base = (i / SEARCHLIGHTS.count) * Math.PI * 2
        lamp.set(Math.sin(base) * SEARCHLIGHTS.radius, DECK.y + DECK.thickness + 1, Math.cos(base) * SEARCHLIGHTS.radius)
        const heading = base + Math.sin(elapsed * SEARCHLIGHTS.speed + i * 1.7) * 1.2
        const tilt = low + (high - low) * (0.5 + 0.5 * Math.sin(elapsed * 0.23 + i * 2.3))
        aim.set(Math.sin(heading) * Math.sin(tilt), Math.cos(tilt), Math.cos(heading) * Math.sin(tilt))
        // The cone points down -y from its tip; turn it to point along `aim`.
        quaternion.setFromUnitVectors(down, aim)
        searchlights.setMatrixAt(i, matrix.compose(lamp, quaternion, one))
      }
      searchlights.instanceMatrix.needsUpdate = true
    },
  }
}
