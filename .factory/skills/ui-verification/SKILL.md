---
name: ui-verification
description: Prove a user-facing change works by driving the running app, and add a Visual proof section with inline screenshots to the pull request description.
---
# UI verification

Use this whenever a change affects something a user can see or click. Static checks don't count as proof for these changes.

`node .factory/runner/ui.mjs` does the plumbing: it starts the app under a virtual display (xvfb on the Linux runner), talks to it over the Chrome DevTools Protocol, takes screenshots and publishes them. Run it with no arguments for usage.

## Steps

1. `node .factory/runner/ui.mjs start`: builds the packages the app imports, launches it and waits until it has rendered. It opens the editable playground at `apps/desktop/.dev-electron/playground` (a few Markdown files and a folder); use it instead of file pickers. If it fails, the app log is in `$FACTORY_ARTIFACTS/app.log`.
2. Walk the exact path the request describes. For a bug, show the symptom is gone. For a feature, show the new behavior and its key interactions.
   - Find things: `ui.mjs eval '<js>'` runs JavaScript in the renderer and prints the result. For example, get an element's position with `JSON.stringify(el.getBoundingClientRect())`, or read the text the user would see.
   - Act: `ui.mjs click X Y` (add `right` for a context menu) at CSS pixel coordinates, and `ui.mjs type 'text'`. Use real clicks for menus; synthetic DOM events don't open base-ui menus.
3. `ui.mjs shot <name>` at each meaningful step, for example `1-before`, `2-menu-open`, `3-result`. Check each one by reading the PNG it prints; a screenshot of the wrong state is not proof.
4. `ui.mjs publish` pushes the screenshots to the `factory-media` branch (never the PR branch) and prints Markdown image links.
5. Add a `## Visual proof` section to the pull request description: the path you walked, then each image with one line on what it shows.
6. `ui.mjs stop`.

If the app can't start or the path can't be reached, say exactly that in Visual proof, with the error. Never claim a verification that didn't happen.

## Gotchas

- On the runner the window opens at the app's default size (about 920×720) with DPR 1, so screenshot pixels are CSS pixels.
- Native menus (like the macOS menu bar) don't exist on Linux. Say so in Visual proof and flag it for merge risk instead of claiming they work.
- Clipboard writes can't be read back reliably on the runner. Show the UI that confirms the action, such as a toast, rather than claiming the clipboard contents.
- Popup open in the DOM but missing from a screenshot? Check stacking with `document.elementFromPoint`.
- xterm refits through a debounced ResizeObserver and can lag layout changes by a few seconds; wait and re-measure before calling it a bug.
- The app runs from your working tree. After changing code, `stop` and `start` again before the final screenshots.
