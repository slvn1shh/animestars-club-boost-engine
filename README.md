# animestars-club-boost-engine

## Setup (First Time)
1. Install Bun: [https://bun.sh](https://bun.sh)
2. Open terminal in the project folder and run:
```bash
bun install
```
3. Make the scripts executable:
```bash
chmod +x run_boost.sh share_logs.sh
```

## Running on Mac
You can put this folder anywhere, or create an alias (shortcut) to `run_boost.sh` on your desktop.

1. **To run the engine:**
   Double-click (if configured) or run in terminal: `./run_boost.sh`
   It will create/append to `boost.log`.

2. **To share logs (if something goes wrong):**
   Run in terminal: `./share_logs.sh`
   It will give you a link to share with me.

## Manual Run (for developers)
```bash
bun src/index.ts
```

```bash
bun src/bossInvasion.ts
```
