// Downloads the MuJoCo Menagerie model files used by the Control page into public/models/menagerie/.
// The files are not committed (≈ 0.6 GB); run `pnpm models:fetch` once before `pnpm dev` or a deploy.
// Textures are skipped: the viewer renders materials by their rgba colour.
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FLEET } from '../src/components/app/fleet-data.ts'

const COMMIT = 'f3b6013629c7b94f8ee93fd977b161fa8350f9bc'
const RAW = `https://raw.githubusercontent.com/google-deepmind/mujoco_menagerie/${COMMIT}`
const OUT = new URL('../public/models/menagerie/', import.meta.url)
const POOL = 8

async function exists(path) {
  try {
    return (await stat(path)).size > 0
  } catch {
    return false
  }
}

/** Downloads `${RAW}/${rel}` to `OUT/rel` unless it is already there; returns the file size in bytes. */
async function download(rel) {
  const path = fileURLToPath(new URL(rel, OUT))
  if (await exists(path)) return (await stat(path)).size
  const url = `${RAW}/${rel}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${url}`)
  const buf = Buffer.from(await res.arrayBuffer())
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, buf)
  return buf.length
}

async function text(rel) {
  await download(rel)
  return readFile(fileURLToPath(new URL(rel, OUT)), 'utf8')
}

async function pool(items, fn) {
  const results = []
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(POOL, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        results[i] = await fn(items[i])
      }
    }),
  )
  return results
}

let totalBytes = 0
for (const { id, modelUrl } of FLEET) {
  const mjcf = modelUrl.slice(modelUrl.lastIndexOf('/') + 1)
  const main = await text(`${id}/${mjcf}`)
  const xmlFiles = [mjcf]
  const docs = [main]
  for (const [, file] of main.matchAll(/<include\s+file="([^"]+)"/g)) {
    xmlFiles.push(file)
    docs.push(await text(`${id}/${file}`))
  }
  const dir = main.match(/<compiler\b[^>]*\b(?:meshdir|assetdir)="([^"]*)"/)?.[1] ?? ''
  const meshes = new Set()
  for (const doc of docs) for (const [, file] of doc.matchAll(/<mesh\b[^>]*\bfile="([^"]+)"/g)) meshes.add(file)
  const prefix = dir ? `${id}/${dir.replace(/\/$/, '')}/` : `${id}/`
  const sizes = await pool([...meshes], (file) => download(`${prefix}${file}`))
  let bytes = sizes.reduce((a, b) => a + b, 0)
  for (const file of xmlFiles) bytes += (await stat(fileURLToPath(new URL(`${id}/${file}`, OUT)))).size
  totalBytes += bytes
  console.log(`${id}: ${xmlFiles.length + meshes.size} files, ${(bytes / 1e6).toFixed(1)} MB`)
}
console.log(`total: ${(totalBytes / 1e6).toFixed(1)} MB`)
