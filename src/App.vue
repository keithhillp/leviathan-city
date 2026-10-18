<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import PlayerControls from './components/PlayerControls.vue'
import SceneSwitcher from './components/SceneSwitcher.vue'
import { useAudioPlayer } from './composables/useAudioPlayer.js'
import { loadTracks } from './tracks.js'
import { SCENES } from './scenes.js'

const player = useAudioPlayer(loadTracks)

// The scene is kept in the URL (?scene=spaceport) so a reload stays put.
const url = new URL(window.location.href)
const sceneIndex = ref(Math.max(0, SCENES.findIndex((scene) => scene.id === url.searchParams.get('scene'))))
watch(sceneIndex, (index) => {
  url.searchParams.set('scene', SCENES[index].id)
  history.replaceState(null, '', url)
})

function onKeyDown(event) {
  if (event.repeat) return
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return
  if (event.key.toLowerCase() === 'n') sceneIndex.value = (sceneIndex.value + 1) % SCENES.length
}
onMounted(() => window.addEventListener('keydown', onKeyDown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeyDown))
</script>

<template>
  <!-- Keyed, so switching tears the old scene down and builds the new one. -->
  <component :is="SCENES[sceneIndex].component" :key="SCENES[sceneIndex].id" :player="player" />
  <PlayerControls :player="player" />
  <SceneSwitcher v-model="sceneIndex" :scenes="SCENES" />
</template>
