import * as THREE from 'three'

// Band 0 is overall bass; 1..BANDS-1 are log-spaced frequency bands.
export const BANDS = 64
const HISTORY = 128 // ~2s of history
// History columns: the bands, then stereo balance and stereo weight (padded to
// a multiple of 4 for texture row alignment).
const BALANCE_COLUMN = BANDS
const WEIGHT_COLUMN = BANDS + 1
const CALM_COLUMN = BANDS + 2
const SNARE_COLUMN = BANDS + 3 // snare envelope
const SNARE_SIDE_COLUMN = BANDS + 4 // which side of the street it's on (0 left, 1 right)
const HAT_COLUMN = BANDS + 5 // hat / light percussion envelope
const UNIFY_COLUMN = BANDS + 6 // heavy bass push: windows go to one colour
const COLUMNS = BANDS + 12
const STEREO_AMOUNT = 0.6 // how far the louder side brightens and the other dims
const STEP = 1 / 60
const MIN_GAIN = 0.3 // between hits lights dim to this...
const GAIN_RANGE = 1.7 // ...and peaks add up to this much on top
export const HISTORY_SECONDS = HISTORY * STEP

// Shapes the delay can take (see patterns.js): `sweep` along an axis, `ripple`
// out from a point, `outward` from a plane both ways, `scatter` per window,
// `spiral` arms around a vertical axis, `rings` repeating ripples, `stripes`
// repeating bands, `implode` closing in on a point, `blocks` per chunk.
export const PATTERN_TYPES = {
  sweep: 0,
  ripple: 1,
  outward: 2,
  scatter: 3,
  spiral: 4,
  rings: 5,
  stripes: 6,
  implode: 7,
  blocks: 8,
}

// Keeps the last ~2s of band levels in a texture so lights can look up the
// level "as it was" when the sound reached them. How long the sound takes to
// reach a point is set by a pattern (crossfading between two, A and B), so
// pulses travel across the city in different shapes. `origin` is the street's
// centre line, used to tell its left side from its right.
export class AudioField {
  constructor() {
    this.data = new Uint8Array(COLUMNS * HISTORY)
    this.texture = new THREE.DataTexture(this.data, COLUMNS, HISTORY, THREE.RedFormat)
    this.texture.magFilter = this.texture.minFilter = THREE.LinearFilter
    this.texture.needsUpdate = true
    this.accumulator = 0

    this.uniforms = {
      uAudioHistory: { value: this.texture },
      uAudioOrigin: { value: new THREE.Vector3() },
      uAudioActive: { value: 0 },
      // Patterns: origin.xyz + type in w; axis.xyz + speed (units/s, or spread
      // in seconds for scatter) in w. uPatternMix crossfades A -> B.
      uPatternA: { value: new THREE.Vector4() },
      uPatternAxisA: { value: new THREE.Vector4(0, 0, 1, 90) },
      uPatternB: { value: new THREE.Vector4() },
      uPatternAxisB: { value: new THREE.Vector4(0, 0, 1, 90) },
      uPatternMix: { value: 0 },
      // Colour palette (set by colours.js): four colours looped round, how far
      // it's slid across the windows, and how strongly windows take it.
      uPalette: { value: Array.from({ length: 4 }, () => new THREE.Color(1, 1, 1)) },
      uPaletteShift: { value: 0 },
      uPaletteTint: { value: 0 },
    }
  }

  get origin() {
    return this.uniforms.uAudioOrigin.value
  }

  // Takes AudioAnalysis's bands, stereo ({ balance, weight }), calm, drums and unify.
  update(delta, { bands, stereo, calm, drums, unify }, playing) {
    this.accumulator += delta
    while (this.accumulator >= STEP) {
      this.accumulator -= STEP
      this.data.copyWithin(COLUMNS, 0, this.data.length - COLUMNS)
      for (let i = 0; i < BANDS; i++) this.data[i] = bands[i] * 255
      this.data[BALANCE_COLUMN] = ((stereo.balance + 1) / 2) * 255
      this.data[WEIGHT_COLUMN] = stereo.weight * 255
      this.data[CALM_COLUMN] = calm * 255
      this.data[SNARE_COLUMN] = drums.snare * 255
      this.data[SNARE_SIDE_COLUMN] = drums.snareSide * 255
      this.data[HAT_COLUMN] = drums.hat * 255
      this.data[UNIFY_COLUMN] = unify * 255
      this.texture.needsUpdate = true
    }
    const active = this.uniforms.uAudioActive
    active.value = THREE.MathUtils.lerp(active.value, playing ? 1 : 0, Math.min(1, delta * 3))
  }

  // Injects audioGain() into a built-in material. `apply` is a GLSL statement
  // inserted after the `after` chunk of the fragment shader; `vertexApply`
  // runs at the end of the vertex shader, e.g. to pass attributes through.
  patch(
    material,
    { after, apply, uniforms = {}, declarations = '', vertexDeclarations = '', vertexApply = '' },
  ) {
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms, uniforms)
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\nvarying vec3 vAudioWorld;\n${vertexDeclarations}`)
        .replace(
          '#include <project_vertex>',
          `#include <project_vertex>\nvAudioWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;\n${vertexApply}`,
        )
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${GAIN_GLSL}\n${declarations}`)
        .replace(after, `${after}\n${apply}`)
    }
    material.customProgramCacheKey = () => `audio:${after}:${apply}:${vertexApply}`
  }
}

const GAIN_GLSL = /* glsl */ `
uniform sampler2D uAudioHistory;
uniform vec3 uAudioOrigin;
uniform float uAudioActive;
uniform vec4 uPatternA;
uniform vec4 uPatternAxisA;
uniform vec4 uPatternB;
uniform vec4 uPatternAxisB;
uniform float uPatternMix;
uniform vec3 uPalette[4];
uniform float uPaletteShift;
uniform float uPaletteTint;
varying vec3 vAudioWorld;

// Colour at position t around the palette loop (wraps), scaled to brightness 1
// (capped so deep blues don't blow out).
vec3 paletteAt(float t) {
  float scaled = fract(t + uPaletteShift) * 4.0;
  int i = int(floor(scaled));
  vec3 colour = mix(uPalette[i], uPalette[(i + 1) % 4], fract(scaled));
  return colour / max(dot(colour, vec3(0.299, 0.587, 0.114)), 0.25);
}

// A stable random value per cell of the given size.
float patternHash(vec3 p, vec3 size) {
  vec3 cell = floor(p / size);
  return fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
}

// 0..1 of the history: how long ago this point "hears" the music.
float patternDelay(vec4 pattern, vec4 axis) {
  const float history = ${HISTORY_SECONDS.toFixed(4)};
  vec3 offset = vAudioWorld - pattern.xyz;
  float type = pattern.w;
  float spread = axis.w / history; // for the repeating / random shapes
  if (type < 0.5) return clamp(dot(offset, axis.xyz) / (axis.w * history), 0.0, 1.0);
  if (type < 1.5) return clamp(length(offset) / (axis.w * history), 0.0, 1.0);
  if (type < 2.5) return clamp(abs(dot(offset, axis.xyz)) / (axis.w * history), 0.0, 1.0);
  if (type < 3.5) return patternHash(vAudioWorld, vec3(3.0, 3.5, 3.0)) * spread; // one per window
  if (type < 4.5) {
    float angle = atan(offset.z, offset.x) / 6.2832 + 0.5;
    return fract(angle * axis.x + length(offset.xz) * axis.y) * spread;
  }
  if (type < 5.5) return fract(length(offset) * axis.x) * spread;
  if (type < 6.5) return fract(dot(offset, axis.xyz)) * spread;
  if (type < 7.5) return clamp((axis.x - length(offset)) / (axis.w * history), 0.0, 1.0);
  return patternHash(vAudioWorld, vec3(12.0)) * spread; // building-sized chunks
}

float audioDelay() {
  return mix(patternDelay(uPatternA, uPatternAxisA), patternDelay(uPatternB, uPatternAxisB), uPatternMix);
}

// Worked out once per fragment and reused by every lookup below.
float audioDelayCache = -1.0;

float audioColumn(float column) {
  if (audioDelayCache < 0.0) audioDelayCache = audioDelay();
  float delay = audioDelayCache;
  vec2 uv = vec2(
    (column + 0.5) / ${COLUMNS.toFixed(1)},
    delay * ${(HISTORY - 1) / HISTORY} + ${0.5 / HISTORY}
  );
  return texture2D(uAudioHistory, uv).r;
}

float audioLevel(float band) {
  return audioColumn(band * ${(BANDS - 1).toFixed(1)});
}

// 0..1, how quiet the passage was when the sound reached this point.
float audioCalm() {
  return audioColumn(${CALM_COLUMN.toFixed(1)});
}

// Snare flash, ping-ponging between the two sides of the street.
float audioSnare() {
  float side = vAudioWorld.x < uAudioOrigin.x ? 0.0 : 1.0;
  float hitSide = step(0.5, audioColumn(${SNARE_SIDE_COLUMN.toFixed(1)}));
  return audioColumn(${SNARE_COLUMN.toFixed(1)}) * (1.0 - abs(side - hitSide)) * uAudioActive;
}

// 0..1: how far this point's lights should go to one shared colour.
float audioUnify() {
  return audioColumn(${UNIFY_COLUMN.toFixed(1)}) * uAudioActive;
}

// Hat / light percussion twinkle.
float audioHat() {
  return audioColumn(${HAT_COLUMN.toFixed(1)}) * uAudioActive;
}

// Brightens the side of the street the music is panned to (left of the
// street follows the left channel), but only near the track's peaks.
float audioStereoGain() {
  float balance = audioColumn(${BALANCE_COLUMN.toFixed(1)}) * 2.0 - 1.0;
  float weight = audioColumn(${WEIGHT_COLUMN.toFixed(1)});
  float side = vAudioWorld.x < uAudioOrigin.x ? 1.0 : -1.0;
  return mix(1.0, clamp(1.0 + side * balance * ${STEREO_AMOUNT.toFixed(2)}, 0.0, 2.0), weight);
}

float audioGainFor(float level) {
  return mix(1.0, ${MIN_GAIN.toFixed(3)} + level * ${GAIN_RANGE.toFixed(3)}, uAudioActive);
}

float audioGain(float band) {
  return audioGainFor(audioLevel(band));
}

// 0 or 1 (with a short soft edge): has the level crossed this threshold?
float audioTriggerFor(float level, float threshold) {
  return smoothstep(threshold, threshold + 0.06, level) * uAudioActive;
}

float audioTrigger(float band, float threshold) {
  return audioTriggerFor(audioLevel(band), threshold);
}
`
