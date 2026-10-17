import * as THREE from 'three'
import billboards from '../content/billboards.json'

// Content draws into a persistent canvas:
//   draw(ctx, w, h, delta, elapsed, analysis) -> true if the canvas changed
// and exposes `glow`, the colour it throws onto the street.

const FONT = '"Noto Sans CJK JP", "Noto Sans", "Noto Sans Arabic", "Noto Sans Devanagari", "Noto Sans Thai", sans-serif'

// Faded, dirty colourways: [background, shadow].
const COLOURWAYS = [
  ['#6f2a1e', '#1a1210'], // rust
  ['#2c4a45', '#0c1414'], // teal
  ['#55552a', '#121208'], // olive
  ['#4a1f2e', '#100a0c'], // wine
  ['#3a4048', '#0b0d10'], // steel
  ['#7a5a1e', '#151008'], // mustard
]
const INK = '#d9d2c0'

const AD_CARDS = billboards.adverts
const AD_MIN_SECONDS = 9
const AD_MAX_SECONDS = 15
const FADE_SECONDS = 0.8

function fitFont(ctx, text, size, maxWidth, weight = 'bold') {
  ctx.font = `${weight} ${size}px ${FONT}`
  const fit = maxWidth / ctx.measureText(text).width
  if (fit < 1) ctx.font = `${weight} ${size * fit}px ${FONT}`
}

function drawCard(ctx, w, h, card, [bg, shadow], code) {
  const gradient = ctx.createLinearGradient(0, 0, 0, h)
  gradient.addColorStop(0, bg)
  gradient.addColorStop(1, shadow)
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, w, h)

  ctx.strokeStyle = 'rgba(217, 210, 192, 0.35)'
  ctx.lineWidth = Math.max(2, h * 0.012)
  const inset = Math.min(w, h) * 0.06
  ctx.strokeRect(inset, inset, w - inset * 2, h - inset * 2)

  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = INK
  fitFont(ctx, card.text, Math.min(h * 0.36, w * 0.28), w * 0.8)
  ctx.fillText(card.text, w / 2, h * 0.44)
  ctx.fillStyle = 'rgba(217, 210, 192, 0.7)'
  fitFont(ctx, card.sub, h * 0.08, w * 0.75, '600')
  ctx.fillText(card.sub, w / 2, h * 0.7)

  ctx.textAlign = 'right'
  ctx.fillStyle = 'rgba(217, 210, 192, 0.4)'
  ctx.font = `${h * 0.045}px monospace`
  ctx.fillText(code, w - inset * 1.4, h - inset * 1.6)
}

// Slowly rotating adverts and notices with a short crossfade.
export class AdsContent {
  constructor(ctx, w, h) {
    this.glow = new THREE.Color()
    this.current = document.createElement('canvas')
    this.next = document.createElement('canvas')
    for (const canvas of [this.current, this.next]) {
      canvas.width = w
      canvas.height = h
    }
    this.card = null
    this.render(this.current)
    this.timer = this.hold()
    this.fade = -1 // < 0 when not fading
    this.dirty = true
  }

  hold() {
    return AD_MIN_SECONDS + Math.random() * (AD_MAX_SECONDS - AD_MIN_SECONDS)
  }

  render(canvas) {
    let card
    do card = AD_CARDS[Math.floor(Math.random() * AD_CARDS.length)]
    while (card === this.card && AD_CARDS.length > 1)
    this.card = card ?? { text: '', sub: '' }
    const colourway = COLOURWAYS[Math.floor(Math.random() * COLOURWAYS.length)]
    const code = `NO.${String(Math.floor(Math.random() * 900) + 100)}`
    drawCard(canvas.getContext('2d'), canvas.width, canvas.height, this.card, colourway, code)
    this.glow.set(colourway[0])
  }

  draw(ctx, w, h, delta) {
    if (this.fade < 0) {
      this.timer -= delta
      if (this.timer <= 0) {
        this.render(this.next)
        this.fade = 0
      }
    }
    if (this.fade >= 0) {
      this.fade = Math.min(1, this.fade + delta / FADE_SECONDS)
      ctx.globalAlpha = 1
      ctx.drawImage(this.current, 0, 0)
      ctx.globalAlpha = this.fade
      ctx.drawImage(this.next, 0, 0)
      ctx.globalAlpha = 1
      if (this.fade === 1) {
        ;[this.current, this.next] = [this.next, this.current]
        this.fade = -1
        this.timer = this.hold()
      }
      return true
    }
    if (this.dirty) {
      this.dirty = false
      ctx.drawImage(this.current, 0, 0)
      return true
    }
    return false
  }
}

const TICKER_TEXT = billboards.ticker.map((item) => `${item}  ◆  `).join('')
const TICKER_SPEED = 0.06 // screen widths per second

// Dim LED news crawl at a steady speed.
export class TickerContent {
  constructor(ctx, w, h, color = '#b07d2a') {
    this.color = color
    this.glow = new THREE.Color(color)
    this.offset = 0
  }

  draw(ctx, w, h, delta) {
    ctx.fillStyle = '#050403'
    ctx.fillRect(0, 0, w, h)
    ctx.font = `bold ${h * 0.6}px ${FONT}`
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'left'
    const textW = ctx.measureText(TICKER_TEXT).width
    if (!textW) return true
    this.offset = (this.offset + delta * w * TICKER_SPEED) % textW
    ctx.fillStyle = this.color
    for (let x = -this.offset; x < w; x += textW) ctx.fillText(TICKER_TEXT, x, h * 0.54)
    return true
  }
}

// A switched-off panel: near black with a faint pattern of stuck pixels.
export class DeadContent {
  constructor() {
    this.glow = new THREE.Color(0, 0, 0)
    this.drawn = false
  }

  draw(ctx, w, h) {
    if (this.drawn) return false
    this.drawn = true
    ctx.fillStyle = '#060606'
    ctx.fillRect(0, 0, w, h)
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = ['#401010', '#103010', '#101040'][i % 3]
      ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2)
    }
    return true
  }
}
