<script setup>
import ThreeScene from './components/ThreeScene.vue'
import PlayerControls from './components/PlayerControls.vue'
import { useAudioPlayer } from './composables/useAudioPlayer.js'
import { loadTracks } from './tracks.js'

const player = useAudioPlayer(loadTracks)
</script>

<template>
  <ThreeScene :player="player" />
  <PlayerControls :player="player" />
</template>
