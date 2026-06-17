# Zhiqun Schedule Mini Program

Native WeChat Mini Program client for the shared schedule MVP.

## Current Features

- Dev-account login against the local FastAPI backend.
- Custom tab bar that adapts to current group permissions.
- Calendar tab with weekly event/course grid, event CRUD, NLP event entry, and realtime refresh.
- Course tab with semester setup, weekly timetable, course CRUD, NLP course entry, and realtime refresh.
- Manage tab with group creation, invite-code join, current permission summary, member list, and role updates.

## Development

1. Start the backend from `../backend`.
2. Open this exact `miniprogram` directory in WeChat DevTools:

   ```text
   C:\Users\Admin1\Documents\Codex\2026-06-10\new-chat\miniprogram
   ```

3. In devtools, `utils/config.*` uses `127.0.0.1:8000` automatically.
4. For phone preview, update `LAN_HOST` in `utils/config.ts` and `utils/config.js` to a host reachable from the phone.

Before checking UI changes, run:

```powershell
npm run validate:mp
```

If `npm` is not installed, run the script with any available Node.js executable:

```powershell
node scripts/validate-miniprogram.js
```

This catches common local issues, including opening the wrong copied project directory in WeChat DevTools.
`npm run validate` is kept as a shorter alias for the same check.

The client currently uses native WXML/WXSS components. `@vant/weapp` remains listed in `package.json`, but the active MVP screens do not require npm components.
