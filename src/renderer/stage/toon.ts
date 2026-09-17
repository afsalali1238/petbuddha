import * as THREE from 'three'
import { PALETTE } from '@shared/palette'
import type { Settings } from '@shared/types'

/**
 * The toon recipe (§5.2): a 3-step gradient map, flat palette colours (no
 * textures on the character), and an inverted-hull outline on the Buddha only.
 *
 * Mesh names carry their palette role: `bodhi_head:skinBase`. Roles ending in
 * `VC` are vertex-coloured (the lens highlight and the two-tone island/cushion
 * are baked that way so they cost one draw call each).
 */

export function makeGradientMap(): THREE.DataTexture {
  const data = new Uint8Array([Math.round(0.55 * 255), Math.round(0.82 * 255), 255])
  const texture = new THREE.DataTexture(data, 3, 1, THREE.RedFormat)
  texture.minFilter = THREE.NearestFilter
  texture.magFilter = THREE.NearestFilter
  texture.generateMipmaps = false
  texture.needsUpdate = true
  return texture
}

const VERTEX_COLORED = new Set(['lensVC', 'islandVC', 'cushionVC'])

function roleOf(name: string): string | null {
  const index = name.indexOf(':')
  return index >= 0 ? name.slice(index + 1) : null
}

const materialCache = new Map<string, THREE.MeshToonMaterial>()

/** Replace the export's standard materials with the shipping toon materials. */
export function toonify(root: THREE.Object3D, gradientMap: THREE.DataTexture): void {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh) return
    const role = roleOf(mesh.name) ?? 'outline'
    const key = role
    let material = materialCache.get(key)
    if (!material) {
      const vertexColors = VERTEX_COLORED.has(role)
      const color = vertexColors ? 0xffffff : new THREE.Color(PALETTE[role as keyof typeof PALETTE] ?? PALETTE.skinBase).getHex()
      material = new THREE.MeshToonMaterial({
        color,
        gradientMap,
        vertexColors
      })
      material.name = `toon_${role}`
      materialCache.set(key, material)
    }
    const previous = mesh.material
    mesh.material = material
    if (Array.isArray(previous)) previous.forEach((m) => m.dispose())
    else previous?.dispose()
  })
}

const OUTLINE_VERTEX = /* glsl */ `
  uniform float uWidth;
  void main() {
    vec3 expanded = position + normalize(normal) * uWidth;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(expanded, 1.0);
  }
`

const OUTLINE_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  void main() {
    gl_FragColor = vec4(uColor, 1.0);
  }
`

export interface OutlineOptions {
  /** outline thickness in screen px, converted to local units by the caller */
  widthPx?: number
  /** world units per local unit on this object (the actor scale) */
  worldScale?: number
  /** only these meshes get a hull (§5.2: the Buddha, not the foliage) */
  filter?: (name: string) => boolean
}

export function outlineMaterial(widthLocal: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uWidth: { value: widthLocal },
      uColor: { value: new THREE.Color(PALETTE.outline) }
    },
    vertexShader: OUTLINE_VERTEX,
    fragmentShader: OUTLINE_FRAGMENT,
    side: THREE.BackSide,
    transparent: false,
    depthWrite: true
  })
}

/**
 * Inverted hull: duplicate the meshes, render their back faces pushed out along
 * the vertex normals. Cheap, resolution-independent, and it survives the rig
 * because each hull is parented to the same node as the mesh it outlines.
 */
export function buildOutlines(root: THREE.Object3D, options: OutlineOptions = {}): THREE.Mesh[] {
  const { widthPx = 1.8, worldScale = 1, filter } = options
  const widthLocal = widthPx / Math.max(1, worldScale)
  const hulls: THREE.Mesh[] = []

  root.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh) return
    if (filter && !filter(mesh.name)) return
    if (mesh.name.includes(':lensVC')) return

    const hull = new THREE.Mesh(mesh.geometry, outlineMaterial(widthLocal))
    hull.name = `${mesh.name}_outline`
    hull.frustumCulled = false
    hull.renderOrder = -1
    // Match the source node's local transform exactly.
    hull.position.copy(mesh.position)
    hull.quaternion.copy(mesh.quaternion)
    hull.scale.copy(mesh.scale)
    mesh.parent?.add(hull)
    hulls.push(hull)
  })

  return hulls
}

/** Live-update the hull width when the pet scale changes. */
export function setOutlineWidth(hulls: THREE.Mesh[], widthPx: number, worldScale: number): void {
  const widthLocal = widthPx / Math.max(1, worldScale)
  for (const hull of hulls) {
    const material = hull.material as THREE.ShaderMaterial
    material.uniforms.uWidth.value = widthLocal
  }
}

/** Soft radial shadow disc — cheaper and kinder than a shadow map (§5.2). */
export function contactShadow(radiusPx: number): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(radiusPx * 2, radiusPx * 2)
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uOpacity: { value: 0.28 },
      uColor: { value: new THREE.Color('#2A2118') }
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      uniform float uOpacity;
      uniform vec3 uColor;
      void main() {
        float d = length(vUv - 0.5) * 2.0;
        float a = smoothstep(1.0, 0.25, d) * uOpacity;
        if (a < 0.005) discard;
        gl_FragColor = vec4(uColor, a);
      }
    `,
    transparent: true,
    depthWrite: false
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.rotation.x = -Math.PI / 2
  mesh.renderOrder = -2
  mesh.name = 'contact-shadow'
  return mesh
}

/** Which time-of-day rig to use, honouring the dev override (§4.5). */
export function resolveTimeOfDay(settings: Settings, now = new Date()): keyof typeof PALETTE extends never ? string : string {
  if (settings.timeOfDay !== 'auto') return settings.timeOfDay
  const hour = now.getHours()
  if (hour < 5 || hour >= 20) return 'night'
  if (hour < 8) return 'dawn'
  if (hour < 17) return 'day'
  return 'dusk'
}
