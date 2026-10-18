<script setup>
import { onBeforeUnmount, onMounted, useTemplateRef } from 'vue'

// Top-down map of the city plan (plan.js) with the live camera on it. North
// (up) is -z, the way the default camera looks. Click to fly the free camera
// there.
const props = defineProps({
  plan: { type: Object, required: true },
  // Called every frame: { x, z, yaw } of the camera (yaw 0 looks along -z).
  view: { type: Function, required: true },
  // Called every frame: [{ bounds, built, drawn }] for the streamed chunks.
  chunks: { type: Function, default: () => [] },
  // Called every frame: vehicle positions, as [x, z] pairs.
  vehicles: { type: Function, default: () => [] },
})
const emit = defineEmits(['teleport'])

const canvas = useTemplateRef('canvas')
const SIZE = 480 // CSS pixels; shrinks to fit small screens
const MARGIN = 16 // world units around the plan's bounds

let ctx, base, scale, frame, ratio

// World (x, z) to canvas pixels, and back.
const toCanvas = (x, z) => [(x - props.plan.bounds.x0 + MARGIN) * scale, (z - props.plan.bounds.z0 + MARGIN) * scale]
const toWorld = (px, pz) => [px / scale + props.plan.bounds.x0 - MARGIN, pz / scale + props.plan.bounds.z0 - MARGIN]

// The plan never changes, so it's drawn once and copied in each frame.
function drawBase(width, height) {
  base = document.createElement('canvas')
  base.width = width
  base.height = height
  const c = base.getContext('2d')
  c.scale(ratio, ratio)
  const { roads, rail, blocks, lots, stamps, corridors } = props.plan // corridors.rail: the loop to come
  // A w by d box centred on (x, z), turned by `angle` (as the city turns it).
  const rect = ({ x, z, w, d, angle = 0 }) => {
    const [px, pz] = toCanvas(x, z)
    c.save()
    c.translate(px, pz)
    c.rotate(-angle)
    c.fillRect((-w / 2) * scale, (-d / 2) * scale, w * scale, d * scale)
    c.restore()
  }
  const ring = (corners) => {
    c.beginPath()
    corners.forEach(([x, z], i) => c[i ? 'lineTo' : 'moveTo'](...toCanvas(x, z)))
    c.closePath()
    c.stroke()
  }
  const line = (network, edge) => {
    const a = network.nodes[edge.a]
    const b = network.nodes[edge.b]
    c.beginPath()
    c.moveTo(...toCanvas(a.x, a.z))
    c.lineTo(...toCanvas(b.x, b.z))
    c.stroke()
  }

  c.fillStyle = 'rgba(255, 176, 0, 0.06)'
  for (const block of blocks) rect(block)
  // Lots: brighter the taller they are.
  for (const lot of lots) {
    c.fillStyle = `rgba(255, 176, 0, ${(0.12 + Math.min(lot.floors / 40, 1) * 0.55).toFixed(2)})`
    rect(lot)
  }
  // Where the rail loop will run.
  c.lineWidth = 1.5
  c.strokeStyle = 'rgba(255, 64, 48, 0.45)'
  c.setLineDash([4, 3])
  ring(corridors.rail)
  c.setLineDash([])
  c.lineCap = 'round'
  // The streets, faint (no traffic down there), then the elevated roads over
  // them, brighter the higher they are (their bends drawn straight across).
  const elevated = roads.edges.filter((edge) => edge.elevated && !edge.link)
  for (const edge of roads.edges) {
    if (edge.elevated) continue
    c.strokeStyle = 'rgba(255, 176, 0, 0.12)'
    c.lineWidth = Math.max(1, edge.width * scale * 0.4)
    line(roads, edge)
  }
  for (const edge of elevated) {
    const height = ((roads.nodes[edge.a].y ?? 0) + (roads.nodes[edge.b].y ?? 0)) / 2
    c.strokeStyle = `rgba(255, 210, 122, ${(0.35 + Math.min(height / 90, 1) * 0.5).toFixed(2)})`
    c.lineWidth = Math.max(1.5, edge.width * scale * 0.6)
    line(roads, edge)
  }
  c.strokeStyle = '#ff4030'
  c.lineWidth = 2
  c.setLineDash([4, 3])
  for (const edge of rail.edges) line(rail, edge)
  c.setLineDash([])
  c.strokeStyle = 'rgba(232, 236, 232, 0.6)'
  c.lineWidth = 1
  for (const { bounds: b } of stamps) {
    const [px, pz] = toCanvas(b.x0, b.z0)
    c.strokeRect(px, pz, (b.x1 - b.x0) * scale, (b.z1 - b.z0) * scale)
  }
}

function draw() {
  frame = requestAnimationFrame(draw)
  const { width, height } = canvas.value
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, width, height)
  ctx.drawImage(base, 0, 0)
  ctx.scale(ratio, ratio)

  // Chunks: faint outline once built, brighter while drawn.
  for (const { bounds: b, built, drawn } of props.chunks()) {
    if (!built) continue
    ctx.strokeStyle = drawn ? 'rgba(232, 236, 232, 0.45)' : 'rgba(232, 236, 232, 0.15)'
    const [px, pz] = toCanvas(b.x0, b.z0)
    ctx.strokeRect(px + 0.5, pz + 0.5, (b.x1 - b.x0) * scale - 1, (b.z1 - b.z0) * scale - 1)
  }

  // Traffic.
  const traffic = props.vehicles()
  ctx.fillStyle = 'rgba(255, 238, 200, 0.7)'
  for (let i = 0; i < traffic.length; i += 2) {
    const [px, pz] = toCanvas(traffic[i], traffic[i + 1])
    ctx.fillRect(px - 0.5, pz - 0.5, 1.2, 1.2)
  }

  // Camera: a dot with a wedge pointing the way it looks.
  const { x, z, yaw } = props.view()
  const [px, pz] = toCanvas(x, z)
  ctx.translate(px, pz)
  ctx.rotate(-yaw)
  ctx.fillStyle = 'rgba(232, 236, 232, 0.25)'
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.arc(0, 0, 28, -Math.PI / 2 - 0.45, -Math.PI / 2 + 0.45)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = '#e8ece8'
  ctx.fillRect(-2.5, -2.5, 5, 5)
}

function onClick(event) {
  const box = canvas.value.getBoundingClientRect()
  const [x, z] = toWorld(event.clientX - box.left, event.clientY - box.top)
  emit('teleport', { x, z })
}

onMounted(() => {
  const { bounds } = props.plan
  const worldW = bounds.x1 - bounds.x0 + MARGIN * 2
  const worldD = bounds.z1 - bounds.z0 + MARGIN * 2
  const size = Math.min(SIZE, window.innerWidth - 32, window.innerHeight - 96)
  scale = size / Math.max(worldW, worldD)
  ratio = window.devicePixelRatio || 1
  const el = canvas.value
  el.style.width = `${worldW * scale}px`
  el.style.height = `${worldD * scale}px`
  el.width = Math.round(worldW * scale * ratio)
  el.height = Math.round(worldD * scale * ratio)
  ctx = el.getContext('2d')
  drawBase(el.width, el.height)
  draw()
})

onBeforeUnmount(() => cancelAnimationFrame(frame))
</script>

<template>
  <div class="map">
    <div class="label">CITY MAP · M to close · click to fly there</div>
    <canvas ref="canvas" @click="onClick"></canvas>
  </div>
</template>

<style scoped>
.map {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  padding: 10px 12px 12px;
  background: rgba(10, 14, 16, 0.85);
  border: 1px solid rgba(255, 176, 0, 0.35);
}
.label {
  margin-bottom: 8px;
  font: 8px/1.4 var(--ui-font);
  letter-spacing: 0.08em;
  color: #ffb000;
  opacity: 0.75;
}
canvas {
  display: block;
  cursor: crosshair;
}
</style>
