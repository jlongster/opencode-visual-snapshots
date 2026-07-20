import path from "node:path"
import { mkdir } from "node:fs/promises"
import { Effect, Stream } from "effect"
import { defineScript, Llm, type Ui } from "opencode-drive"

const file = required("OPENCODE_THEME_GALLERY_FILE")
const mode = required("OPENCODE_THEME_GALLERY_MODE")
const output = required("OPENCODE_THEME_GALLERY_OUTPUT")
const slug = required("OPENCODE_THEME_GALLERY_SLUG")
const themeName = `gallery-${slug}`
const streamOptions = { delay: 0, chunkSize: 1_000_000 } as const

export default defineScript({
  project: { git: true },
  setup: ({ fs, config }) =>
    Effect.gen(function* () {
      yield* fs.writeFile("README.md", "# Theme gallery fixture\n\nA stable project for OpenCode TUI screenshots.\n")
      yield* fs.writeFile("src/example.ts", "export const palette = ['neutral', 'accent', 'interactive']\n")
      const theme = yield* Effect.promise(() => Bun.file(file).text())
      yield* fs.writeFile(`.opencode/themes/${themeName}.json`, theme)
      yield* fs.writeFile(
        ".opencode/cli.json",
        `${JSON.stringify({
          theme: { name: themeName, mode },
        }, undefined, 2)}\n`,
      )
      config.permissions = [
        { action: "*", resource: "*", effect: "allow" },
        { action: "shell", resource: "*", effect: "ask" },
      ]
      config.agents = {
        "visual-auditor": { description: "Reviews visual hierarchy", mode: "subagent" },
        "interaction-reviewer": { description: "Reviews interactive states", mode: "subagent" },
        "contrast-reviewer": { description: "Reviews color contrast", mode: "subagent" },
      }
    }),
  run: ({ llm, ui }) =>
    Effect.gen(function* () {
      yield* Effect.promise(() => mkdir(output, { recursive: true }))
      yield* llm.title((_request, index) =>
        Effect.succeed(index === 0 ? "Theme gallery" : `Theme gallery ${index + 1}`),
      )
      yield* llm.serve((_request, index) => galleryResponse(index))

      yield* ui.waitFor((state) => state.focused.editor, { timeout: 60_000 })
      yield* ui.waitFor("local")
      yield* Effect.sleep(750)
      yield* capture(ui, "01-home")

      yield* ui.submit("Show me a compact markdown theme specimen")
      yield* ui.waitFor("Theme Review", { timeout: 15_000 })
      yield* capture(ui, "02-markdown")

      yield* ui.submit("Run a protected command so I can inspect the permission prompt")
      yield* ui.waitFor("Permission required", { timeout: 15_000 })
      yield* capture(ui, "03-permission")
      yield* ui.enter()
      yield* ui.waitFor("completed successfully")

      yield* ui.submit("Ask me for a theme direction")
      yield* ui.waitFor("Which direction should this theme emphasize?", { timeout: 15_000 })
      yield* capture(ui, "04-form")
      yield* ui.enter()
      yield* ui.waitFor("form was submitted")

      yield* ui.submit("Update the fixture so I can review its working tree diff")
      yield* ui.waitFor("ready for review", { timeout: 15_000 })

      yield* ui.submit("/diff")
      yield* ui.waitFor("working tree", { timeout: 15_000 })
      yield* ui.press("s")
      yield* ui.press("n")
      yield* Effect.sleep(200)
      yield* capture(ui, "05-diff-viewer-interactions")
      const state = yield* ui.state()
      const fileTree = state.elements.find((element) => element.focusable && element.x === 0 && element.width === 32)
      if (!fileTree) throw new Error("Could not find the diff file tree")
      yield* ui.click(fileTree, { x: 10, y: 5 })
      yield* Effect.sleep(200)
      yield* capture(ui, "06-diff-viewer-file-tree")
      yield* ui.press("q")
      yield* ui.waitFor((state) => state.focused.editor)

      yield* ui.submit("Launch three background reviewers for this theme")
      yield* Effect.sleep(5_000)

      yield* ui.submit("/new")
      yield* ui.waitFor((state) => state.focused.editor, { timeout: 15_000 })
      yield* ui.submit("Create a second session for the session switcher gallery")
      yield* Effect.sleep(3_000)
      yield* ui.submit("/sessions")
      yield* ui.waitFor("Sessions", { timeout: 15_000 })
      yield* capture(ui, "05-session-switcher")
      yield* ui.arrow("down")
      yield* ui.enter()
      yield* ui.waitFor("Launch three background reviewers for this theme")

      yield* ui.type("!sleep 30")
      yield* ui.enter()
      yield* Effect.sleep(300)
      yield* ui.arrow("down")
      yield* ui.waitFor("Subagents")
      yield* capture(ui, "06-subagents-shells")
    }),
})

function capture(ui: Ui, state: string) {
  return Effect.gen(function* () {
    const source = yield* ui.screenshot(`${slug}-${mode}-${state}`)
    yield* Effect.promise(() => Bun.write(path.join(output, `${slug}-${mode}-${state}.png`), Bun.file(source)))
  })
}

function galleryResponse(index: number) {
  if (index === 0) {
    return Stream.make(
      Llm.reasoning("I will provide a stable markdown sample for the theme gallery.", streamOptions),
      Llm.text(
        [
          "# Theme Review",
          "",
          "A compact response with **strong text**, *emphasis*, and an `inline token`.",
          "",
          "> Good themes preserve hierarchy without losing contrast.",
          "",
          "- Neutral surfaces",
          "- Interactive accents",
          "- Success, warning, and error feedback",
          "",
          "```ts",
          "const mode = 'gallery'",
          "```",
        ].join("\n"),
        streamOptions,
      ),
    )
  }
  if (index === 1) {
    return Stream.make(
      Llm.toolCall(
        {
          id: "theme-gallery-permission",
          index: 0,
          name: "shell",
          input: { command: "printf 'theme gallery permission'" },
        },
        streamOptions,
      ),
    )
  }
  if (index === 2) return Stream.make(Llm.text("The protected command completed successfully.", streamOptions))
  if (index === 3) {
    return Stream.make(
      Llm.toolCall(
        {
          id: "theme-gallery-question",
          index: 0,
          name: "question",
          input: {
            questions: [
              {
                header: "Theme direction",
                question: "Which direction should this theme emphasize?",
                options: [
                  { label: "Balanced", description: "Keep surfaces and accents evenly weighted" },
                  { label: "Expressive", description: "Give accent colors more visual presence" },
                  { label: "Quiet", description: "Favor neutral surfaces and restrained contrast" },
                ],
              },
            ],
          },
        },
        streamOptions,
      ),
    )
  }
  if (index === 4) return Stream.make(Llm.text("The theme review form was submitted.", streamOptions))
  if (index === 5) {
    return Stream.make(
      Llm.toolCall(
        {
          id: "theme-gallery-diff",
          index: 0,
          name: "patch",
          input: {
            patchText: [
              "*** Begin Patch",
              "*** Update File: README.md",
              "@@",
              "-A stable project for OpenCode TUI screenshots.",
              "+A stable project for reviewing OpenCode TUI themes.",
              "+",
              "+The fixture covers hierarchy, contrast, and interactive states.",
              "*** Update File: src/example.ts",
              "@@",
              "-export const palette = ['neutral', 'accent', 'interactive']",
              "+export const palette = ['neutral', 'accent', 'interactive', 'feedback']",
              "*** Add File: src/review.ts",
              "+export const reviewStates = ['ready', 'active', 'complete']",
              "*** End Patch",
            ].join("\n"),
          },
        },
        streamOptions,
      ),
    )
  }
  if (index === 6) return Stream.make(Llm.text("The fixture updates are ready for review.", streamOptions))
  if (index === 7) {
    return Stream.make(
      Llm.toolCall(
        {
          id: "theme-gallery-visual-auditor",
          index: 0,
          name: "subagent",
          input: {
            agent: "visual-auditor",
            description: "Inspect visual hierarchy",
            prompt: "Review the fixture's visual hierarchy.",
            background: true,
          },
        },
        streamOptions,
      ),
      Llm.toolCall(
        {
          id: "theme-gallery-interaction-reviewer",
          index: 1,
          name: "subagent",
          input: {
            agent: "interaction-reviewer",
            description: "Inspect interactive states",
            prompt: "Review the fixture's interactive states.",
            background: true,
          },
        },
        streamOptions,
      ),
      Llm.toolCall(
        {
          id: "theme-gallery-contrast-reviewer",
          index: 2,
          name: "subagent",
          input: {
            agent: "contrast-reviewer",
            description: "Inspect color contrast",
            prompt: "Review the fixture's color contrast.",
            background: true,
          },
        },
        streamOptions,
      ),
      Llm.finish("tool-calls"),
    )
  }
  return Stream.make(Llm.text("Background worker response.", streamOptions))
}

function required(name: string) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}
