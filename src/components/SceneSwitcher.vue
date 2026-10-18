<script setup>
const props = defineProps({
  scenes: { type: Array, required: true },
})
const index = defineModel({ type: Number, required: true })

function step(direction) {
  const count = props.scenes.length
  index.value = (index.value + direction + count) % count
}
</script>

<template>
  <div class="switcher">
    <div class="label">SCENE · N to switch</div>
    <div class="row">
      <button title="Previous scene" @click="step(-1)">◀</button>
      <span>{{ scenes[index].name }}</span>
      <button title="Next scene (N)" @click="step(1)">▶</button>
    </div>
  </div>
</template>

<style scoped>
.switcher {
  position: fixed;
  right: 16px;
  bottom: 16px;
  max-width: calc(100vw - 32px);
  padding: 8px 12px;
  background: rgba(10, 14, 16, 0.72);
  border: 1px solid rgba(255, 176, 0, 0.35);
  color: #ffd27a;
  font: 16px/1.4 var(--ui-font);
  backdrop-filter: blur(4px);
}
.label {
  font-size: 8px;
  letter-spacing: 0.2em;
  color: #ffb000;
  opacity: 0.7;
}
.row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
}
span {
  flex: 1;
  text-align: center;
}
button {
  background: rgba(255, 176, 0, 0.1);
  border: 1px solid rgba(255, 176, 0, 0.5);
  color: #ffb000;
  font: inherit;
  padding: 0 8px;
  cursor: pointer;
}
button:hover {
  background: rgba(255, 176, 0, 0.25);
}
</style>
