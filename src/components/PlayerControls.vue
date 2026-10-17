<script setup>
import { ref } from 'vue'
import { fetchYouTubeTrack } from '../youtube.js'

const props = defineProps({
  player: { type: Object, required: true },
})

const link = ref('')
const status = ref('') // fetching message or error

async function addYouTube() {
  if (!link.value.trim() || status.value === 'Fetching audio…') return
  status.value = 'Fetching audio…'
  try {
    props.player.addTrack(await fetchYouTubeTrack(link.value))
    link.value = ''
    status.value = ''
  } catch (error) {
    status.value = error.message
  }
}
</script>

<template>
  <div class="panel">
    <div class="title">
      NOW PLAYING
      <span v-if="player.tracks.value.length > 1" class="count">
        {{ player.index.value + 1 }} / {{ player.tracks.value.length }}
      </span>
    </div>
    <div class="now">
      {{ player.current.value?.title ?? (player.loaded.value ? 'No tracks' : 'Loading…') }}
    </div>
    <div class="buttons">
      <button title="Previous" @click="player.previous()">⏮</button>
      <button :title="player.playing.value ? 'Pause' : 'Play'" @click="player.togglePlay()">
        {{ player.playing.value ? '⏸' : '▶' }}
      </button>
      <button title="Next" @click="player.next()">⏭</button>
    </div>
    <form class="youtube" @submit.prevent="addYouTube">
      <input v-model="link" type="url" placeholder="Paste YouTube link" aria-label="YouTube link" />
      <button type="submit" title="Add and play">+</button>
    </form>
    <div v-if="status" class="status">{{ status }}</div>
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
  font: 16px/1.4 var(--ui-font);
  backdrop-filter: blur(4px);
}
.title {
  font-size: 8px;
  letter-spacing: 0.2em;
  opacity: 0.7;
}
.count {
  float: right;
  margin-left: 16px;
}
.now {
  margin: 4px 0 10px;
  color: #ffd27a;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.buttons,
.youtube {
  display: flex;
  gap: 6px;
}
.youtube {
  margin-top: 8px;
}
input {
  flex: 1;
  min-width: 0;
  background: rgba(0, 0, 0, 0.4);
  border: 1px solid rgba(255, 176, 0, 0.5);
  color: #ffd27a;
  font: 8px/1 var(--ui-font);
  padding: 6px 8px;
}
input::placeholder {
  color: rgba(255, 176, 0, 0.5);
}
.status {
  margin-top: 6px;
  font-size: 8px;
  color: #ffd27a;
  max-width: 320px;
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
