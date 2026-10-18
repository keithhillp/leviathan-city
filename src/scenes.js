import ThreeScene from './components/ThreeScene.vue'
import SpaceportScene from './components/SpaceportScene.vue'

// Scenes the viewer can switch between (N, or the switcher). Each one is a
// component that builds its own renderer and world, and gets the shared music
// player as `player`.
export const SCENES = [
  { id: 'city', name: 'CITY', component: ThreeScene },
  { id: 'spaceport', name: 'SPACEPORT', component: SpaceportScene },
]
