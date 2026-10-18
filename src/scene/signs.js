import * as THREE from 'three'
import { BANDS } from './audioField.js'
import billboards from '../content/billboards.json'

const ATLAS_W = 2048
// Horizontal signs (4:1) are packed first, vertical ones (1:4) below them;
// the atlas grows to fit however many signs billboards.json lists.
const H_CELL = { w: 512, h: 128, cols: 4 }
const V_CELL = { w: 128, h: 512, cols: 16 }
const UV_INSET = 6 // px kept clear round each cell so mipmaps don't bleed

const HORIZONTAL_TEXT = billboards.neonSigns.horizontal
const VERTICAL_TEXT = billboards.neonSigns.vertical
const NEON = ['#ff2fd0', '#22e8ff', '#ff3b6b', '#9dff3a', '#a04bff', '#ffb000', '#ff2a2a', '#3dffc8']

const FONT = '"Noto Sans CJK JP", "Noto Sans", "Noto Sans Arabic", "Noto Sans Devanagari", "Noto Sans Thai", sans-serif'

const BRIGHTNESS = 1.6
const BROKEN_SHARE = 0.1 // signs with a failing tube that flickers

function drawPanel(ctx, x, y, w, h, color, lightbox) {
  ctx.fillStyle = '#050407'
  ctx.fillRect(x, y, w, h)
  ctx.save()
  ctx.shadowColor = color
  ctx.shadowBlur = 14
  if (lightbox) {
    ctx.globalAlpha = 0.55
    ctx.fillStyle = color
    ctx.fillRect(x + 10, y + 10, w - 20, h - 20)
    ctx.globalAlpha = 1
  }
  ctx.strokeStyle = color
  ctx.lineWidth = 4
  ctx.strokeRect(x + 10, y + 10, w - 20, h - 20)
  ctx.restore()
}

function drawGlowText(ctx, text, x, y, color, lightbox) {
  ctx.save()
  if (lightbox) {
    ctx.fillStyle = '#0a0610'
    ctx.fillText(text, x, y)
  } else {
    // Coloured halo, then a near-white core like a real neon tube.
    ctx.shadowColor = color
    ctx.shadowBlur = 22
    ctx.fillStyle = color
    ctx.fillText(text, x, y)
    ctx.shadowBlur = 6
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)'
    ctx.fillText(text, x, y)
  }
  ctx.restore()
}

function cellRect(cell, top, i, atlasH) {
  const x = (i % cell.cols) * cell.w
  const y = top + Math.floor(i / cell.cols) * cell.h
  return {
    x,
    y,
    u0: (x + UV_INSET) / ATLAS_W,
    u1: (x + cell.w - UV_INSET) / ATLAS_W,
    v0: 1 - (y + cell.h - UV_INSET) / atlasH,
    v1: 1 - (y + UV_INSET) / atlasH,
  }
}

function createAtlas(rng, maxAnisotropy) {
  const canvas = document.createElement('canvas')
  const verticalTop = Math.ceil(HORIZONTAL_TEXT.length / H_CELL.cols) * H_CELL.h
  const atlasH = Math.max(1, verticalTop + Math.ceil(VERTICAL_TEXT.length / V_CELL.cols) * V_CELL.h)
  canvas.width = ATLAS_W
  canvas.height = atlasH
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, ATLAS_W, atlasH)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  const horizontal = HORIZONTAL_TEXT.map((text, i) => {
    const rect = cellRect(H_CELL, 0, i, atlasH)
    const color = NEON[Math.floor(rng() * NEON.length)]
    const lightbox = rng() < 0.3
    drawPanel(ctx, rect.x, rect.y, H_CELL.w, H_CELL.h, color, lightbox)
    let size = H_CELL.h * 0.58
    ctx.font = `bold ${size}px ${FONT}`
    const fit = (H_CELL.w - 60) / ctx.measureText(text).width
    if (fit < 1) ctx.font = `bold ${(size *= fit)}px ${FONT}`
    drawGlowText(ctx, text, rect.x + H_CELL.w / 2, rect.y + H_CELL.h / 2 + 4, color, lightbox)
    return rect
  })

  // Vertical signs stack their characters top to bottom.
  const vertical = VERTICAL_TEXT.map((text, i) => {
    const rect = cellRect(V_CELL, verticalTop, i, atlasH)
    const color = NEON[Math.floor(rng() * NEON.length)]
    const lightbox = rng() < 0.3
    drawPanel(ctx, rect.x, rect.y, V_CELL.w, V_CELL.h, color, lightbox)
    const chars = [...text]
    const step = Math.min(V_CELL.w * 0.75, (V_CELL.h - 50) / chars.length)
    ctx.font = `bold ${step * 0.85}px ${FONT}`
    const top = rect.y + V_CELL.h / 2 - (step * (chars.length - 1)) / 2
    chars.forEach((char, j) => {
      drawGlowText(ctx, char, rect.x + V_CELL.w / 2, top + j * step, color, lightbox)
    })
    return rect
  })

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = maxAnisotropy
  return { texture, horizontal, vertical }
}

// Building faces, as seen from outside: centre offset, half length, outward
// normal angle around Y.
function faceFrame(face, x, z, w, d) {
  switch (face) {
    case '+z': return { cx: x, cz: z + d / 2, half: w / 2, angle: 0 }
    case '-z': return { cx: x, cz: z - d / 2, half: w / 2, angle: Math.PI }
    case '+x': return { cx: x + w / 2, cz: z, half: d / 2, angle: Math.PI / 2 }
    case '-x': return { cx: x - w / 2, cz: z, half: d / 2, angle: -Math.PI / 2 }
  }
}

// Places neon signs on buildings, given where each sign sits in the atlas
// (`rects`: { horizontal, vertical }). No DOM, so it also runs in the chunk
// worker.
export class SignLayout {
  constructor(rects) {
    this.atlas = rects
    this.matrix = new THREE.Matrix4()
  }

  quad(quads, w, h, rect, angle, x, y, z, sign) {
    const geometry = new THREE.PlaneGeometry(w, h)
    const uv = geometry.attributes.uv
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(
        i,
        THREE.MathUtils.lerp(rect.u0, rect.u1, uv.getX(i)),
        THREE.MathUtils.lerp(rect.v0, rect.v1, uv.getY(i)),
      )
    }
    geometry.applyMatrix4(this.matrix.makeRotationY(angle).setPosition(x, y, z))
    const data = new Float32Array(uv.count * 2)
    for (let i = 0; i < uv.count; i++) data.set(sign, i * 2)
    geometry.setAttribute('aSign', new THREE.BufferAttribute(data, 2))
    quads.push(geometry)
  }

  // Decorates one building. `faces` are the sides that front a street. Every
  // choice comes from `rng`; sign quads go into `quads` (for mesh()), and plain
  // geometry for frames and legs into `structure`.
  decorate({ x, z, w, d, height, faces }, { rng, quads, structure }, floorHeight) {
    const { horizontal, vertical } = this.atlas
    // [band 0..1, seed 0..1]; the seed picks broken, flickering signs.
    const randomSign = () => [Math.floor(rng() * BANDS) / (BANDS - 1), rng()]
    const pick = (list) => list[Math.floor(rng() * list.length)]
    for (const face of faces) {
      const { cx, cz, half, angle } = faceFrame(face, x, z, w, d)
      const nx = Math.sin(angle)
      const nz = Math.cos(angle)
      const tx = nz // along the face
      const tz = -nx

      // Flat facade signs: shopfront level or somewhere up the tower.
      const facadeCount = rng() < 0.55 ? 1 + Math.floor(rng() * 2) : 0
      for (let i = 0; i < facadeCount && half > 4 && horizontal.length; i++) {
        const sw = Math.min(half * 2 - 2, 5 + rng() * 9)
        const sh = sw / 4
        const along = (rng() - 0.5) * 2 * (half - sw / 2 - 0.5)
        const floors = Math.floor(height / floorHeight)
        const y = rng() < 0.5 ? 4.6 : (1 + Math.floor(rng() * Math.max(1, floors - 1))) * floorHeight
        if (y + sh / 2 > height) continue
        const px = cx + nx * 0.15 + tx * along
        const pz = cz + nz * 0.15 + tz * along
        this.quad(quads, sw, sh, pick(horizontal), angle, px, y, pz, randomSign())
      }

      // Vertical blade sign sticking out from the wall near a corner.
      const bw = 1.4 + rng() * 1
      const bh = bw * 4
      if (rng() < 0.3 && height > bh + 6 && half > 3 && vertical.length) {
        const along = (rng() < 0.5 ? -1 : 1) * (half - 1.5)
        const out = bw / 2 + 0.4
        const y = 4 + bh / 2 + rng() * (height - bh - 6)
        const px = cx + nx * out + tx * along
        const pz = cz + nz * out + tz * along
        const rect = pick(vertical)
        const sign = randomSign()
        // Two single-sided quads so the text reads correctly from both sides.
        this.quad(quads, bw, bh, rect, angle + Math.PI / 2, px + tx * 0.07, y, pz + tz * 0.07, sign)
        this.quad(quads, bw, bh, rect, angle - Math.PI / 2, px - tx * 0.07, y, pz - tz * 0.07, sign)
        const facesZ = Math.abs(nz) > 0.5
        structure.push(
          new THREE.BoxGeometry(facesZ ? 0.1 : bw, bh, facesZ ? bw : 0.1).translate(px, y, pz),
        )
      }
    }

    // Rooftop billboard on legs, facing one of the streets.
    if (faces.length && horizontal.length && height < 45 && rng() < 0.22) {
      const { cx, cz, half, angle } = faceFrame(pick(faces), x, z, w, d)
      const nx = Math.sin(angle)
      const nz = Math.cos(angle)
      const rw = Math.min(half * 2 - 2, 9 + rng() * 9)
      const rh = rw / 4
      const lift = 1.2 + rng() * 1.5
      const y = height + lift + rh / 2
      const px = cx - nx * 1.2
      const pz = cz - nz * 1.2
      this.quad(quads, rw, rh, pick(horizontal), angle, px, y, pz, randomSign())

      const facesZ = Math.abs(nz) > 0.5
      const back = facesZ
        ? new THREE.BoxGeometry(rw + 0.4, rh + 0.4, 0.3)
        : new THREE.BoxGeometry(0.3, rh + 0.4, rw + 0.4)
      structure.push(back.translate(px - nx * 0.2, y, pz - nz * 0.2))
      for (const side of [-1, 1]) {
        const off = side * rw * 0.3
        structure.push(
          new THREE.BoxGeometry(0.3, lift + rh / 2, 0.3).translate(
            px - nx * 0.4 + (facesZ ? off : 0),
            height + (lift + rh / 2) / 2,
            pz - nz * 0.4 + (facesZ ? 0 : off),
          ),
        )
      }
    }
  }

}

// Neon signs for the city's buildings: draws the atlas, and owns the one
// material every chunk's signs share.
export class SignBuilder extends SignLayout {
  // `rng` lays out the atlas (its colours and styles).
  constructor(rng, maxAnisotropy, audioField) {
    const { texture, horizontal, vertical } = createAtlas(rng, maxAnisotropy)
    super({ horizontal, vertical })
    this.time = { value: 0 }
    this.material = createMaterial(texture, audioField, this.time)
  }

  update(elapsed) {
    this.time.value = elapsed
  }
}

function createMaterial(texture, audioField, time) {
  const material = new THREE.MeshBasicMaterial({ map: texture })
  material.color.setScalar(BRIGHTNESS)
  audioField.patch(material, {
    vertexDeclarations: 'attribute vec2 aSign;\nvarying vec2 vSign;',
    vertexApply: 'vSign = aSign;',
    declarations: 'uniform float uTime;\nvarying vec2 vSign;',
    uniforms: { uTime: time },
    after: '#include <color_fragment>',
    apply: /* glsl */ `
      float signFlicker = 1.0;
      if (vSign.y > ${(1 - BROKEN_SHARE).toFixed(3)}) {
        float tick = floor(uTime * 14.0 + vSign.y * 100.0);
        signFlicker = fract(sin(tick * 12.9898 + vSign.y * 78.233) * 43758.5453) > 0.3 ? 1.0 : 0.12;
      }
      // Signs pulse more gently than windows so the text stays readable.
      diffuseColor.rgb *= signFlicker * mix(1.0, audioGain(vSign.x), 0.6);`,
  })
  return material
}
