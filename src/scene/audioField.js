import * as THREE from 'three'

// Band 0 is overall bass; 1..BANDS-1 are log-spaced frequency bands.
export const BANDS = 32
const HISTORY = 128 // ~2s of history
// History columns: the bands, then stereo balance and stereo weight (padded to
// a multiple of 4 for texture row alignment).
const BALANCE_COLUMN = BANDS
const WEIGHT_COLUMN = BANDS + 1
const COLUMNS = BANDS + 4
const STEREO_AMOUNT = 0.6 // how far the louder side brightens and the other dims
const STEP = 1 / 60
const MIN_GAIN = 0.5
const GAIN_RANGE = 1.5

// Keeps the last ~2s of band levels in a texture so lights can look up the
// level "as it was" when the sound reached them. Pulses sweep from `origin`
// along `direction` (from the tower down the street towards the cameras), so
// everything at the same distance along it lights together.
export class AudioField {
  constructor({ speed = 90, direction = new THREE.Vector3(0, 0, 1) } = {}) {
    this.data = new Uint8Array(COLUMNS * HISTORY)
    this.texture = new THREE.DataTexture(this.data, COLUMNS, HISTORY, THREE.RedFormat)
    this.texture.magFilter = this.texture.minFilter = THREE.LinearFilter
    this.texture.needsUpdate = true
    this.accumulator = 0

    this.uniforms = {
      uAudioHistory: { value: this.texture },
      uAudioOrigin: { value: new THREE.Vector3() },
      uAudioDirection: { value: direction.clone().normalize() },
      uAudioMaxDistance: { value: speed * HISTORY * STEP },
      uAudioActive: { value: 0 },
    }
  }

  get origin() {
    return this.uniforms.uAudioOrigin.value
  }

  // `stereo` is { balance, weight } from AudioAnalysis.
  update(delta, bands, playing, stereo) {
    this.accumulator += delta
    while (this.accumulator >= STEP) {
      this.accumulator -= STEP
      this.data.copyWithin(COLUMNS, 0, this.data.length - COLUMNS)
      for (let i = 0; i < BANDS; i++) this.data[i] = bands[i] * 255
      this.data[BALANCE_COLUMN] = ((stereo.balance + 1) / 2) * 255
      this.data[WEIGHT_COLUMN] = stereo.weight * 255
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
uniform vec3 uAudioDirection;
uniform float uAudioMaxDistance;
uniform float uAudioActive;
varying vec3 vAudioWorld;

float audioColumn(float column) {
  float along = dot(vAudioWorld - uAudioOrigin, uAudioDirection);
  float delay = clamp(along / uAudioMaxDistance, 0.0, 1.0);
  vec2 uv = vec2(
    (column + 0.5) / ${COLUMNS.toFixed(1)},
    delay * ${(HISTORY - 1) / HISTORY} + ${0.5 / HISTORY}
  );
  return texture2D(uAudioHistory, uv).r;
}

float audioLevel(float band) {
  return audioColumn(band * ${(BANDS - 1).toFixed(1)});
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
