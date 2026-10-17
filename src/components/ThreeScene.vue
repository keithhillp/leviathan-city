<script setup>
import { onMounted, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { createCity } from '../scene/city.js'
import { BRIDGE, CAMERAS, PATROL, ROAD, createSquare } from '../scene/square.js'
import { createTraffic } from '../scene/traffic.js'
import { createTrain } from '../scene/train.js'
import { createSky } from '../scene/sky.js'
import { createWetness } from '../scene/wetness.js'
import { createEyebots } from '../scene/eyebots.js'
import { createRain } from '../scene/rain.js'
import { AudioField } from '../scene/audioField.js'
import { AudioAnalysis } from '../scene/analysis.js'
import { applyPS1, createPS1Pass } from '../scene/ps1.js'
import CctvOverlay from './CctvOverlay.vue'

const props = defineProps({
  player: { type: Object, required: true },
})

const container = useTemplateRef('container')

const HAZE = 0x2e373c
const FOV = 50
const PORTRAIT_FOV = 85
const SWAY = 0.25 // a slow handheld drift so the fixed view doesn't feel frozen
const COORDS_INTERVAL = 0.1 // seconds between coordinate readout updates

// Which CCTV camera is live: C cycles, 1-9 jump straight to one.
const cameraIndex = ref(0)
const activeCamera = () => CAMERAS[cameraIndex.value]

// Free camera for finding new viewpoints: toggle with F, or start with ?freecam.
const freeCam = ref(new URLSearchParams(window.location.search).has('freecam'))
const coords = ref('')
// Low-res, dithered PlayStation look: toggle with P.
const ps1 = ref(true)
const copied = ref(false)

// Three.js objects are kept out of Vue reactivity on purpose: proxying them
// is slow and breaks some internals.
let renderer, scene, camera, controls, composer, resizeObserver, city, square, traffic, rain, audioField
let analysis, ps1Pass, ps1Style, train, sky, wetness, eyebots

const fmt = (v) => `(${v.x.toFixed(2)}, ${v.y.toFixed(2)}, ${v.z.toFixed(2)})`

function onKeyDown(event) {
  if (event.repeat) return
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return
  const key = event.key.toLowerCase()
  if (key === 'f') freeCam.value = !freeCam.value
  if (key === 'p') ps1.value = !ps1.value
  if (key === 'c') cameraIndex.value = (cameraIndex.value + 1) % CAMERAS.length
  const number = Number(key)
  if (number >= 1 && number <= CAMERAS.length) cameraIndex.value = number - 1
}

async function copyCoords() {
  await navigator.clipboard.writeText(coords.value)
  copied.value = true
  setTimeout(() => (copied.value = false), 1200)
}

watch(ps1, (on) => {
  if (ps1Pass) ps1Pass.enabled = on
  ps1Style?.setEnabled(on)
})

watch(freeCam, (on) => {
  if (!controls) return
  controls.enabled = on
  // Start orbiting from wherever the fixed view is looking.
  if (on) controls.target.copy(activeCamera().target)
})

// Cutting to a camera leaves the free camera.
watch(cameraIndex, () => {
  freeCam.value = false
})

onMounted(() => {
  const el = container.value

  renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(el.clientWidth, el.clientHeight)
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.1
  renderer.localClippingEnabled = true // the train is clipped at the bridge ends
  el.appendChild(renderer.domElement)

  scene = new THREE.Scene()
  scene.background = new THREE.Color(HAZE)
  scene.fog = new THREE.FogExp2(HAZE, 0.006)

  camera = new THREE.PerspectiveCamera(FOV, el.clientWidth / el.clientHeight, 0.1, 2000)
  camera.position.copy(activeCamera().position)
  camera.lookAt(activeCamera().target)

  // Overcast sky fill plus a cold, weak key light from above.
  scene.add(new THREE.HemisphereLight(0x8a9aa4, 0x1a1c1c, 0.5))
  const overcast = new THREE.DirectionalLight(0x9fb4c0, 0.5)
  overcast.position.set(-40, 100, 30)
  scene.add(overcast)

  analysis = new AudioAnalysis()
  audioField = new AudioField()
  city = createCity({ audioField, maxAnisotropy: renderer.capabilities.getMaxAnisotropy() })
  scene.add(city.group)

  square = createSquare()
  audioField.origin.copy(square.heroCenter) // pulses sweep from the tower towards the cameras
  scene.add(square.group)

  traffic = createTraffic(ROAD)
  scene.add(traffic.group)

  train = createTrain({
    deckY: BRIDGE.deckY,
    tracks: BRIDGE.tracks.map((offset) => BRIDGE.z + offset),
    clipX: BRIDGE.span / 2,
  })
  scene.add(train.group)

  rain = createRain()
  scene.add(rain.object)

  sky = createSky(scene)
  scene.add(sky.group)

  eyebots = createEyebots({ patrol: PATROL })
  scene.add(eyebots.group)

  wetness = createWetness({ renderer, scene, surfaces: [...city.wetSurfaces, ...square.wetSurfaces] })

  // After everything is in the scene, so every material gets vertex snapping.
  ps1Style = applyPS1(scene)
  ps1Style.setEnabled(ps1.value)

  controls = new OrbitControls(camera, renderer.domElement)
  controls.target.copy(activeCamera().target)
  controls.enableDamping = true
  controls.enabled = freeCam.value
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

  resizeObserver = new ResizeObserver(() => {
    camera.aspect = el.clientWidth / el.clientHeight
    ps1Pass.uniforms.aspect.value = camera.aspect
    ps1Style.setAspect(camera.aspect)
    camera.fov = camera.aspect < 1 ? PORTRAIT_FOV : FOV
    camera.updateProjectionMatrix()
    renderer.setSize(el.clientWidth, el.clientHeight)
    composer.setSize(el.clientWidth, el.clientHeight)
  })
  resizeObserver.observe(el)

  const timer = new THREE.Timer()
  let sinceCoords = COORDS_INTERVAL
  renderer.setAnimationLoop((timestamp) => {
    timer.update(timestamp)
    const delta = Math.min(timer.getDelta(), 0.1)
    const elapsed = timer.getElapsed()
    const frame = props.player.sample()
    analysis.update(delta, frame)
    square.update(analysis, delta, elapsed)
    audioField.update(delta, analysis, frame.playing)
    city.update(elapsed)
    traffic.update(delta, camera.position)
    train.update(delta)
    sky.update(delta, analysis)
    eyebots.update(delta, elapsed)
    rain.update(delta, camera.position)

    if (freeCam.value) {
      controls.update()
      if ((sinceCoords += delta) >= COORDS_INTERVAL) {
        sinceCoords = 0
        coords.value = `position: ${fmt(camera.position)}\ntarget:   ${fmt(controls.target)}`
      }
    } else {
      const { position, target } = activeCamera()
      camera.position.set(
        position.x + Math.sin(elapsed * 0.13) * SWAY,
        position.y + Math.sin(elapsed * 0.21) * SWAY * 0.3,
        position.z,
      )
      camera.lookAt(target)
    }
    wetness.update(camera)
    composer.render()
  })
})

onBeforeUnmount(() => {
  renderer.setAnimationLoop(null)
  resizeObserver.disconnect()
  window.removeEventListener('keydown', onKeyDown)
  controls.dispose()
  audioField.texture.dispose()
  wetness.dispose()
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
  <CctvOverlay v-model="cameraIndex" :cameras="CAMERAS" />
  <div v-if="freeCam" class="coords">
    <div class="label">FREE CAM · F to exit · drag rotate · right-drag pan · scroll zoom</div>
    <pre>{{ coords }}</pre>
    <button @click="copyCoords">{{ copied ? 'Copied' : 'Copy' }}</button>
  </div>
</template>

<style scoped>
.scene {
  width: 100%;
  height: 100%;
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
