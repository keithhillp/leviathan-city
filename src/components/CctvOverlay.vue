<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

const props = defineProps({
  cameras: { type: Array, required: true },
})
const index = defineModel({ type: Number, required: true })
defineEmits(['incident'])

const now = ref(new Date())
let clock
onMounted(() => (clock = setInterval(() => (now.value = new Date()), 1000)))
onBeforeUnmount(() => clearInterval(clock))

const pad = (n) => String(n).padStart(2, '0')
const stamp = computed(() => {
  const d = now.value
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
})

function step(direction) {
  const count = props.cameras.length
  index.value = (index.value + direction + count) % count
}
</script>

<template>
  <div class="cctv">
    <div><span class="rec">●</span> REC {{ stamp }}</div>
    <div class="camera">
      <button title="Previous camera (C cycles, 1–9 jump)" @click="step(-1)">◀</button>
      <span>CAM {{ pad(index + 1) }} · {{ cameras[index].name }}</span>
      <button title="Next camera (C cycles, 1–9 jump)" @click="step(1)">▶</button>
    </div>
    <button class="incident" title="Trigger a street incident (I)" @click="$emit('incident')">⚠ Incident</button>
  </div>
  <!-- Keyed on the camera so the static burst replays on every switch. -->
  <div :key="index" class="static"></div>
</template>

<style scoped>
.cctv {
  position: fixed;
  top: 16px;
  left: 16px;
  max-width: calc(100vw - 32px);
  color: #e8ece8;
  font: 16px/1.6 var(--ui-font);
  letter-spacing: 0.06em;
  text-shadow: 0 0 4px rgba(0, 0, 0, 0.9);
}
.incident {
  margin-top: 6px;
  color: #ff5040;
  border-color: rgba(255, 80, 64, 0.6);
}
.rec {
  color: #ff3030;
  animation: blink 1s steps(1) infinite;
}
.camera {
  display: flex;
  align-items: center;
  gap: 8px;
}
button {
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid rgba(232, 236, 232, 0.4);
  color: inherit;
  font: inherit;
  padding: 0 8px;
  cursor: pointer;
}
button:hover {
  background: rgba(232, 236, 232, 0.15);
}
.static {
  position: fixed;
  inset: 0;
  pointer-events: none;
  background: repeating-linear-gradient(
    0deg,
    rgba(255, 255, 255, 0.18) 0 2px,
    rgba(0, 0, 0, 0.6) 2px 5px
  );
  animation: static 0.35s steps(6) forwards;
}
@keyframes blink {
  50% {
    opacity: 0;
  }
}
@keyframes static {
  0% {
    opacity: 1;
    background-position: 0 0;
  }
  100% {
    opacity: 0;
    background-position: 0 40px;
  }
}
</style>
