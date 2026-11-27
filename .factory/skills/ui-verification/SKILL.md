---
name: ui-verification
description: Prove a user-facing change works by driving the running app over the Chrome DevTools Protocol, and add a Visual proof section to the pull request description.
---
# UI verification

Use this whenever a change affects something a user can see or click.

## Start the app

1. Run `MARKY_DESKTOP_ENABLE_CDP=1 xvfb-run -a -s "-screen 0 1440x900x24" pnpm dev:desktop` in the background. The factory runs on a headless Linux runner, so the app needs a virtual display; drop `xvfb-run` on macOS.
2. Read the terminal output for:
   - `Playground: <path>`
   - `DevTools listening on ws://*********:9222/...`
3. Use the auto-opened editable playground at `apps/desktop/.dev-electron/playground` instead of file pickers or checked-in fixtures.

## Walk the path

4. Walk the exact path the request describes. For a bug, show the symptom is gone. For a feature, show the new behavior and its key interactions.
5. There is no computer-use tool on the runner; drive the app through the Chrome DevTools Protocol endpoint. It can inspect DOM state, evaluate JavaScript, click controls, inspect iframe contents, and capture screenshots from the real Electron renderer.
6. For CDP, fetch `http://*********:9222/json/list`, connect to the page's `webSocketDebuggerUrl`, and drive the renderer with DevTools Protocol commands.

## Record the proof

7. Record the flow: capture frames with `Page.startScreencast` and join them with `ffmpeg` into an `.mp4`, or take `Page.captureScreenshot` shots of each step. Save every file under `$FACTORY_ARTIFACTS`; the factory uploads that folder to the run.
8. Add a `## Visual proof` section to the pull request description: the path you walked, what each recording or screenshot shows, and a link to the run (`$FACTORY_RUN_URL`) where the media is attached. Never commit media to the branch.
9. If the app cannot launch or the path cannot be reached, say so in the Visual proof section. Never claim a verification that did not happen.
10. When you are done, stop the dev server and confirm no `Marky Dev` process remains.

## Gotchas

- Native menus (like the macOS View menu) do not render on Linux. Say so in Visual proof instead of claiming they work, and flag it for merge risk.

- Build `packages/ui` and `packages/editor` first if you start the app any other way; the desktop app imports their dist output.
- Screenshots are DPR 2: CSS pixels times 2.
- Right clicks need real `Input.dispatchMouseEvent` events; synthetic `contextmenu` events don't open base-ui context menus.
- Popup open in the DOM but missing from a screenshot? Check stacking with `document.elementFromPoint`.
- xterm refits through a debounced ResizeObserver and can lag layout changes by a few seconds; re-measure before calling it a bug.
