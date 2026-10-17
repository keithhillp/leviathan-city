<script setup>
defineProps({
  player: { type: Object, required: true },
})
</script>

<template>
  <div class="panel">
    <div class="title">NOW PLAYING</div>
    <div class="now">{{ player.current.value?.title ?? 'Loading…' }}</div>
    <div class="buttons">
      <button title="Previous" @click="player.previous()">⏮</button>
      <button :title="player.playing.value ? 'Pause' : 'Play'" @click="player.togglePlay()">
        {{ player.playing.value ? '⏸' : '▶' }}
      </button>
      <button title="Next" @click="player.next()">⏭</button>
    </div>
  </div>
</template>

<style scoped>
.panel {
  position: fixed;
  left: 16px;
  bottom: 16px;
  max-width: calc(100vw - 32px);
  padding: 12px 14px;
  background: rgba(10, 14, 16, 0.72);
  border: 1px solid rgba(255, 176, 0, 0.35);
  color: #ffb000;
  font: 13px/1.4 ui-monospace, monospace;
  backdrop-filter: blur(4px);
}
.title {
  font-size: 11px;
  letter-spacing: 0.2em;
  opacity: 0.7;
}
.now {
  margin: 4px 0 10px;
  color: #ffd27a;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.buttons {
  display: flex;
  gap: 6px;
}
button {
  min-width: 40px;
  background: rgba(255, 176, 0, 0.1);
  border: 1px solid rgba(255, 176, 0, 0.5);
  color: inherit;
  font: inherit;
  padding: 4px 10px;
  cursor: pointer;
}
button:hover {
  background: rgba(255, 176, 0, 0.25);
}
</style>
