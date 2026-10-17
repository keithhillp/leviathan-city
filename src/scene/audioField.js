import * as THREE from 'three'

// Band 0 is overall bass; 1..BANDS-1 are log-spaced frequency bands.
export const BANDS = 32
const HISTORY = 64
const STEP = 1 / 60
const MIN_GAIN = 0.5
const GAIN_RANGE = 1.5

// Keeps the last ~1s of band levels in a texture so lights can look up the
// level "as it was" when the sound reached them, making pulses ripple
// outwards from the hero screen.
export class AudioField {
  constructor({ speed = 200 } = {}) {
    this.data = new Uint8Array(BANDS * HISTORY)
    this.texture = new THREE.DataTexture(this.data, BANDS, HISTORY, THREE.RedFormat)
    this.texture.magFilter = this.texture.minFilter = THREE.LinearFilter
    this.texture.needsUpdate = true
    this.accumulator = 0

    this.uniforms = {
      uAudioHistory: { value: this.texture },
      uAudioOrigin: { value: new THREE.Vector3() },
      uAudioMaxDistance: { value: speed * HISTORY * STEP },
      uAudioActive: { value: 0 },
    }
  }

  get origin() {
    return this.uniforms.uAudioOrigin.value
  }

  update(delta, bands, playing) {
    this.accumulator += delta
    while (this.accumulator >= STEP) {
      this.accumulator -= STEP
      this.data.copyWithin(BANDS, 0, this.data.length - BANDS)
      for (let i = 0; i < BANDS; i++) this.data[i] = bands[i] * 255
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
uniform float uAudioMaxDistance;
uniform float uAudioActive;
varying vec3 vAudioWorld;

float audioLevel(float band) {
  float delay = clamp(distance(vAudioWorld, uAudioOrigin) / uAudioMaxDistance, 0.0, 1.0);
  vec2 uv = vec2(
    band * ${(BANDS - 1) / BANDS} + ${0.5 / BANDS},
    delay * ${(HISTORY - 1) / HISTORY} + ${0.5 / HISTORY}
  );
  return texture2D(uAudioHistory, uv).r;
}

float audioGainFor(float level) {
  return mix(1.0, ${MIN_GAIN.toFixed(3)} + level * ${GAIN_RANGE.toFixed(3)}, uAudioActive);
}

float audioGain(float band) {
  return audioGainFor(audioLevel(band));
}

// 0 or 1 (with a short soft edge): has the band crossed this threshold?
float audioTrigger(float band, float threshold) {
  return smoothstep(threshold, threshold + 0.06, audioLevel(band)) * uAudioActive;
}
`
