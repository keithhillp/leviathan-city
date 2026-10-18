<script setup>
import { onMounted, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { CAMERAS, createSpaceport } from '../scene/spaceport/spaceport.js'
import { AudioAnalysis } from '../scene/analysis.js'
import { PIXEL_HEIGHT, applyPS1, createPS1Pass } from '../scene/ps1.js'
import CctvOverlay from './CctvOverlay.vue'

const props = defineProps({
  player: { type: Object, required: true },
})

const container = useTemplateRef('container')

const SPACE = 0x010208
const FOV = 50
const PORTRAIT_FOV = 85
const SWAY = 0.25
const COORDS_INTERVAL = 0.1
const MAX_PIXEL_RATIO = 2
const PS1_RENDER_ROWS = PIXEL_HEIGHT * 2
// Star points are sized for this many rendered rows and scaled from there.
const STAR_ROWS = 540
const WARP_ACTION = { label: '⚡ Warp in', title: 'Bring a ship in from warp (W)' }

const cameraIndex = ref(0)
const activeCamera = () => CAMERAS[cameraIndex.value]
const lookAhead = new THREE.Vector3()
const freeCam = ref(new URLSearchParams(window.location.search).has('freecam'))
const coords = ref('')
const ps1 = ref(true)
const copied = ref(false)

// Three.js objects are kept out of Vue reactivity on purpose.
let renderer, scene, camera, controls, composer, resizeObserver, analysis, ps1Pass, ps1Style, spaceport

function applyRenderScale() {
  const full = Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO)
  const height = container.value.clientHeight
  const ratio = ps1.value && height > 0 ? Math.min(full, PS1_RENDER_ROWS / height) : full
  composer.setPixelRatio(ratio)
  spaceport.setPixelScale(Math.max(1, (height * ratio) / STAR_ROWS))
}

const fmt = (v) => `(${v.x.toFixed(2)}, ${v.y.toFixed(2)}, ${v.z.toFixed(2)})`

function onKeyDown(event) {
  if (event.repeat) return
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return
  const key = event.key.toLowerCase()
  if (key === 'f') freeCam.value = !freeCam.value
  if (key === 'p') ps1.value = !ps1.value
  if (key === 'c') cameraIndex.value = (cameraIndex.value + 1) % CAMERAS.length
  if (key === 'w') spaceport?.warp()
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
  if (composer) applyRenderScale()
})

watch(freeCam, (on) => {
  if (!controls) return
  controls.enabled = on
  if (on) controls.target.copy(camera.getWorldDirection(lookAhead).multiplyScalar(20).add(camera.position))
})

function applyLens() {
  camera.fov = camera.aspect < 1 ? PORTRAIT_FOV : (activeCamera().fov ?? FOV)
  camera.updateProjectionMatrix()
}

watch(cameraIndex, () => {
  freeCam.value = false
  if (camera) applyLens()
})

onMounted(() => {
  const el = container.value

  renderer = new THREE.WebGLRenderer()
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO))
  renderer.setSize(el.clientWidth, el.clientHeight)
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.1
  el.appendChild(renderer.domElement)

  scene = new THREE.Scene()
  scene.background = new THREE.Color(SPACE)

  // Far enough for the planets; the sky sphere rides with the camera inside it.
  camera = new THREE.PerspectiveCamera(FOV, el.clientWidth / el.clientHeight, 1, 12000)
  camera.position.copy(CAMERAS[0].position)
  camera.lookAt(CAMERAS[0].target)

  analysis = new AudioAnalysis()
  spaceport = createSpaceport()
  scene.add(spaceport.group)

  ps1Style = applyPS1(scene)
  ps1Style.setEnabled(ps1.value)

  controls = new OrbitControls(camera, renderer.domElement)
  controls.target.copy(CAMERAS[0].target)
  controls.enableDamping = true
  controls.enabled = freeCam.value
  window.addEventListener('keydown', onKeyDown)

  composer = new EffectComposer(renderer)
  composer.addPass(new RenderPass(scene, camera))
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(el.clientWidth, el.clientHeight), 0.6, 0.5, 0.9))
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

  const timer = new THREE.Timer()
  let sinceCoords = COORDS_INTERVAL
  renderer.setAnimationLoop((timestamp) => {
    timer.update(timestamp)
    const delta = Math.min(timer.getDelta(), 0.1)
    const elapsed = timer.getElapsed()
    analysis.update(delta, props.player.sample())

    if (freeCam.value) {
      controls.update()
      if ((sinceCoords += delta) >= COORDS_INTERVAL) {
        sinceCoords = 0
        coords.value = `position: ${fmt(camera.position)}\ntarget:   ${fmt(controls.target)}`
      }
    } else if (
      !(activeCamera().follow === 'ship' && spaceport.viewpoint(camera.position, camera.quaternion, delta))
    ) {
      // Fixed cameras, and the chase cam's fallback when nothing is flying.
      const { position, target } = activeCamera().position ? activeCamera() : CAMERAS[0]
      camera.position.set(
        position.x + Math.sin(elapsed * 0.13) * SWAY,
        position.y + Math.sin(elapsed * 0.21) * SWAY * 0.3,
        position.z,
      )
      camera.lookAt(target)
    }
    // After the camera moves, so the sky stays centred on it.
    spaceport.update(delta, elapsed, analysis, camera)
    composer.render()
  })
})

onBeforeUnmount(() => {
  renderer.setAnimationLoop(null)
  resizeObserver.disconnect()
  window.removeEventListener('keydown', onKeyDown)
  controls.dispose()
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
  <CctvOverlay v-model="cameraIndex" :cameras="CAMERAS" :action="WARP_ACTION" @action="spaceport?.warp()" />
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
