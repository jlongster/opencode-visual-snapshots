import path from "node:path"
import { mkdir } from "node:fs/promises"
import { defineScript, wait } from "opencode-drive"

const file = required("OPENCODE_THEME_GALLERY_FILE")
const mode = required("OPENCODE_THEME_GALLERY_MODE")
const output = required("OPENCODE_THEME_GALLERY_OUTPUT")
const slug = required("OPENCODE_THEME_GALLERY_SLUG")
const themeName = `gallery-${slug}`

export default defineScript({
  async setup({ fs, config }) {
    await fs.writeFile("README.md", "# Theme gallery fixture\n\nA stable project for OpenCode TUI screenshots.\n")
    await fs.writeFile("src/example.ts", "export const palette = ['neutral', 'accent', 'interactive']\n")
    await fs.writeFile(`.opencode/themes/${themeName}.json`, await Bun.file(file).text())
    await fs.writeFile(
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
  },
  async run({ llm, ui }) {
    await mkdir(output, { recursive: true })
    llm.title((_request, index) => (index === 0 ? "Theme gallery" : `Theme gallery ${index + 1}`))

    await ui.waitFor((state) => state.focused.editor)
    await ui.waitFor("local")
    await wait(750)
    await capture(ui, "01-home")

    await ui.submit("Show me a compact markdown theme specimen")
    await llm.send(
      llm.reasoning("I will provide a stable markdown sample for the theme gallery."),
      llm.text(
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
      ),
    )
    await ui.waitFor("Theme Review")
    await capture(ui, "02-markdown")

    const permission = llm.send(
      llm.toolCall({
        id: "theme-gallery-permission",
        index: 0,
        name: "shell",
        input: { command: "printf 'theme gallery permission'" },
      }),
    )
    await ui.submit("Run a protected command so I can inspect the permission prompt")
    await ui.waitFor("Permission required")
    await capture(ui, "03-permission")
    await ui.enter()
    await permission
    await llm.send(llm.text("The protected command completed successfully."))
    await ui.waitFor("completed successfully")

    const form = llm.send(
      llm.toolCall({
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
      }),
    )
    await ui.submit("Ask me for a theme direction")
    await ui.waitFor("Which direction should this theme emphasize?")
    await capture(ui, "04-form")
    await ui.enter()
    await form
    await llm.send(llm.text("The theme review form was submitted."))
    await ui.waitFor("form was submitted")

    llm.queue(
      llm.toolCall({
        id: "theme-gallery-visual-auditor",
        index: 0,
        name: "subagent",
        input: {
          agent: "visual-auditor",
          description: "Inspect visual hierarchy",
          prompt: "Review the fixture's visual hierarchy.",
          background: true,
        },
      }),
      llm.toolCall({
        id: "theme-gallery-interaction-reviewer",
        index: 1,
        name: "subagent",
        input: {
          agent: "interaction-reviewer",
          description: "Inspect interactive states",
          prompt: "Review the fixture's interactive states.",
          background: true,
        },
      }),
      llm.toolCall({
        id: "theme-gallery-contrast-reviewer",
        index: 2,
        name: "subagent",
        input: {
          agent: "contrast-reviewer",
          description: "Inspect color contrast",
          prompt: "Review the fixture's color contrast.",
          background: true,
        },
      }),
      llm.finish("tool-calls"),
    )
    Array.from({ length: 6 }, () => llm.queue(llm.text("Background worker response.")))
    await ui.submit("Launch three background reviewers for this theme")
    await ui.waitFor("Inspect visual hierarchy", { timeout: 15_000 })
    await ui.waitFor("Background worker response.", { timeout: 15_000 })

    await ui.submit("/new")
    await ui.waitFor((state) => state.focused.editor)
    await ui.submit("Create a second session for the session switcher gallery")
    await ui.waitFor("Background worker response.", { timeout: 15_000 })
    await ui.submit("/sessions")
    await ui.waitFor("Sessions")
    await capture(ui, "05-session-switcher")
    await ui.arrow("down")
    await ui.enter()
    await ui.waitFor("Launch three background reviewers for this theme")

    await ui.type("!sleep 30")
    await ui.enter()
    await wait(300)
    await ui.arrow("down")
    await ui.waitFor("Subagents")
    await capture(ui, "06-subagents-shells")
  },
})

async function capture(ui: { screenshot(name?: string): Promise<string> }, state: string) {
  const source = await ui.screenshot(`${slug}-${mode}-${state}`)
  await Bun.write(path.join(output, `${slug}-${mode}-${state}.png`), Bun.file(source))
}

function required(name: string) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}
