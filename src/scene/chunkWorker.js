import { createPlan } from './plan.js'
import { SignLayout } from './signs.js'
import { buildChunkGeometry, toTransfer } from './chunkBuilder.js'

// Builds city chunks off the main thread. It works out its own copy of the
// plan from the same settings (the plan is deterministic, so it matches the
// main thread's), then answers { key } requests with that chunk's geometry.
let plan, chunks, options

self.onmessage = ({ data }) => {
  if (data.type === 'init') {
    const { seed, stamps, facadeVariants, signRects } = data
    plan = createPlan({ seed, facadeVariants, stamps })
    chunks = new Map(plan.chunks.map((chunk) => [chunk.key, chunk]))
    options = { signs: new SignLayout(signRects), facadeVariants }
  } else if (data.type === 'build') {
    const geometries = buildChunkGeometry(plan, chunks.get(data.key), options)
    const { data: geometry, transfer } = toTransfer(geometries)
    self.postMessage({ key: data.key, geometry }, transfer)
  }
}
