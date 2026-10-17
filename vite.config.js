import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import { musicLibrary } from './vite-plugins/musicLibrary.js'
import { youtubeAudio } from './vite-plugins/youtubeAudio.js'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), musicLibrary({ dir: 'public/music' }), youtubeAudio()],
})
