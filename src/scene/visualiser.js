import { BARS } from './analysis.js'

// Drawn in a 1024 x 576 coordinate space and scaled to the screen's canvas.
const WIDTH = 1024
const HEIGHT = 576
const BASELINE = 470
const MAX_BAR = 290
const PEAK_FALL = 0.5 // fraction of full height per second

function formatTime(seconds) {
  const s = Math.floor(seconds)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// The hero screen: spectrum bars, waveform, track title and progress.
export class Visualiser {
  constructor(ctx) {
    this.peaks = new Float32Array(BARS)
    this.barGradient = ctx.createLinearGradient(0, BASELINE, 0, BASELINE - MAX_BAR)
    this.barGradient.addColorStop(0, '#00680c')
    this.barGradient.addColorStop(0.6, '#40ff76')
    this.barGradient.addColorStop(1, '#f2fbff')
  }

  draw(ctx, w, h, delta, elapsed, analysis) {
    const frame = analysis.frame
    const { bass } = analysis.levels
    ctx.save()
    ctx.scale(w / WIDTH, h / HEIGHT)

    const bg = ctx.createRadialGradient(WIDTH / 2, BASELINE, 40, WIDTH / 2, BASELINE, 700)
    bg.addColorStop(0, `rgb(${18 + bass * 50}, ${34 + bass * 40}, ${40 + bass * 30})`)
    bg.addColorStop(1, '#030607')
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, WIDTH, HEIGHT)

    ctx.strokeStyle = 'rgba(120, 180, 190, 0.08)'
    ctx.lineWidth = 1
    for (let y = BASELINE; y > BASELINE - MAX_BAR; y -= 36) {
      ctx.beginPath()
      ctx.moveTo(60, y)
      ctx.lineTo(WIDTH - 60, y)
      ctx.stroke()
    }

    if (frame.waveform && frame.playing) {
      ctx.strokeStyle = 'rgba(140, 220, 235, 0.55)'
      ctx.lineWidth = 2
      ctx.beginPath()
      const step = WIDTH / frame.waveform.length
      for (let i = 0; i < frame.waveform.length; i++) {
        const y = 230 + ((frame.waveform[i] - 128) / 128) * 90
        if (i === 0) ctx.moveTo(0, y)
        else ctx.lineTo(i * step, y)
      }
      ctx.stroke()
    }

    const slot = (WIDTH - 120) / BARS
    const barW = slot * 0.7
    for (let i = 0; i < BARS; i++) {
      const value = analysis.bars[i]
      this.peaks[i] = Math.max(value, this.peaks[i] - PEAK_FALL * delta)
      const x = 60 + i * slot + (slot - barW) / 2
      const barH = Math.max(2, value * MAX_BAR)

      ctx.fillStyle = this.barGradient
      ctx.fillRect(x, BASELINE - barH, barW, barH)
      ctx.globalAlpha = 0.18
      ctx.fillRect(x, BASELINE + 4, barW, barH * 0.3) // reflection
      ctx.globalAlpha = 1

      ctx.fillStyle = '#ffe2a0'
      ctx.fillRect(x, BASELINE - this.peaks[i] * MAX_BAR - 6, barW, 3)
    }

    ctx.textBaseline = 'alphabetic'
    ctx.textAlign = 'left'
    ctx.fillStyle = '#7d9298'
    ctx.font = '22px monospace'
    ctx.fillText('NOW PLAYING', 60, 52)
    ctx.fillStyle = '#d8e8ec'
    ctx.font = 'bold 56px monospace'
    ctx.fillText(frame.title.toUpperCase() || 'NO SIGNAL', 60, 110)

    if (frame.duration) {
      ctx.textAlign = 'right'
      ctx.fillStyle = '#7d9298'
      ctx.font = '22px monospace'
      ctx.fillText(`${formatTime(frame.currentTime)} / ${formatTime(frame.duration)}`, WIDTH - 60, 52)
      ctx.fillStyle = 'rgba(255, 176, 0, 0.2)'
      ctx.fillRect(60, 548, WIDTH - 120, 4)
      ctx.fillStyle = '#ffb000'
      ctx.fillRect(60, 548, (WIDTH - 120) * (frame.currentTime / frame.duration), 4)
    }

    if (!frame.playing) {
      ctx.textAlign = 'center'
      ctx.fillStyle = '#d8e8ec'
      ctx.font = 'bold 64px monospace'
      ctx.fillText(frame.started ? 'PAUSED' : 'PRESS PLAY', WIDTH / 2, 330)
    }
    ctx.restore()
    return true
  }
}
