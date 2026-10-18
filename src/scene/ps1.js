import * as THREE from 'three'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'

// Virtual vertical resolution shared by the pixelation and the vertex snapping.
export const PIXEL_HEIGHT = 240

// PlayStation-style output: a low virtual resolution, 15-bit colour (32 levels
// per channel) and 4x4 ordered dithering at that chunky pixel size. Runs after
// OutputPass so it quantises the final display colours.
const PS1Shader = {
  name: 'PS1Shader',
  uniforms: {
    tDiffuse: { value: null },
    aspect: { value: 16 / 9 },
    pixelHeight: { value: PIXEL_HEIGHT },
    levels: { value: 32 }, // colour levels per channel
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float aspect;
    uniform float pixelHeight;
    uniform float levels;
    varying vec2 vUv;

    const float BAYER[16] = float[16](
      0.0, 8.0, 2.0, 10.0,
      12.0, 4.0, 14.0, 6.0,
      3.0, 11.0, 1.0, 9.0,
      15.0, 7.0, 13.0, 5.0
    );

    void main() {
      vec2 grid = vec2(floor(pixelHeight * aspect), pixelHeight);
      vec2 cell = floor(vUv * grid);
      vec3 colour = texture2D(tDiffuse, (cell + 0.5) / grid).rgb;

      ivec2 p = ivec2(mod(cell, 4.0));
      float dither = BAYER[p.x + p.y * 4] / 16.0 - 0.5;
      float steps = levels - 1.0;
      colour = floor(colour * steps + 0.5 + dither) / steps;
      gl_FragColor = vec4(clamp(colour, 0.0, 1.0), 1.0);
    }`,
}

export function createPS1Pass() {
  return new ShaderPass(PS1Shader)
}

// Snaps every vertex to the virtual pixel grid, like the PS1's integer
// screen coordinates, so edges jitter and step as things move.
// Vertices well off-screen (corners of huge ground planes, things behind the
// camera) are left alone: they can't visibly wobble, and snapping them breaks
// the clipping of the large polygons they belong to.
const SNAP_GLSL = /* glsl */ `
if (uPS1Snap > 0.5 && gl_Position.w > 0.0) {
  vec2 ps1Ndc = gl_Position.xy / gl_Position.w;
  if (all(lessThan(abs(ps1Ndc), vec2(1.5)))) {
    vec2 ps1Half = uPS1Grid * 0.5;
    gl_Position.xy = floor(ps1Ndc * ps1Half + 0.5) / ps1Half * gl_Position.w;
  }
}`

function patchSnap(material, uniforms) {
  const previous = material.onBeforeCompile
  // Taken before replacing onBeforeCompile, since the default key is its source.
  const baseKey = material.customProgramCacheKey()
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer)
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform vec2 uPS1Grid;\nuniform float uPS1Snap;')
      .replace('#include <project_vertex>', `#include <project_vertex>\n${SNAP_GLSL}`)
  }
  material.customProgramCacheKey = () => `${baseKey}|ps1`
}

// Applies the geometry and texture side of the PS1 look: vertex snapping, and
// hard nearest-texel sampling on colour textures. Call once after the scene is
// built; anything added later goes through add() (an object, or materials).
// Materials only need adding once, however many meshes later share them.
export function applyPS1(scene) {
  const uniforms = {
    uPS1Grid: { value: new THREE.Vector2(PIXEL_HEIGHT * (16 / 9), PIXEL_HEIGHT) },
    uPS1Snap: { value: 1 },
  }
  const patched = new WeakSet()
  const textures = new Map() // texture -> its original [magFilter, minFilter]
  let enabled = true

  const filter = (texture, [mag, min]) => {
    texture.magFilter = enabled ? THREE.NearestFilter : mag
    texture.minFilter = enabled ? THREE.NearestMipmapNearestFilter : min
    texture.needsUpdate = true
  }

  const addMaterial = (material) => {
    if (patched.has(material)) return
    patched.add(material)
    patchSnap(material, uniforms)
    for (const key of ['map', 'emissiveMap']) {
      const texture = material[key]
      if (!texture || textures.has(texture)) continue
      const original = [texture.magFilter, texture.minFilter]
      textures.set(texture, original)
      if (enabled) filter(texture, original)
    }
  }
  const add = (target) => {
    if (Array.isArray(target)) target.forEach(addMaterial)
    else target.traverse((object) => [object.material].flat().filter(Boolean).forEach(addMaterial))
  }
  add(scene)

  return {
    add,
    setEnabled(on) {
      enabled = on
      uniforms.uPS1Snap.value = on ? 1 : 0
      for (const [texture, original] of textures) filter(texture, original)
    },
    setAspect(aspect) {
      uniforms.uPS1Grid.value.set(Math.floor(PIXEL_HEIGHT * aspect), PIXEL_HEIGHT)
    },
  }
}
