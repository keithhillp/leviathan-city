// Frame timing and renderer counters for the ?stats overlay, and the ?bench
// run that cuts through every camera logging frame times for each.

const SUMMARY_INTERVAL = 0.5 // seconds between overlay updates
const BENCH_DWELL = 8 // seconds on each camera
const BENCH_WARMUP = 1.5 // seconds ignored after each cut (shader compiles, streaming)
// A longer gap means the tab was hidden or the window minimised (no frames are
// drawn then), not a real frame, so the camera's measurement starts over.
const BENCH_GAP = 1

const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0
const ms = (v) => v.toFixed(1).padStart(5)

// Draw calls and triangles are counted across every render in a frame (scene,
// bloom, reflections, helmet feeds), so info is reset by hand at frame start.
export function createPerf(renderer) {
  renderer.info.autoReset = false
  let frames = [] // frame intervals (ms) since the last summary
  let systems = new Map() // name -> ms spent since the last summary
  let systemCalls = new Map() // name -> draw calls in the last frame
  let calls = 0
  let triangles = 0
  let sinceSummary = 0
  let last = 0
  let lastCalls = 0
  let text = ''

  return {
    // Call at the very start of the frame.
    begin() {
      renderer.info.reset()
      last = performance.now()
      lastCalls = 0
      systemCalls = new Map()
    },
    // Charges the time and draw calls since the previous mark (or begin) to `name`.
    mark(name) {
      const now = performance.now()
      const calls = renderer.info.render.calls
      systems.set(name, (systems.get(name) ?? 0) + now - last)
      systemCalls.set(name, (systemCalls.get(name) ?? 0) + calls - lastCalls)
      last = now
      lastCalls = calls
    },
    // Call after the final render with the real (unclamped) frame interval.
    end(frameTime) {
      frames.push(frameTime * 1000)
      calls = Math.max(calls, renderer.info.render.calls)
      triangles = Math.max(triangles, renderer.info.render.triangles)
      if ((sinceSummary += frameTime) < SUMMARY_INTERVAL) return false

      const sorted = frames.toSorted((a, b) => a - b)
      const count = frames.length
      const average = frames.reduce((a, b) => a + b, 0) / count
      const ranked = [...systems].map(([name, total]) => [name, total / count]).sort((a, b) => b[1] - a[1])
      const cpu = ranked.reduce((sum, [, t]) => sum + t, 0)
      const { geometries, textures } = renderer.info.memory
      const heap = performance.memory ? `${(performance.memory.usedJSHeapSize / 1048576).toFixed(0)} MB` : 'n/a'
      text = [
        `FPS   ${(count / sinceSummary).toFixed(0).padStart(5)}`,
        `FRAME ${ms(average)} ms   P95 ${ms(percentile(sorted, 0.95))} ms`,
        `CPU   ${ms(cpu)} ms`,
        ...ranked.slice(0, 6).map(([name, t]) => {
          const drawn = systemCalls.get(name)
          return `  ${name.padEnd(10)}${ms(t)}${drawn ? `  ${String(drawn).padStart(4)} CALLS` : ''}`
        }),
        `CALLS ${String(calls).padStart(5)}   TRIS ${(triangles / 1000).toFixed(0).padStart(5)}K`,
        `GEOM  ${String(geometries).padStart(5)}   TEX  ${String(textures).padStart(5)}`,
        `PROGS ${String(renderer.info.programs?.length ?? 0).padStart(5)}   HEAP ${heap}`,
      ].join('\n')

      if (this.extra) text += `\n${this.extra()}`

      frames = []
      systems = new Map()
      calls = triangles = sinceSummary = 0
      return true
    },
    // Optional: returns more lines for the overlay.
    extra: null,
    // The latest summary, for the overlay.
    get text() {
      return text
    },
  }
}

// Cuts to each camera in turn, then logs p50/p95 frame times per camera to
// the console (and returns them as text for the overlay).
export function createBench(cameras, select) {
  const results = []
  let index = 0
  let onCamera = 0
  let samples = []
  let done = false
  select(0)

  return {
    get done() {
      return done
    },
    update(frameTime) {
      if (done) return null
      if (frameTime > BENCH_GAP) {
        samples = []
        onCamera = 0
        return null
      }
      onCamera += frameTime
      if (onCamera > BENCH_WARMUP) samples.push(frameTime * 1000)
      if (onCamera < BENCH_DWELL) return null

      const sorted = samples.toSorted((a, b) => a - b)
      results.push({
        camera: cameras[index].name,
        p50: +percentile(sorted, 0.5).toFixed(1),
        p95: +percentile(sorted, 0.95).toFixed(1),
        worst: +(sorted.at(-1) ?? 0).toFixed(1),
      })
      samples = []
      onCamera = 0
      if (++index < cameras.length) {
        select(index)
        return null
      }
      done = true
      console.table(results)
      return results
        .map((r) => `${r.camera.slice(0, 20).padEnd(20)} ${ms(r.p50)} ${ms(r.p95)} ${ms(r.worst)}`)
        .join('\n')
    },
  }
}
