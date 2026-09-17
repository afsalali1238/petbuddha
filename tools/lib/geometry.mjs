/**
 * Small geometry helpers shared by the model builders.
 * Values are in metres; the Buddha stands 1.0 unit tall (§4.1).
 */
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

export function sphere(radius, widthSegments = 16, heightSegments = 12) {
  return new THREE.SphereGeometry(radius, widthSegments, heightSegments)
}

export function capsule(radius, length, radialSegments = 12, capSegments = 4) {
  return new THREE.CapsuleGeometry(radius, length, capSegments, radialSegments)
}

export function cylinder(radiusTop, radiusBottom, height, radialSegments = 20) {
  return new THREE.CylinderGeometry(radiusTop, radiusBottom, height, radialSegments)
}

export function torus(radius, tube, radialSegments = 8, tubularSegments = 20) {
  return new THREE.TorusGeometry(radius, tube, radialSegments, tubularSegments)
}

export function ico(radius, detail = 1) {
  return new THREE.IcosahedronGeometry(radius, detail)
}

export function box(w, h, d) {
  return new THREE.BoxGeometry(w, h, d)
}

/**
 * Lathe profile from [x, y] pairs. Used for the pear-shaped body and the robe
 * hem — cheap, clean silhouette, no UVs needed.
 */
export function lathe(profile, segments = 18) {
  const points = profile.map(([x, y]) => new THREE.Vector2(Math.max(0.0001, x), y))
  return new THREE.LatheGeometry(points, segments)
}

/** Apply a transform to a geometry once, so parts can be merged safely. */
export function transformed(geometry, { pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1] } = {}) {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(...pos),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)),
    new THREE.Vector3(...scale)
  )
  geometry.applyMatrix4(m)
  return geometry
}

export function merge(geometries) {
  const cleaned = geometries.map((g) => {
    const geo = g.index ? g : g.toNonIndexed()
    if (!geo.getAttribute('uv')) {
      const count = geo.getAttribute('position').count
      geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2))
    }
    return geo
  })
  const merged = mergeGeometries(cleaned, false)
  if (!merged) throw new Error('mergeGeometries failed')
  merged.computeVertexNormals()
  return merged
}

/**
 * A partial torus reading as a closed-eyelid arc. The arc is centred on the
 * top of the circle (a sleepy "⌒" lid); `arcDown` centres it on the bottom
 * (a smile).
 */
export function arcUp(radius, tube, sweep = 2.0, tubularSegments = 14) {
  return new THREE.TorusGeometry(radius, tube, 6, tubularSegments, sweep).rotateZ(
    Math.PI / 2 - sweep / 2
  )
}

export function arcDown(radius, tube, sweep = 1.9, tubularSegments = 14) {
  return new THREE.TorusGeometry(radius, tube, 6, tubularSegments, sweep).rotateZ(
    -Math.PI / 2 - sweep / 2
  )
}

/** Bake a flat colour into a geometry's vertex colours (no textures anywhere). */
export function paint(geometry, hex) {
  const color = new THREE.Color(hex)
  const count = geometry.getAttribute('position').count
  const array = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    array[i * 3 + 0] = color.r
    array[i * 3 + 1] = color.g
    array[i * 3 + 2] = color.b
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(array, 3))
  return geometry
}

/** Paint vertices by height so one mesh can carry two palette roles. */
export function paintByHeight(geometry, aboveHex, belowHex, splitAt = 0, axis = 'y') {
  const above = new THREE.Color(aboveHex)
  const below = new THREE.Color(belowHex)
  const pos = geometry.getAttribute('position')
  const array = new Float32Array(pos.count * 3)
  const index = axis === 'y' ? 1 : axis === 'x' ? 0 : 2
  for (let i = 0; i < pos.count; i++) {
    const c = pos.array[i * 3 + index] >= splitAt ? above : below
    array[i * 3 + 0] = c.r
    array[i * 3 + 1] = c.g
    array[i * 3 + 2] = c.b
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(array, 3))
  return geometry
}

export function triCount(geometry) {
  const pos = geometry.getAttribute('position')
  return geometry.index ? geometry.index.count / 3 : pos.count / 3
}
