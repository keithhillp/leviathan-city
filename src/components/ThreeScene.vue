<script setup>
import { markRaw, onMounted, onBeforeUnmount, ref, shallowRef, useTemplateRef, watch } from 'vue'
import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { createCity } from '../scene/city.js'
import { createLeviathan } from '../scene/leviathan.js'
import { BRIDGE, CAMERAS, INCIDENT, PATROL, createSquare } from '../scene/square.js'
import { createTraffic } from '../scene/traffic.js'
import { createTrain } from '../scene/train.js'
import { createSky } from '../scene/sky.js'
import { createWetness } from '../scene/wetness.js'
import { createEyebots } from '../scene/eyebots.js'
import { createFires } from '../scene/fires.js'
import { createIncident } from '../scene/incident.js'
import { createHelmetFeeds } from '../scene/helmetFeeds.js'
import { createHelicopter } from '../scene/helicopter.js'
import { createAirTraffic } from '../scene/airTraffic.js'
import { createRain } from '../scene/rain.js'
import { AudioField } from '../scene/audioField.js'
import { AudioAnalysis } from '../scene/analysis.js'
import { createPatterns } from '../scene/patterns.js'
import { createPalette } from '../scene/colours.js'
import { PIXEL_HEIGHT, applyPS1, createPS1Pass } from '../scene/ps1.js'
import { createBench, createPerf } from '../scene/perf.js'
import { FlyControls } from '../scene/flyControls.js'
import { createRideCam } from '../scene/rideCam.js'
import CctvOverlay from './CctvOverlay.vue'
import CityMap from './CityMap.vue'

const props = defineProps({
  player: { type: Object, required: true },
})

const container = useTemplateRef('container')

const HAZE = 0x2e373c
const FOV = 50
const PORTRAIT_FOV = 85
const SWAY = 0.25 // a slow handheld drift so the fixed view doesn't feel frozen
const COORDS_INTERVAL = 0.1 // seconds between coordinate readout updates
const SHAKE = 0.6 // camera shake at full strength (units)
const MAX_PIXEL_RATIO = 2
// With the PS1 look on, the picture is resampled down to PIXEL_HEIGHT rows, so
// the scene (and bloom) only needs rendering at a couple of times that, not at
// the full screen resolution.
const PS1_RENDER_ROWS = PIXEL_HEIGHT * 2

// Which CCTV camera is live: C cycles, 1-9 jump straight to one.
const cameraIndex = ref(0)
const activeCamera = () => CAMERAS[cameraIndex.value]
const lookAhead = new THREE.Vector3()
// Set when a follow camera has nothing to show (no trooper out, no train on
// the bridge); the default view stands in.
const signalLost = ref(false)
// The vehicle the car cameras are riding, and scratch space for its pose.
let ridden = null
const ridePosition = new THREE.Vector3()
const rideQuaternion = new THREE.Quaternion()

const params = new URLSearchParams(window.location.search)
// ?seed=N builds a different city layout.
const SEED = Number.parseInt(params.get('seed') ?? '', 10) || 17
// ?noworker builds city chunks on the main thread (to compare).
const CHUNK_WORKER = !params.has('noworker')
// ?stats shows frame timings and draw counts; ?bench also cuts through every
// camera and logs frame times for each (implies ?stats).
const BENCH = params.has('bench')
const STATS = BENCH || params.has('stats')
const statsText = ref('')
const benchText = ref('')

// Top-down map of the city: toggle with M, or start with ?map.
const showMap = ref(params.has('map'))
const cityPlan = shallowRef(null)
const TELEPORT_HEIGHT = 40
const viewEuler = new THREE.Euler()
const mapView = () => ({
  x: camera.position.x,
  z: camera.position.z,
  yaw: viewEuler.setFromQuaternion(camera.quaternion, 'YXZ').y,
})

// Free camera for finding new viewpoints: toggle with F, or start with ?freecam.
const freeCam = ref(params.has('freecam'))
const coords = ref('')
// Low-res, dithered PlayStation look: toggle with P.
const ps1 = ref(true)
const copied = ref(false)

// Three.js objects are kept out of Vue reactivity on purpose: proxying them
// is slow and breaks some internals.
let renderer, scene, camera, controls, rideCam, composer, resizeObserver, city, square, traffic, rain, audioField
let analysis, ps1Pass, ps1Style, train, sky, wetness, eyebots, fires, patterns, palette, incident
let helmetFeeds, helicopter, airTraffic, perf, bench, leviathan

// Resolution the scene renders at; the canvas itself stays at full resolution.
function applyRenderScale() {
  const full = Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO)
  const height = container.value.clientHeight
  composer.setPixelRatio(ps1.value && height > 0 ? Math.min(full, PS1_RENDER_ROWS / height) : full)
}

const fmt = (v) => `(${v.x.toFixed(2)}, ${v.y.toFixed(2)}, ${v.z.toFixed(2)})`

function onKeyDown(event) {
  if (event.repeat) return
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return
  const key = event.key.toLowerCase()
  if (key === 'f') freeCam.value = !freeCam.value
  if (key === 'p') ps1.value = !ps1.value
  if (key === 'm') showMap.value = !showMap.value
  if (key === 'c') cameraIndex.value = (cameraIndex.value + 1) % CAMERAS.length
  if (key === 'i') incident?.trigger() // start a street incident now
  if (key === 'h') helicopter?.trigger(camera) // call in a rooftop landing now
  if (key === 'n' && traffic) {
    ridden = traffic.follow(ridden, true, camera.position) // ride another car nearby
    rideCam.reset()
  }
  const number = Number(key)
  if (number >= 1 && number <= CAMERAS.length) cameraIndex.value = number - 1
}

// Map clicks: fly the free camera to above that spot, still facing the same way.
function teleport({ x, z }) {
  camera.position.set(x, TELEPORT_HEIGHT, z)
  freeCam.value = true
}

async function copyCoords() {
  await navigator.clipboard.writeText(coords.value)
  copied.value = true
  setTimeout(() => (copied.value = false), 1200)
}

watch(ps1, (on) => {
  if (ps1Pass) ps1Pass.enabled = on
  ps1Style?.setEnabled(on)
  if (composer) applyRenderScale()
})

watch(freeCam, (on) => {
  if (!controls) return
  controls.enabled = on
  // Start flying from wherever the current view is.
  if (on) controls.setFrom(camera)
})

// Each camera can have its own lens; portrait screens always get a wide one.
function applyLens() {
  camera.fov = camera.aspect < 1 ? PORTRAIT_FOV : (activeCamera().fov ?? FOV)
  camera.updateProjectionMatrix()
}

// Cutting to a camera leaves the free camera.
watch(cameraIndex, () => {
  freeCam.value = false
  rideCam?.reset()
  if (camera) applyLens()
})

onMounted(() => {
  const el = container.value

  // No antialias: the scene renders into the composer's targets, so the canvas
  // only ever gets the final full-screen pass.
  renderer = new THREE.WebGLRenderer()
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO))
  renderer.setSize(el.clientWidth, el.clientHeight)
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.1
  renderer.localClippingEnabled = true // the train is clipped at the bridge ends
  el.appendChild(renderer.domElement)

  scene = new THREE.Scene()
  scene.background = new THREE.Color(HAZE)
  scene.fog = new THREE.FogExp2(HAZE, 0.006)

  // Far enough to see Leviathan's crown from the far side of the city.
  camera = new THREE.PerspectiveCamera(FOV, el.clientWidth / el.clientHeight, 0.1, 2600)
  if (activeCamera().position) {
    camera.position.copy(activeCamera().position)
    camera.lookAt(activeCamera().target)
  }

  // Overcast sky fill plus a cold, weak key light from above.
  scene.add(new THREE.HemisphereLight(0x8a9aa4, 0x1a1c1c, 0.5))
  const overcast = new THREE.DirectionalLight(0x9fb4c0, 0.5)
  overcast.position.set(-40, 100, 30)
  scene.add(overcast)

  analysis = new AudioAnalysis()
  audioField = new AudioField()
  city = createCity({
    audioField,
    seed: SEED,
    worker: CHUNK_WORKER,
    maxAnisotropy: renderer.capabilities.getMaxAnisotropy(),
  })
  city.stream(camera.position, 0, Infinity) // the opening view, complete
  scene.add(city.group)
  cityPlan.value = markRaw(city.plan)
  leviathan = createLeviathan({ audioField, radials: city.plan.skyways.radials })
  scene.add(leviathan.group)

  square = createSquare()
  audioField.origin.copy(square.heroCenter) // the street's centre line, for left/right
  patterns = createPatterns({ audioField, places: { ...square.patternPlaces, leviathan: leviathan.centre } })
  palette = createPalette({ audioField, patterns })
  scene.add(square.group)

  traffic = createTraffic({ plan: city.plan, seed: SEED })
  scene.add(traffic.group)

  train = createTrain({
    deckY: BRIDGE.deckY,
    tracks: BRIDGE.tracks.map((offset) => BRIDGE.z + offset),
    clipX: BRIDGE.span / 2,
  })
  scene.add(train.group)

  rain = createRain()
  scene.add(rain.object)

  sky = createSky(scene, { spire: leviathan.spire })
  scene.add(sky.group)

  fires = createFires()
  eyebots = createEyebots({ patrol: PATROL, fires })
  scene.add(eyebots.group, fires.group)

  incident = createIncident({ fires, traffic, eyebots, location: INCIDENT })
  scene.add(incident.group)
  helmetFeeds = createHelmetFeeds({ renderer, scene, incident, screens: square.feedScreens })

  helicopter = createHelicopter({ rooftops: city.rooftops })
  scene.add(helicopter.group)
  airTraffic = createAirTraffic()
  scene.add(airTraffic.group)

  wetness = createWetness({
    renderer,
    scene,
    surfaces: [...city.wetSurfaces, ...square.wetSurfaces],
    skip: [rain.object], // too faint to see in the reflections
  })

  // After everything is in the scene, so every material gets vertex snapping.
  ps1Style = applyPS1(scene)
  ps1Style.add(city.materials) // chunks streamed in later share these
  ps1Style.setEnabled(ps1.value)

  controls = new FlyControls(camera, renderer.domElement)
  controls.setFrom(camera)
  controls.enabled = freeCam.value
  rideCam = createRideCam()
  window.addEventListener('keydown', onKeyDown)

  composer = new EffectComposer(renderer)
  composer.addPass(new RenderPass(scene, camera))
  composer.addPass(
    new UnrealBloomPass(new THREE.Vector2(el.clientWidth, el.clientHeight), 0.5, 0.5, 0.9),
  )
  composer.addPass(new OutputPass())
  ps1Pass = createPS1Pass()
  ps1Pass.enabled = ps1.value
  composer.addPass(ps1Pass)
  applyRenderScale()

  resizeObserver = new ResizeObserver(() => {
    camera.aspect = el.clientWidth / el.clientHeight
    ps1Pass.uniforms.aspect.value = camera.aspect
    ps1Style.setAspect(camera.aspect)
    applyLens()
    renderer.setSize(el.clientWidth, el.clientHeight)
    composer.setSize(el.clientWidth, el.clientHeight)
    applyRenderScale()
  })
  resizeObserver.observe(el)

  if (STATS) {
    perf = createPerf(renderer)
    const { stats } = city
    perf.extra = () =>
      `CHUNKS ${String(stats.built).padStart(4)} BUILT ${String(stats.drawn).padStart(3)} DRAWN ${String(stats.waiting).padStart(3)} WAIT\n` +
      `CHUNK BUILD ${stats.buildMs.toFixed(1).padStart(5)} MS (LAST HERE) · ${stats.worker ? 'WORKER' : 'NO WORKER'}`
  }
  if (BENCH) bench = createBench(CAMERAS, (index) => (cameraIndex.value = index))

  const timer = new THREE.Timer()
  let sinceCoords = COORDS_INTERVAL
  renderer.setAnimationLoop((timestamp) => {
    perf?.begin()
    timer.update(timestamp)
    const frameTime = timer.getDelta()
    const delta = Math.min(frameTime, 0.1)
    const elapsed = timer.getElapsed()
    const frame = props.player.sample()
    analysis.update(delta, frame)
    perf?.mark('analysis')
    square.update(analysis, delta, elapsed, incident.attacking)
    patterns.update(delta, analysis, frame.title)
    palette.update(delta, analysis, frame.title)
    audioField.update(delta, analysis, frame.playing)
    city.update(elapsed)
    leviathan.update(delta, elapsed)
    perf?.mark('city')
    traffic.update(delta, camera.position)
    perf?.mark('traffic')
    train.update(delta)
    sky.update(delta, analysis, camera.position)
    eyebots.update(delta, elapsed)
    fires.update(delta, elapsed)
    incident.update(delta, elapsed)
    perf?.mark('actors')
    helmetFeeds.update()
    perf?.mark('feeds')
    helicopter.update(delta, elapsed, camera)
    airTraffic.update(delta, elapsed)
    rain.update(delta, camera.position)
    perf?.mark('actors')

    const view = activeCamera()
    let live = true // false when a follow camera has nothing to show
    if (freeCam.value) {
      controls.update(delta)
      if ((sinceCoords += delta) >= COORDS_INTERVAL) {
        sinceCoords = 0
        const target = camera.getWorldDirection(lookAhead).multiplyScalar(20).add(camera.position)
        coords.value = `position: ${fmt(camera.position)}\ntarget:   ${fmt(target)}`
      }
    } else if (view.follow === 'eyebot') {
      eyebots.viewpoint(view.bot, camera.position, camera.quaternion)
    } else if (view.follow === 'trooper') {
      live = incident.viewpoint(view.trooper, camera.position, camera.quaternion)
    } else if (view.follow === 'train') {
      live = train.viewpoint(camera.position, camera.quaternion)
      if (!live) train.trigger() // keep them coming while someone's watching
    } else if (view.follow === 'car') {
      const next = traffic.follow(ridden, false, camera.position)
      if (next !== ridden) rideCam.reset()
      ridden = next
      live = ridden !== null
      if (live) {
        const size = traffic.pose(ridden, ridePosition, rideQuaternion)
        if (view.view === 'dash') rideCam.dash(camera, ridePosition, rideQuaternion, size)
        else rideCam.chase(camera, ridePosition, rideQuaternion, size, delta)
      }
    }
    if (!freeCam.value && signalLost.value === live) signalLost.value = !live
    if (!freeCam.value && (!view.follow || !live)) {
      // Fixed cameras, and the default view standing in for a follow camera
      // with nothing to show.
      const { position, target } = view.position ? view : CAMERAS[0]
      camera.position.set(
        position.x + Math.sin(elapsed * 0.13) * SWAY,
        position.y + Math.sin(elapsed * 0.21) * SWAY * 0.3,
        position.z,
      )
      camera.lookAt(target)
    }
    // Explosions shake whichever camera is live (not the free camera).
    if (incident.shake > 0 && !freeCam.value) {
      const amount = incident.shake * SHAKE
      camera.position.x += (Math.random() - 0.5) * amount
      camera.position.y += (Math.random() - 0.5) * amount
      camera.position.z += (Math.random() - 0.5) * amount
    }
    perf?.mark('camera')
    city.stream(camera.position, delta)
    perf?.mark('stream')
    wetness.update(camera)
    perf?.mark('reflection')
    composer.render()
    perf?.mark('render')
    if (perf?.end(frameTime)) statsText.value = perf.text
    const benchResult = bench?.update(frameTime)
    if (benchResult) benchText.value = benchResult
  })
})

onBeforeUnmount(() => {
  renderer.setAnimationLoop(null)
  resizeObserver.disconnect()
  window.removeEventListener('keydown', onKeyDown)
  controls.dispose()
  audioField.texture.dispose()
  city.dispose()
  wetness.dispose()
  helmetFeeds.dispose()
  scene.traverse((obj) => {
    obj.geometry?.dispose()
    for (const material of [obj.material].flat().filter(Boolean)) {
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) value.dispose()
      }
      material.dispose()
    }
  })
  composer.dispose()
  renderer.dispose()
  renderer.domElement.remove()
})
</script>

<template>
  <div ref="container" class="scene"></div>
  <CctvOverlay v-model="cameraIndex" :cameras="CAMERAS" @incident="incident?.trigger()" />
  <div v-if="CAMERAS[cameraIndex].follow && !freeCam && !signalLost" class="reticle"></div>
  <div v-if="signalLost && !freeCam" class="no-signal">
    NO SIGNAL<br />{{ CAMERAS[cameraIndex].offline ?? 'CAMERA OFFLINE' }}
  </div>
  <CityMap
    v-if="showMap && cityPlan"
    :plan="cityPlan"
    :view="mapView"
    :chunks="() => city.chunkStates()"
    :vehicles="() => traffic.positions"
    @teleport="teleport"
  />
  <pre v-if="STATS" class="stats">{{ statsText }}<template v-if="benchText">

BENCH                  P50   P95 WORST
{{ benchText }}</template><template v-else-if="BENCH">

BENCH RUNNING · CAM {{ cameraIndex + 1 }}/{{ CAMERAS.length }}</template></pre>
  <div v-if="freeCam" class="coords">
    <div class="label">FREE CAM · F to exit · WASD move · Q/E down/up · drag look · shift fast · scroll speed</div>
    <pre>{{ coords }}</pre>
    <button @click="copyCoords">{{ copied ? 'Copied' : 'Copy' }}</button>
  </div>
</template>

<style scoped>
.scene {
  width: 100%;
  height: 100%;
}
.no-signal {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  padding: 16px 24px;
  background: rgba(0, 0, 0, 0.7);
  border: 1px solid rgba(232, 236, 232, 0.4);
  color: #e8ece8;
  font: 16px/1.6 var(--ui-font);
  text-align: center;
  pointer-events: none;
}
.reticle {
  position: fixed;
  top: 50%;
  left: 50%;
  width: 64px;
  height: 64px;
  transform: translate(-50%, -50%);
  pointer-events: none;
  /* Corner brackets only. */
  background:
    linear-gradient(#ff4030, #ff4030) top left / 14px 2px,
    linear-gradient(#ff4030, #ff4030) top left / 2px 14px,
    linear-gradient(#ff4030, #ff4030) top right / 14px 2px,
    linear-gradient(#ff4030, #ff4030) top right / 2px 14px,
    linear-gradient(#ff4030, #ff4030) bottom left / 14px 2px,
    linear-gradient(#ff4030, #ff4030) bottom left / 2px 14px,
    linear-gradient(#ff4030, #ff4030) bottom right / 14px 2px,
    linear-gradient(#ff4030, #ff4030) bottom right / 2px 14px;
  background-repeat: no-repeat;
  opacity: 0.8;
}
.stats {
  position: fixed;
  right: 16px;
  bottom: 16px;
  margin: 0;
  padding: 8px 10px;
  background: rgba(10, 14, 16, 0.8);
  border: 1px solid rgba(255, 176, 0, 0.35);
  color: #ffd27a;
  font: 8px/1.5 var(--ui-font);
  white-space: pre;
  pointer-events: none;
}
.coords {
  position: fixed;
  top: 16px;
  right: 16px;
  max-width: calc(100vw - 32px);
  padding: 10px 12px;
  background: rgba(10, 14, 16, 0.8);
  border: 1px solid rgba(255, 176, 0, 0.35);
  color: #ffd27a;
  font: 16px/1.4 var(--ui-font);
}
.label {
  font-size: 8px;
  letter-spacing: 0.08em;
  color: #ffb000;
  opacity: 0.75;
}
pre {
  margin: 6px 0 8px;
  font: inherit;
  white-space: pre;
}
button {
  background: rgba(255, 176, 0, 0.1);
  border: 1px solid rgba(255, 176, 0, 0.5);
  color: #ffb000;
  font: inherit;
  padding: 2px 10px;
  cursor: pointer;
}
</style>
