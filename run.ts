import path from "node:path"
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import pixelmatch from "pixelmatch"
import { PNG } from "pngjs"

const opencode = path.join(homedir(), "projects", "opencode-latest")
const themes = path.resolve(Bun.argv[2] ?? path.join(import.meta.dir, "themes"))
const screenshots = path.resolve(Bun.argv[3] ?? path.join(import.meta.dir, "screenshots"))
const scenario = path.join(import.meta.dir, "scenario.ts")
const files = await Array.fromAsync(new Bun.Glob("**/*.json").scan({ cwd: themes, absolute: true }))
const similarityThreshold = Number(process.env.OPENCODE_THEME_GALLERY_SIMILARITY ?? "0.99")

if (!Number.isFinite(similarityThreshold) || similarityThreshold < 0 || similarityThreshold > 1) {
  console.error("OPENCODE_THEME_GALLERY_SIMILARITY must be a number between 0 and 1")
  process.exit(1)
}

if (!files.length) {
  console.error(`No JSON themes found in ${themes}`)
  process.exit(1)
}

await mkdir(screenshots, { recursive: true })
const staging = await mkdtemp(path.join(tmpdir(), "opencode-theme-gallery-"))

const failures: string[] = []
const slugs = new Set<string>()

try {
  for (const file of files.sort()) {
    const source = await Bun.file(file).json().catch(() => undefined)
    const slug = path.basename(file, ".json").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
    if (!slug) {
      failures.push(`${file}: filename does not produce a usable theme prefix`)
      continue
    }
    if (slugs.has(slug)) {
      failures.push(`${file}: duplicate theme prefix "${slug}"`)
      continue
    }
    slugs.add(slug)

    if (!isRecord(source)) {
      failures.push(`${file}: invalid JSON theme object`)
      continue
    }
    if (source.version === 2) {
      failures.push(`${file}: native V2 theme loading is not supported by the TUI yet`)
      continue
    }
    if (!isRecord(source.theme)) {
      failures.push(`${file}: expected a V1 theme with a "theme" object`)
      continue
    }

    for (const mode of ["light", "dark"] as const) {
      const name = `theme-gallery-${slug}-${mode}-${process.pid}`
      console.log(`\n[${slug}/${mode}] capturing screenshots`)
      const child = Bun.spawn(
        ["opencode-drive", "start", "--name", name, "--script", scenario, "--dev", opencode],
        {
          cwd: opencode,
          env: {
            ...process.env,
            OPENCODE_THEME_GALLERY_FILE: file,
            OPENCODE_THEME_GALLERY_MODE: mode,
            OPENCODE_THEME_GALLERY_OUTPUT: staging,
            OPENCODE_THEME_GALLERY_SLUG: slug,
          },
          stdout: "inherit",
          stderr: "inherit",
        },
      )
      const exit = await child.exited
      if (exit !== 0) failures.push(`${file} (${mode}): OpenCode Drive exited with ${exit}`)
    }
  }

  if (failures.length) {
    console.error("\nTheme gallery completed with errors:")
    failures.forEach((failure) => console.error(`- ${failure}`))
    process.exitCode = 1
  } else {
    const generated = await Array.fromAsync(new Bun.Glob("*.png").scan({ cwd: staging }))
    let unchanged = 0
    let updated = 0

    for (const name of generated.sort()) {
      const next = path.join(staging, name)
      const previous = path.join(screenshots, name)
      const similarity = await imageSimilarity(previous, next)
      if (similarity !== undefined && similarity >= similarityThreshold) {
        unchanged++
        continue
      }
      await copyFile(next, previous)
      updated++
    }

    console.log(
      `\nScreenshots written to ${screenshots} (${updated} updated, ${unchanged} preserved at ${formatPercent(similarityThreshold)} similarity)`,
    )
  }
} finally {
  await rm(staging, { recursive: true, force: true })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

async function imageSimilarity(previous: string, next: string) {
  if (!(await Bun.file(previous).exists())) return undefined

  const [before, after] = await Promise.all([
    PNG.sync.read(Buffer.from(await Bun.file(previous).arrayBuffer())),
    PNG.sync.read(Buffer.from(await Bun.file(next).arrayBuffer())),
  ])
  if (before.width !== after.width || before.height !== after.height) return 0

  const pixels = before.width * before.height
  const changed = pixelmatch(before.data, after.data, undefined, before.width, before.height, { threshold: 0.1 })
  return 1 - changed / pixels
}

function formatPercent(value: number) {
  return `${Number((value * 100).toFixed(2))}%`
}
