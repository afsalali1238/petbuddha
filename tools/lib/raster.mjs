/**
 * Tiny software rasteriser used by tools/preview.mjs.
 *
 * It exists so the M0 acceptance test (§4.7: "silhouette test: character
 * readable at 110 px") can be run in CI, on a headless box, with no GPU. It
 * reproduces the shipping look closely enough to judge silhouette and pose:
 * orthographic camera, flat palette colours, a 3-step toon ramp, and the same
 * inverted-hull outline the renderer builds (§5.2).
 */
import * as THREE from 'three'
import { PNG } from 'pngjs'

const TOON_STEPS = [0.55, 0.82, 1.0]

/** #1A1A1A in the renderer's working colour space (linear-sRGB). */
const OUTLINE_COLOR = new THREE.Color(0x1a1a1a)

export function createCanvas(width, height, background = null) {
  const pixels = new Float32Array(width * height * 3)
  // the camera sits at +Z, so larger z is nearer: keep the NEAREST fragment
  const depth = new Float32Array(width * height).fill(-Infinity)
  const alpha = new Float32Array(width * height)
  if (background) {
    for (let i = 0; i < width * height; i++) {
      pixels[i * 3 + 0] = background[0]
      pixels[i * 3 + 1] = background[1]
      pixels[i * 3 + 2] = background[2]
      alpha[i] = 1
    }
  }
  return { width, height, pixels, depth, alpha }
}

/** Box-downsample a supersampled canvas. */
export function downsample(canvas, factor) {
  const w = Math.floor(canvas.width / factor)
  const h = Math.floor(canvas.height / factor)
  const out = new PNG({ width: w, height: h })
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let dy = 0; dy < factor; dy++) {
        for (let dx = 0; dx < factor; dx++) {
          const sx = x * factor + dx
          const sy = y * factor + dy
          const i = sy * canvas.width + sx
          r += canvas.pixels[i * 3 + 0]
          g += canvas.pixels[i * 3 + 1]
          b += canvas.pixels[i * 3 + 2]
          a += canvas.alpha[i]
        }
      }
      const n = factor * factor
      const o = (y * w + x) * 4
      out.data[o + 0] = Math.round((r / n) * 255)
      out.data[o + 1] = Math.round((g / n) * 255)
      out.data[o + 2] = Math.round((b / n) * 255)
      out.data[o + 3] = Math.round((a / n) * 255)
    }
  }
  return out
}

function toon(intensity) {
  if (intensity < 0.34) return TOON_STEPS[0]
  if (intensity < 0.72) return TOON_STEPS[1]
  return TOON_STEPS[2]
}

/**
 * Render an object hierarchy with an orthographic camera looking down -Z.
 *
 * @param {object} options
 * @param {THREE.Object3D} options.root
 * @param {number} options.pxPerUnit  world units -> pixels
 * @param {number} options.width
 * @param {number} options.height
 * @param {{x:number,y:number}} options.centre  where world (0,0) lands, in px
 * @param {(name:string)=>boolean} options.outlined  which meshes get a hull
 * @param {number} options.outlineWidth  in world units
 * @param {THREE.Vector3} options.lightDirection
 */
export function renderScene(options) {
  const {
    root,
    pxPerUnit,
    width,
    height,
    centre,
    outlined = () => false,
    outlineWidth = 0.006,
    lightDirection = new THREE.Vector3(-0.45, 0.75, 0.6).normalize(),
    ambientSky = 0.62,
    ambientGround = 0.3,
    background = null,
    cameraYaw = 0,
    cameraPitch = 0,
    /** flat unshaded colours — used by the ASCII silhouette preview */
    flat = false
  } = options

  const canvas = createCanvas(width, height, background)
  root.updateMatrixWorld(true)

  const yaw = new THREE.Matrix4().makeRotationY(cameraYaw)
  const pitch = new THREE.Matrix4().makeRotationX(cameraPitch)
  const view = new THREE.Matrix4().multiplyMatrices(pitch, yaw)

  const meshes = []
  root.traverse((object) => {
    if (object.isMesh && object.visible) meshes.push(object)
  })

  for (const pass of ['outline', 'fill']) {
    for (const mesh of meshes) {
      const wantsOutline = outlined(mesh.name)
      if (pass === 'outline' && !wantsOutline) continue

      const geometry = mesh.geometry
      const position = geometry.getAttribute('position')
      const normalAttribute = geometry.getAttribute('normal')
      const colorAttribute = geometry.getAttribute('color')
      const index = geometry.index
      const count = index ? index.count : position.count
      const matrix = mesh.matrixWorld

      const base = mesh.material.color ? mesh.material.color.clone() : new THREE.Color('#ffffff')
      const useVertexColors = mesh.material.vertexColors === true && colorAttribute != null

      const worldPositions = []
      for (let i = 0; i < position.count; i++) {
        const v = new THREE.Vector3().fromBufferAttribute(position, i)
        let n = new THREE.Vector3().fromBufferAttribute(normalAttribute ?? position, i)
        if (!normalAttribute) n.set(0, 1, 0)
        if (pass === 'outline') {
          // inverted hull: push the shell out along the vertex normal
          v.addScaledVector(n, outlineWidth)
        }
        v.applyMatrix4(matrix)
        worldPositions.push(v)
      }

      for (let t = 0; t < count; t += 3) {
        const ia = index ? index.getX(t) : t
        const ib = index ? index.getX(t + 1) : t + 1
        const ic = index ? index.getX(t + 2) : t + 2

        const a = worldPositions[ia].clone().applyMatrix4(view)
        const b = worldPositions[ib].clone().applyMatrix4(view)
        const c = worldPositions[ic].clone().applyMatrix4(view)

        // face normal in view space; -Z faces the camera
        const ab = b.clone().sub(a)
        const ac = c.clone().sub(a)
        const faceNormal = ab.cross(ac).normalize()
        // front faces point back toward the camera at +Z
        const facing = faceNormal.z
        if (pass === 'fill' ? facing <= 0 : facing > 0) continue

        // lighting uses the world-space normal
        const wa = worldPositions[ia]
        const wb = worldPositions[ib]
        const wc = worldPositions[ic]
        const worldNormal = wb.clone().sub(wa).cross(wc.clone().sub(wa)).normalize()
        const lambert = Math.max(0, worldNormal.dot(lightDirection))
        const hemi = ambientGround + (ambientSky - ambientGround) * (worldNormal.y * 0.5 + 0.5)
        const intensity = flat ? 1 : Math.min(1, hemi * 0.75 + lambert * 0.55)

        let r
        let g
        let bl
        if (pass === 'outline') {
          r = OUTLINE_COLOR.r
          g = OUTLINE_COLOR.g
          bl = OUTLINE_COLOR.b
        } else {
          const step = toon(intensity)
          if (useVertexColors) {
            r = (colorAttribute.getX(ia) * step)
            g = (colorAttribute.getY(ia) * step)
            bl = (colorAttribute.getZ(ia) * step)
          } else {
            r = base.r * step
            g = base.g * step
            bl = base.b * step
          }
        }

        drawTriangle(
          canvas,
          a.x * pxPerUnit + centre.x,
          centre.y - a.y * pxPerUnit,
          b.x * pxPerUnit + centre.x,
          centre.y - b.y * pxPerUnit,
          c.x * pxPerUnit + centre.x,
          centre.y - c.y * pxPerUnit,
          a.z,
          b.z,
          c.z,
          r,
          g,
          bl
        )
      }
    }
  }

  return canvas
}

/**
 * Rasterise one triangle.
 *
 * The model has ~5.8k triangles inside a ~110 px silhouette, so most triangles
 * are smaller than a pixel: sampling only the pixel centre would punch holes
 * everywhere. We test five points per pixel (centre + four inset corners) and
 * keep the nearest hit.
 */
const SAMPLES = [
  [0.5, 0.5],
  [0.1, 0.5],
  [0.9, 0.5],
  [0.5, 0.1],
  [0.5, 0.9]
]

function drawTriangle(canvas, x0, y0, x1, y1, x2, y2, z0, z1, z2, r, g, b) {
  const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2)))
  const maxX = Math.min(canvas.width - 1, Math.ceil(Math.max(x0, x1, x2)))
  const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2)))
  const maxY = Math.min(canvas.height - 1, Math.ceil(Math.max(y0, y1, y2)))
  if (minX > maxX || minY > maxY) return

  // signed area (cross of AB and AC)
  const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0)
  if (Math.abs(area) < 1e-12) return
  const inv = 1 / area

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      let bestDepth = -Infinity
      let hit = false
      for (let s = 0; s < SAMPLES.length; s++) {
        const px = x + SAMPLES[s][0]
        const py = y + SAMPLES[s][1]
        const lc = ((x1 - x0) * (py - y0) - (y1 - y0) * (px - x0)) * inv
        const la = ((x2 - x1) * (py - y1) - (y2 - y1) * (px - x1)) * inv
        const lb = ((x0 - x2) * (py - y2) - (y0 - y2) * (px - x2)) * inv
        // Inside points always give all-positive weights: lambda_i = E_i(P)/A
        // flips sign with the winding, so lambda_i itself does not. (The
        // screen-space y flip makes every triangle's signed area negative.)
        if (la < 0 || lb < 0 || lc < 0) continue
        const depth = la * z0 + lb * z1 + lc * z2
        if (depth > bestDepth) bestDepth = depth
        hit = true
      }
      if (!hit) continue
      const i = y * canvas.width + x
      if (bestDepth <= canvas.depth[i]) continue
      canvas.depth[i] = bestDepth
      canvas.pixels[i * 3 + 0] = r
      canvas.pixels[i * 3 + 1] = g
      canvas.pixels[i * 3 + 2] = b
      canvas.alpha[i] = 1
    }
  }
}
