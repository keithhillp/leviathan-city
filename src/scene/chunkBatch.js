import * as THREE from 'three'

const START_INSTANCES = 64
const START_VERTICES = 65536
// After reclaiming space, at least this share of the buffers should be free;
// otherwise they're grown too, so reclaiming (a re-upload) stays rare.
const HEADROOM = 0.5

// One BatchedMesh holding a piece of geometry from every loaded chunk that uses
// this material: a single draw call however many chunks are loaded, with each
// piece still frustum culled on its own. Pieces come and go as chunks stream;
// the space they leave is reclaimed (and the buffers grown) only when an
// addition doesn't fit, since both mean re-uploading.
export class ChunkBatch {
  constructor(material) {
    this.mesh = new THREE.BatchedMesh(START_INSTANCES, START_VERTICES, START_VERTICES * 2, material)
    // Its overall bounds would go stale as chunks come and go; the pieces are
    // culled individually instead.
    this.mesh.frustumCulled = false
    this.geometries = new Map() // instance id -> geometry id
  }

  // Copies `geometry` into the batch; returns the id to show, hide or remove it by.
  add(geometry) {
    const mesh = this.mesh
    let geometryId
    try {
      geometryId = mesh.addGeometry(geometry)
    } catch {
      mesh.optimize() // close the gaps left by removed pieces
      const usage = this.usage()
      const vertices = usage.vertexCount + geometry.attributes.position.count
      const indices = usage.indexCount + (geometry.index ? geometry.index.count : 0)
      if (vertices > mesh._maxVertexCount * (1 - HEADROOM) || indices > mesh._maxIndexCount * (1 - HEADROOM)) {
        mesh.setGeometrySize(
          Math.ceil(Math.max(mesh._maxVertexCount, vertices / (1 - HEADROOM))),
          Math.ceil(Math.max(mesh._maxIndexCount, indices / (1 - HEADROOM))),
        )
      }
      geometryId = mesh.addGeometry(geometry)
    }
    let instanceId
    try {
      instanceId = mesh.addInstance(geometryId)
    } catch {
      mesh.setInstanceCount(mesh.maxInstanceCount * 2)
      instanceId = mesh.addInstance(geometryId)
    }
    this.geometries.set(instanceId, geometryId)
    return instanceId
  }

  remove(id) {
    this.mesh.deleteGeometry(this.geometries.get(id)) // and its instance
    this.geometries.delete(id)
  }

  setVisible(id, visible) {
    if (this.mesh.getVisibleAt(id) !== visible) this.mesh.setVisibleAt(id, visible)
  }

  // Space taken by the pieces still in the batch.
  usage() {
    let vertexCount = 0
    let indexCount = 0
    const range = {}
    for (const geometryId of this.geometries.values()) {
      this.mesh.getGeometryRangeAt(geometryId, range)
      vertexCount += range.vertexCount
      indexCount += Math.max(range.indexCount, 0)
    }
    return { vertexCount, indexCount }
  }
}
