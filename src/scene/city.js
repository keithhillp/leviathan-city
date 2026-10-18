import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { mulberry32 } from './random.js'
import { createFacadeTextures } from './textures.js'
import { SignBuilder } from './signs.js'
import { STAMP } from './square.js'
import { FLOOR_H, createPlan } from './plan.js'
import { buildChunkGeometry, fromTransfer } from './chunkBuilder.js'
import { ChunkBatch } from './chunkBatch.js'
import { createSkywayGeometry } from './skyways.js'

// Streaming. Chunks within DRAW_RADIUS (of their nearest edge) are drawn: the
// fog leaves next to nothing past it (exp(-(0.006 d)²) is about 1% at 360).
const DRAW_RADIUS = 380
// Small structure (sidewalks, roof clutter, lamp posts, sign frames) is only
// drawn this close; further out the fog has all but washed it out. Windows,
// lamp bulbs and signs, which glow through the haze, go out to DRAW_RADIUS.
const DETAIL_RADIUS = 260
// Chunks are built before they're needed: within LOAD_RADIUS of the camera,
// or of where it's heading LOOK_AHEAD seconds from now.
const LOAD_RADIUS = 460
const LOOK_AHEAD = 3
const UNLOAD_RADIUS = 640 // built chunks further than this are freed
// Chunks are built in a worker, at most MAX_IN_FLIGHT at a time (so the
// nearest are always next as the camera moves), and at most MAX_ATTACH of the
// finished ones are added to the scene per frame. Any chunk within
// URGENT_RADIUS is built at once on the main thread (after a cut or a
// teleport), as is everything if there's no worker, BUILD_BUDGET
// milliseconds' worth per frame.
// Every chunk's geometry goes into one batch per material (chunkBatch.js), so
// the city is a handful of draw calls however many chunks are loaded.
const MAX_IN_FLIGHT = 2
const MAX_ATTACH = 2
const BUILD_BUDGET = 4
const URGENT_RADIUS = 60
const CUT_DISTANCE = 50 // a jump further than this in one frame is a cut, not motion

const SODIUM = new THREE.Color(1, 0.6, 0.25)
const HIGHWAY_MARKER = new THREE.Color(1.6, 0.04, 0.03) // as on the square's rail bridge
const LANE_MARKING = new THREE.Color(0.32, 0.32, 0.3)
// How much windows follow the kick rather than their own band (0..1).
const WINDOW_SYNC = 0.65
const CALM_WINDOW_SYNC = 0.15 // in quiet passages windows follow their own band
// Windows take their colour from the palette (colours.js) by the frequency
// they listen to; only the hue is used, so each keeps its own brightness.
// The heaviest bass pushes still turn everything storm red.
const STORM = new THREE.Color(1, 0.08, 0.04)
const glsl = (colour) => `vec3(${colour.r.toFixed(2)}, ${colour.g.toFixed(2)}, ${colour.b.toFixed(2)})`
const storm = STORM.clone().multiplyScalar(1 / (STORM.r * 0.299 + STORM.g * 0.587 + STORM.b * 0.114))

function createFacadeMaterial({ map, emissiveMap, triggerMap, bandMap }, audioField) {
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
  return material
}

// Distance across the ground from (x, z) to the nearest point of `bounds`.
function distanceTo(bounds, x, z) {
  const dx = Math.max(bounds.x0 - x, 0, x - bounds.x1)
  const dz = Math.max(bounds.z0 - z, 0, z - bounds.z1)
  return Math.hypot(dx, dz)
}

// The city is planned whole up front (plan.js, cheap: just numbers), but its
// geometry is built a chunk at a time as the camera comes near, and freed again
// once it's far away; call stream() every frame with the camera position.
// `worker` builds chunks off the main thread where it can.
export function createCity({ audioField, seed = 17, maxAnisotropy = 1, worker = true } = {}) {
  const group = new THREE.Group()
  const facadeTextures = createFacadeTextures(mulberry32(seed), maxAnisotropy)
  const plan = createPlan({ seed, facadeVariants: facadeTextures.length, stamps: [STAMP] })
  // Materials are shared by every chunk, so streaming never compiles shaders.
  const facadeMaterials = facadeTextures.map((textures) => createFacadeMaterial(textures, audioField))
  const signs = new SignBuilder(mulberry32(seed + 1), maxAnisotropy, audioField)
  const plainMaterial = new THREE.MeshStandardMaterial({ color: 0x3d4241, roughness: 0.85, metalness: 0.1 })
  const bulbMaterial = new THREE.MeshBasicMaterial({ color: SODIUM.clone().multiplyScalar(6) })
  audioField.patch(bulbMaterial, {
    after: '#include <color_fragment>',
    apply: 'diffuseColor.rgb *= audioGain(0.0);', // band 0 = bass
  })

  // Every roof, built or not, for anything that wants to land on them.
  const rooftops = plan.lots.map(({ x, z, w, d, floors }) => ({ x, z, w, d, y: floors * FLOOR_H }))

  const buildOptions = { signs, facadeVariants: facadeMaterials.length }
  const facadeBatches = facadeMaterials.map((material) => new ChunkBatch(material))
  const plainBatch = new ChunkBatch(plainMaterial)
  const bulbBatch = new ChunkBatch(bulbMaterial)
  const signBatch = new ChunkBatch(signs.material)
  for (const batch of [...facadeBatches, plainBatch, bulbBatch, signBatch]) group.add(batch.mesh)

  // Adds a chunk's geometry to the batches; returns its pieces there
  // ({ batch, id, detail }, detail being the small structure).
  function addToBatches({ facades, plain, bulbs, signs: signGeometry }) {
    const pieces = []
    const add = (geometry, batch, detail = false) => {
      if (!geometry) return
      pieces.push({ batch, id: batch.add(geometry), detail })
      geometry.dispose()
    }
    facades.forEach((geometry, i) => add(geometry, facadeBatches[i]))
    add(plain, plainBatch, true)
    add(bulbs, bulbBatch)
    add(signGeometry, signBatch)
    return pieces
  }
  const disposeGeometries = ({ facades, plain, bulbs, signs: signGeometry }) => {
    for (const geometry of [...facades, plain, bulbs, signGeometry]) geometry?.dispose()
  }

  // Finished chunks from the worker, waiting to be added to the scene.
  const arrived = []
  const inFlight = new Set()
  let chunkWorker = null
  if (worker && typeof Worker !== 'undefined') {
    try {
      chunkWorker = new Worker(new URL('./chunkWorker.js', import.meta.url), { type: 'module' })
      chunkWorker.postMessage({
        type: 'init',
        seed,
        stamps: [STAMP],
        facadeVariants: facadeMaterials.length,
        signRects: { horizontal: signs.atlas.horizontal, vertical: signs.atlas.vertical },
      })
      chunkWorker.onmessage = ({ data }) => {
        inFlight.delete(data.key)
        arrived.push(data)
      }
    } catch (error) {
      console.warn('Chunk worker unavailable, building on the main thread', error)
      chunkWorker = null
    }
  }
  const chunksByKey = new Map(plan.chunks.map((chunk) => [chunk.key, chunk]))

  const built = new Map() // chunk key -> its pieces in the batches
  const visible = new Set() // keys of chunks being drawn
  const last = new THREE.Vector3()
  const velocity = new THREE.Vector3()
  const step = new THREE.Vector3()
  let started = false
  const stats = { built: 0, drawn: 0, waiting: 0, buildMs: 0, worker: !!chunkWorker }

  // Shows the chunk's pieces by distance: all of them out to DRAW_RADIUS, bar
  // the small structure beyond DETAIL_RADIUS.
  const showByDistance = (key, pieces, near) => {
    for (const { batch, id, detail } of pieces) batch.setVisible(id, near < (detail ? DETAIL_RADIUS : DRAW_RADIUS))
    if (near < DRAW_RADIUS) visible.add(key)
    else visible.delete(key)
  }
  const attach = (chunk, geometries, near) => {
    const pieces = addToBatches(geometries)
    built.set(chunk.key, pieces)
    showByDistance(chunk.key, pieces, near)
  }
  const buildHere = (chunk, near) => {
    const t = performance.now()
    attach(chunk, buildChunkGeometry(plan, chunk, buildOptions), near)
    stats.buildMs = performance.now() - t
  }

  // Asphalt; made wet (puddles and reflections) by createWetness
  const { bounds } = plan
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry((bounds.x1 - bounds.x0) * 2, (bounds.z1 - bounds.z0) * 2),
    new THREE.MeshStandardMaterial({ color: 0x1a1d1f, roughness: 0.95, metalness: 0 }),
  )
  ground.rotation.x = -Math.PI / 2
  group.add(ground)

  // The elevated roads are built whole: they're seen from all over the city.
  const skyways = createSkywayGeometry(plan)
  const markerMaterial = new THREE.MeshBasicMaterial({ color: HIGHWAY_MARKER })
  const markingMaterial = new THREE.MeshBasicMaterial({ color: LANE_MARKING })
  group.add(
    new THREE.Mesh(skyways.structure, plainMaterial),
    new THREE.Mesh(skyways.bulbs, bulbMaterial),
    new THREE.Mesh(skyways.markers, markerMaterial),
    new THREE.Mesh(skyways.markings, markingMaterial),
  )

  return {
    group,
    plan,
    wetSurfaces: [{ mesh: ground, puddles: true }],
    rooftops,
    // Shared by every chunk, built yet or not (for applyPS1's add()).
    materials: [...facadeMaterials, signs.material, plainMaterial, bulbMaterial],
    // Loads, shows, hides and frees chunks around the camera. `budget` is the
    // milliseconds to spend building on the main thread this frame (Infinity on
    // the first frame, so the opening view is complete).
    stream(position, delta, budget = chunkWorker ? 0 : BUILD_BUDGET) {
      // Where the camera's heading, from how it's been moving (cuts reset it).
      if (!started || last.distanceTo(position) > CUT_DISTANCE) velocity.set(0, 0, 0)
      else if (delta > 0) velocity.lerp(step.subVectors(position, last).divideScalar(delta), 1 - Math.exp(-3 * delta))
      started = true
      last.copy(position)
      const aheadX = position.x + velocity.x * LOOK_AHEAD
      const aheadZ = position.z + velocity.z * LOOK_AHEAD

      const wanted = []
      for (const chunk of plan.chunks) {
        const near = distanceTo(chunk.bounds, position.x, position.z)
        const distance = Math.min(near, distanceTo(chunk.bounds, aheadX, aheadZ))
        const pieces = built.get(chunk.key)
        if (pieces) {
          if (near > UNLOAD_RADIUS) {
            for (const { batch, id } of pieces) batch.remove(id)
            built.delete(chunk.key)
            visible.delete(chunk.key)
            continue
          }
          showByDistance(chunk.key, pieces, near)
        } else if (distance < LOAD_RADIUS) {
          wanted.push({ chunk, distance, near })
        }
      }

      // Chunks back from the worker, unless they've been built here meanwhile
      // or the camera's already left them behind.
      let attached = 0
      while (arrived.length && attached < MAX_ATTACH) {
        const { key, geometry } = arrived.shift()
        const chunk = chunksByKey.get(key)
        const near = distanceTo(chunk.bounds, position.x, position.z)
        const geometries = fromTransfer(geometry)
        if (built.has(key) || near > UNLOAD_RADIUS) {
          disposeGeometries(geometries)
          continue
        }
        attach(chunk, geometries, near)
        attached++
      }

      // Nearest first: urgent ones here and now, the rest to the worker (or
      // here, within the time budget, without one).
      wanted.sort((a, b) => a.distance - b.distance)
      const start = performance.now()
      let waiting = 0
      for (const { chunk, near } of wanted) {
        if (built.has(chunk.key)) continue
        if (near <= URGENT_RADIUS || performance.now() - start < budget) {
          buildHere(chunk, near)
        } else {
          waiting++
          if (chunkWorker && !inFlight.has(chunk.key) && inFlight.size < MAX_IN_FLIGHT) {
            inFlight.add(chunk.key)
            chunkWorker.postMessage({ type: 'build', key: chunk.key })
          }
        }
      }
      stats.built = built.size
      stats.drawn = visible.size
      stats.waiting = waiting
    },
    // For the map: each chunk's bounds and whether it's built and drawn.
    chunkStates() {
      return plan.chunks.map(({ key, bounds }) => ({ bounds, built: built.has(key), drawn: visible.has(key) }))
    },
    stats,
    dispose() {
      chunkWorker?.terminate()
    },
    update(elapsed) {
      signs.update(elapsed)
    },
  }
}
