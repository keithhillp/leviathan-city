import * as THREE from 'three'

const FEEDS = 2 // troopers shown on the side screens
const SIZE = [256, 144] // low-res, like a real helmet cam
const FOV = 70

// Live helmet cams on the side screens during street incidents. Each frame
// one feed is re-rendered (so each runs at half the frame rate), and every
// feed screen shows one of them, alternating, while that trooper is out.
export function createHelmetFeeds({ renderer, scene, incident, screens }) {
  const feeds = Array.from({ length: FEEDS }, () => ({
    target: new THREE.WebGLRenderTarget(...SIZE),
    camera: new THREE.PerspectiveCamera(FOV, SIZE[0] / SIZE[1], 0.1, 600),
    live: false,
  }))
  let frame = 0

  return {
    update() {
      const index = frame++ % FEEDS
      const feed = feeds[index]
      feed.live = incident.viewpoint(index, feed.camera.position, feed.camera.quaternion)
      if (feed.live) {
        // A screen can't show a feed while it's being drawn into (it would read
        // and write the same texture), so screens show their own content meanwhile.
        for (const screen of screens) screen.setFeed(null)
        const previous = renderer.getRenderTarget()
        renderer.setRenderTarget(feed.target)
        renderer.render(scene, feed.camera)
        renderer.setRenderTarget(previous)
      }
      screens.forEach((screen, i) => {
        const { live, target } = feeds[i % FEEDS]
        screen.setFeed(live ? target.texture : null)
      })
    },
    dispose() {
      for (const { target } of feeds) target.dispose()
    },
  }
}
