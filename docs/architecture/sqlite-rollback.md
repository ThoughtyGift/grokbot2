# Rollback: SQLite → `state.json`

P3 makes `.data/grokbot.sqlite` the hot path. `state.json` is frozen at migrate time and is the
rollback source. The ten `state.json.N.bak` files from before the migrate are also kept.

Do this only if the sqlite file is unreadable or a migrate went wrong. The running backend
holds a WAL; stop it first.

## Restore the last JSON snapshot

1. Stop the backend (`Ctrl+C` on `pnpm backend`).
2. Move the sqlite files out of the way so the next start re-imports JSON:

   ```
   .data/grokbot.sqlite
   .data/grokbot.sqlite-wal
   .data/grokbot.sqlite-shm
   .data/grokbot.sqlite.1.bak … .10.bak
   ```

   Rename rather than delete — you may want them back.

3. Confirm `.data/state.json` is the roster you want. If it is empty or truncated, copy the
   newest good `.data/state.json.N.bak` over it (`N=1` is the most recent JSON rotation).
4. Start `pnpm backend`. Logs should include `persistence is sqlite` and `imported_from` pointing
   at the JSON you restored. Roster, parked cards and automations come back from that file.

## Restore a sqlite backup instead

If JSON is the thing that is wrong and a `.data/grokbot.sqlite.1.bak` is good:

1. Stop the backend.
2. Copy `grokbot.sqlite.1.bak` over `grokbot.sqlite`. Delete `-wal` and `-shm` if they exist
   (they belong to the file you just replaced).
3. Start the backend. It will *not* re-import JSON (`meta.imported` is already `1`).

## Dry-run before a real rollback

```
node -e "const {DatabaseSync}=require('node:sqlite'); const db=new DatabaseSync('services/grokbot-backend/.data/grokbot.sqlite',{readOnly:true}); console.log(db.prepare('select count(*) n from agents').get(), db.prepare('select count(*) n from parked').get())"
```

`scripts/verify-sqlite.mjs` is the same check the P3 gate runs.
