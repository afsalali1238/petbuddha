/**
 * The Bodhi tree diorama (§4.1, §4.5): a rounded grass island, the cushion he
 * sits on, and a toon tree with six individually-animated foliage clusters.
 *
 * Shares the Buddha's floor convention: y = 0 is the ground, the cushion top is
 * CUSHION_TOP, and the seat marker is where the Buddha's root goes.
 */
import * as THREE from 'three'
import * as G from './geometry.mjs'
import { CUSHION_TOP } from './bodhi.mjs'

/** Island size at 100% scale: ~200 x 140 px against a 110 px pet (§4.1). */
const ISLAND_RX = 0.91
const ISLAND_RZ = 0.635
const ISLAND_RY = 0.20
/** bottom of the dirt blob / top of the grass cap, in floor units */
const ISLAND_BOTTOM = -0.37
const ISLAND_GRASS_LINE = -0.055

export const SEAT = { x: 0.16, y: CUSHION_TOP, z: 0.18 }
export const CANOPY = { x: -0.34, y: 1.82, z: -0.32 }

const CLUSTERS = [
  { pos: [0.05, 0.18, 0.02], radius: 0.62, squash: 0.72, role: 'leafLight' },
  { pos: [-0.62, 0.02, -0.18], radius: 0.50, squash: 0.75, role: 'leafDark' },
  { pos: [0.62, 0.10, 0.14], radius: 0.52, squash: 0.72, role: 'leafLight' },
  { pos: [-0.30, 0.48, 0.28], radius: 0.45, squash: 0.74, role: 'leafDark' },
  { pos: [0.42, 0.42, -0.32], radius: 0.47, squash: 0.72, role: 'leafLight' },
  { pos: [0.06, 0.66, 0.06], radius: 0.42, squash: 0.76, role: 'leafDark' }
]

/** Foliage clusters visible before any session is completed (§4.5). */
export const BASE_CLUSTERS = 2

export function buildTree({ PALETTE }) {
  const root = new THREE.Object3D()
  root.name = 'tree_root'

  const materials = {}
  const materialFor = (role) => {
    if (!materials[role]) {
      const m = new THREE.MeshStandardMaterial({
        color: new THREE.Color(PALETTE[role] ?? '#00FF00'),
        roughness: 1,
        metalness: 0
      })
      m.name = `tree_${role}`
      materials[role] = m
    }
    return materials[role]
  }

  // --- the island: grass on top, dirt underneath, one mesh -----------------
  // The blob hangs below y = 0 so its grass cap sits at the floor line; the
  // dirt underside reads as a rim from the front.
  const grassGeo = G.transformed(G.sphere(1, 26, 16), {
    scale: [ISLAND_RX, ISLAND_RY, ISLAND_RZ],
    pos: [0, ISLAND_BOTTOM + ISLAND_RY, 0]
  })
  G.paintByHeight(grassGeo, PALETTE.islandGrass, PALETTE.islandDirt, ISLAND_GRASS_LINE)
  const island = new THREE.Mesh(grassGeo, withVertexColors(materialFor('islandGrass')))
  island.name = 'island:islandVC'
  root.add(island)

  // --- the cushion: flattened cylinder with a button dip and a band --------
  // Deliberately wider than the robe hem (0.30) so the cushion still reads when
  // he is sitting on it — the empty cushion is the whole point of the break.
  const cushionProfile = [
    [0.0001, 0.0],
    [0.30, 0.0],
    [0.37, 0.03],
    [0.38, 0.078],
    [0.35, 0.112],
    [0.24, CUSHION_TOP + 0.006],
    [0.13, CUSHION_TOP - 0.014],
    [0.06, CUSHION_TOP - 0.026],
    [0.0001, CUSHION_TOP - 0.018]
  ]
  const cushionGeo = G.merge([
    G.paint(G.transformed(G.lathe(cushionProfile, 22), { pos: [SEAT.x, 0, SEAT.z] }), PALETTE.cushion),
    G.paint(
      G.transformed(G.torus(0.373, 0.024, 6, 26), {
        pos: [SEAT.x, 0.056, SEAT.z],
        rot: [Math.PI / 2, 0, 0],
        scale: [1, 1, 1]
      }),
      PALETTE.cushionBand
    )
  ])
  const cushion = new THREE.Mesh(cushionGeo, withVertexColors(materialFor('cushion')))
  cushion.name = 'cushion:cushionVC'
  root.add(cushion)

  // --- trunk: gentle S-curve ----------------------------------------------
  const trunkCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.50, -0.05, -0.34),
    new THREE.Vector3(-0.30, 0.42, -0.40),
    new THREE.Vector3(-0.52, 0.86, -0.26),
    new THREE.Vector3(-0.30, 1.28, -0.36),
    new THREE.Vector3(-0.36, 1.62, -0.30)
  ])
  const trunkGeo = new THREE.TubeGeometry(trunkCurve, 16, 0.085, 8, false)
  const trunk = new THREE.Mesh(trunkGeo, materialFor('trunk'))
  trunk.name = 'trunk:trunk'
  root.add(trunk)

  // --- six foliage clusters, each its own node so it can sway and pop ------
  CLUSTERS.forEach((cluster, index) => {
    const holder = new THREE.Object3D()
    holder.name = `foliage_${index}`
    holder.position.set(
      CANOPY.x + cluster.pos[0],
      CANOPY.y + cluster.pos[1],
      CANOPY.z + cluster.pos[2]
    )
    const geo = G.transformed(G.ico(cluster.radius, 1), { scale: [1, cluster.squash, 1] })
    const mesh = new THREE.Mesh(geo, materialFor(cluster.role))
    mesh.name = `foliage_${index}_mesh:${cluster.role}`
    holder.add(mesh)
    root.add(holder)
  })

  // --- markers the renderer hangs things off -------------------------------
  addMarker(root, 'seat_marker', [SEAT.x, CUSHION_TOP, SEAT.z])
  addMarker(root, 'canopy_center', [CANOPY.x, CANOPY.y, CANOPY.z])
  addMarker(root, 'sign_anchor', [SEAT.x, CUSHION_TOP + 0.42, SEAT.z])
  addMarker(root, 'island_front', [0, 0, ISLAND_RZ])

  return { root, materials, clusterCount: CLUSTERS.length }
}

function withVertexColors(material) {
  material.vertexColors = true
  return material
}

function addMarker(parent, name, position) {
  const o = new THREE.Object3D()
  o.name = name
  o.position.set(...position)
  parent.add(o)
  return o
}
