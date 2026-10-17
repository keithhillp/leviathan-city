import { BARS } from './analysis.js'

// Laid out in a coordinate space 1024 wide, with the height following the
// screen's aspect ratio, then scaled to the canvas.
const WIDTH = 1024
const MARGIN = 60
const PEAK_FALL = 0.5 // fraction of full height per second
const TITLE_SIZE = 120
const TITLE_SPEED = 140 // units per second when the title scrolls
const TITLE_GAP = '     ◆     '

function formatTime(seconds) {
  const s = Math.floor(seconds)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// The hero screen: track title, spectrum bars, waveform and progress.
export class Visualiser {
  constructor() {
    this.peaks = new Float32Array(BARS)
    this.titleOffset = 0
    this.gradientFor = null // the height the bar gradient was built for
  }

  // Large track title; scrolls like a ticker when it doesn't fit.
  drawTitle(ctx, title, y, delta) {
    ctx.font = `bold ${TITLE_SIZE}px monospace`
    ctx.textBaseline = 'alphabetic'
    ctx.textAlign = 'left'
    ctx.fillStyle = '#d8e8ec'
    const space = WIDTH - MARGIN * 2
    if (ctx.measureText(title).width <= space) {
      this.titleOffset = 0
      ctx.fillText(title, MARGIN, y)
      return
    }
    const loop = `${title}${TITLE_GAP}`
    const loopW = ctx.measureText(loop).width
    this.titleOffset = (this.titleOffset + delta * TITLE_SPEED) % loopW
    ctx.save()
    ctx.beginPath()
    ctx.rect(MARGIN, y - TITLE_SIZE, space, TITLE_SIZE * 1.3)
    ctx.clip()
    for (let x = MARGIN - this.titleOffset; x < WIDTH; x += loopW) ctx.fillText(loop, x, y)
    ctx.restore()
  }

  draw(ctx, w, h, delta, elapsed, analysis) {
    const frame = analysis.frame
    const { bass } = analysis.levels
    const height = (WIDTH * h) / w
    const titleY = 90 + TITLE_SIZE
    const baseline = height - 90
    const maxBar = baseline - titleY - 80
    const waveY = titleY + 40 + maxBar * 0.3

    ctx.save()
    ctx.scale(w / WIDTH, h / height)

    const bg = ctx.createRadialGradient(WIDTH / 2, baseline, 40, WIDTH / 2, baseline, height * 1.2)
    bg.addColorStop(0, `rgb(${18 + bass * 50}, ${34 + bass * 40}, ${40 + bass * 30})`)
    bg.addColorStop(1, '#030607')
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, WIDTH, height)

    ctx.strokeStyle = 'rgba(120, 180, 190, 0.08)'
    ctx.lineWidth = 1
    for (let y = baseline; y > baseline - maxBar; y -= 40) {
      ctx.beginPath()
      ctx.moveTo(MARGIN, y)
      ctx.lineTo(WIDTH - MARGIN, y)
      ctx.stroke()
    }

    if (frame.waveform && frame.playing) {
      ctx.strokeStyle = 'rgba(140, 220, 235, 0.55)'
      ctx.lineWidth = 3
      ctx.beginPath()
      const step = WIDTH / frame.waveform.length
      for (let i = 0; i < frame.waveform.length; i++) {
        const y = waveY + ((frame.waveform[i] - 128) / 128) * 90
        if (i === 0) ctx.moveTo(0, y)
        else ctx.lineTo(i * step, y)
      }
      ctx.stroke()
    }

    if (this.gradientFor !== height) {
      this.gradientFor = height
      this.barGradient = ctx.createLinearGradient(0, baseline, 0, baseline - maxBar)
      this.barGradient.addColorStop(0, '#00680c')
      this.barGradient.addColorStop(0.6, '#40ff76')
      this.barGradient.addColorStop(1, '#f2fbff')
    }
    const slot = (WIDTH - MARGIN * 2) / BARS
    const barW = slot * 0.6
    for (let i = 0; i < BARS; i++) {
      const value = analysis.bars[i]
      this.peaks[i] = Math.max(value, this.peaks[i] - PEAK_FALL * delta)
      const x = MARGIN + i * slot + (slot - barW) / 2
      const barH = Math.max(2, value * maxBar)

      ctx.fillStyle = this.barGradient
      ctx.fillRect(x, baseline - barH, barW, barH)
      ctx.globalAlpha = 0.18
      ctx.fillRect(x, baseline + 4, barW, Math.min(barH * 0.3, 50)) // reflection
      ctx.globalAlpha = 1

      ctx.fillStyle = '#ffe2a0'
      ctx.fillRect(x, baseline - this.peaks[i] * maxBar - 12, barW, 8)
    }

    ctx.textBaseline = 'alphabetic'
    ctx.textAlign = 'left'
    ctx.fillStyle = '#7d9298'
    ctx.font = '32px monospace'
    ctx.fillText('NOW PLAYING', MARGIN, 70)
    this.drawTitle(ctx, frame.title.toUpperCase() || 'NO SIGNAL', titleY, delta)

    if (frame.duration) {
      ctx.textAlign = 'right'
      ctx.fillStyle = '#7d9298'
      ctx.font = '32px monospace'
      ctx.fillText(`${formatTime(frame.currentTime)} / ${formatTime(frame.duration)}`, WIDTH - MARGIN, 70)
      ctx.fillStyle = 'rgba(255, 176, 0, 0.2)'
      ctx.fillRect(MARGIN, height - 36, WIDTH - MARGIN * 2, 8)
      ctx.fillStyle = '#ffb000'
      ctx.fillRect(MARGIN, height - 36, (WIDTH - MARGIN * 2) * (frame.currentTime / frame.duration), 8)
    }

    if (!frame.playing) {
      ctx.textAlign = 'center'
      ctx.fillStyle = '#d8e8ec'
      ctx.font = 'bold 80px monospace'
      ctx.fillText(frame.started ? 'PAUSED' : 'PRESS PLAY', WIDTH / 2, baseline - maxBar * 0.45)
    }
    ctx.restore()
    return true
  }
}
