# Zhiqun Schedule

Shared schedule and timetable MVP with a FastAPI backend and a native WeChat Mini Program client.

## Canonical Local Project

Use this repository as the active development copy:

```text
C:\Users\Admin1\Documents\Codex\2026-06-10\new-chat
```

Open this directory in WeChat DevTools:

```text
C:\Users\Admin1\Documents\Codex\2026-06-10\new-chat\miniprogram
```

There are older or copied `new-chat\miniprogram` directories on this machine. If a UI change appears to have no effect after recompiling, first confirm DevTools is opened against the path above.

## Local Workflow

1. Start the backend from `backend`.
2. Open `miniprogram` in WeChat DevTools.
3. Recompile the mini program.
4. Run the mini program validator from `miniprogram` when changing frontend files.

   ```powershell
   npm run validate:mp
   ```

   If `npm` is not installed on the machine, run the script with any available Node.js executable:

   ```powershell
   node scripts/validate-miniprogram.js
   ```

   `npm run validate` is also available as a shorter alias.
