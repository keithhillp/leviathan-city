import * as THREE from 'three'
import { createSpace } from './space.js'
import { createPort } from './port.js'
import { createShipping } from './shipping.js'
import { createVehicles } from './vehicles.js'
import { createCranes } from './cranes.js'

// Cameras for the spaceport, like the city's CCTV set; the first is the default.
// Find new ones with the free camera (F) and paste its coordinates here.
export const CAMERAS = [
  {
    name: 'FIELD APPROACH',
    position: new THREE.Vector3(-10.74, 7.89, 232.7),
    target: new THREE.Vector3(-2.94, 16.08, 206.84),
  },
  {
    name: 'TOWER CAB',
    position: new THREE.Vector3(-58, 51.5, -44),
    target: new THREE.Vector3(20, 0, 60),
  },
  {
    name: 'PAD 05',
    position: new THREE.Vector3(38, 2.5, 172),
    target: new THREE.Vector3(0, 8, 128),
  },
  {
    name: 'SKYWATCH',
    position: new THREE.Vector3(0, 3, 60),
    target: new THREE.Vector3(-30, 510, -940),
    fov: 70,
  },
  {
    name: 'HANGAR ROW',
    position: new THREE.Vector3(-110, 5, 40),
    target: new THREE.Vector3(-190, 8, -20),
  },
  {
    name: 'FIELD OVERVIEW',
    position: new THREE.Vector3(260, 140, 320),
    target: new THREE.Vector3(0, 0, 0),
  },
  // Behind whichever ship is coming in to land.
  { name: 'CHASE CAM', follow: 'ship', fov: 60 },
]

export function createSpaceport() {
  const group = new THREE.Group()
  const space = createSpace()
  const port = createPort()
  const shipping = createShipping({ pads: port.pads })
  const vehicles = createVehicles()
  const cranes = createCranes()
  group.add(space.group, space.sky, port.group, shipping.group, vehicles.group, cranes.group)
  // Faint fill from the sky so the shadow sides aren't pure black.
  group.add(new THREE.HemisphereLight(0x5a6a8a, 0x2a2622, 0.35))

  return {
    group,
    setPixelScale: space.setPixelScale,
    warp: shipping.warp,
    viewpoint: shipping.viewpoint,
    update(delta, elapsed, analysis, camera) {
      space.update(delta, elapsed, analysis, camera)
      port.update(delta, elapsed, analysis)
      shipping.update(delta, elapsed, analysis)
      vehicles.update(delta, elapsed)
      cranes.update(elapsed)
    },
  }
}
