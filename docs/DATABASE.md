# GROW 420 v10 — Documentazione database

## 1. Dove stanno i dati
| Posto | Cosa contiene | Ruolo in v10 |
|---|---|---|
| `Grow420DB_v10` (IndexedDB) | tutto, con ID/versioni/tombstone/coda | **fonte operativa principale** |
| LocalStorage `grow-plants` | piante + log (cache sincrona) | compatibilità fase 1, ricostruibile dal DB |
| LocalStorage `grow-coa`, `grow-community`, `grow-progress` | dati condivisi | cache; copia in `settings` (kind `shared`) |
| LocalStorage `stoner-mode`, `grow-widgets`, `grow-w-*`, `grow-active-plant`, … | **preferenze del dispositivo** | NON sincronizzate; incluse nel backup (`devicePrefs`) |
| `Grow420DB` (IndexedDB, v9) | foto, promemoria, vecchi log duplicati | **mai cancellato**: sorgente migrazione + specchio per rollback |
| `sb-grow420-auth` (LocalStorage) | sessione Supabase | mai nei backup, mai loggata |
| `grow-user-id` | vecchio ID cloud | solo identificatore legacy per l'import |
| `grow-device-id`, `grow-v10-pending` | ID dispositivo / marcatore scrittura in corso | tecnici |

## 2. `Grow420DB_v10` — schema (Dexie v1)
Campi comuni a ogni riga sincronizzabile: `version` (contatore locale), `updatedAt`, `deletedAt` (tombstone), `deviceId`, `synced` (versione del server confermata; 0 = mai inviata).

| Tabella | Chiave / indici | Campi |
|---|---|---|
| `plants` | `&uuid`, `ord`, `updatedAt` | `body` (nome, genetica, fase, note, `progress`, `water`, `phaseLog`…), `ord` (posizione) |
| `logs` | `&uuid`, `plantUuid`, `updatedAt` | `plantUuid`, `ord`, `body` (data, testo, tag, metriche, isProblem) |
| `photos` | `++id`, `&uuid`, `plantUuid`, `legacyId` | `id` = **stesso id** della v9, `plantUuid` (null = non collegata), `legacyPlantIdx`, `logId`, `data` (dataURL JPEG, null nei tombstone), `createdAt`, `phase`, `storagePath`, `sha256`, `bytes`, `mime` |
| `reminders` | `++id`, `&uuid`, `legacyId`, `active` | `title`, `datetime`, `repeat`, `active` (1/0), `createdAt` |
| `settings` | `key`, `kind`, `updatedAt` | `kind`=`shared` (coa/community/progress) o `legacy-idb` (copia dei vecchi `settings`, non sincronizzata), `value` |
| `syncQueue` | `++seq`, `[entity+uuid]`, `ts` | `entity` (plant/log/photo/reminder/setting), `uuid`, `op` (upsert/delete), `status` (pending/conflict/failed), `attempts`, `lastError`. Una sola voce per entità (le modifiche successive la sostituiscono). Il contenuto si legge dalla riga al momento dell'invio |
| `syncMeta` | `key` | `cursor:<tabella>` (ultimo `server_seq` ricevuto), `account`, `firstSyncDone`, `lastSync`, `lastBackup`, `conflict:<entity>:<uuid>` (versione remota in conflitto) |
| `migrationLog` | `++id`, `ts`, `step` | `start`, `inventory`, `pre-backup` (testo originale di LS), `legacy-extras` (log vecchi non collegati, mai persi), `complete`/`failed`, `reconcile-*`, `delta-import`, `restore`, `conflict-resolved` (con le due versioni), `legacy-cloud-import` |

## 3. Relazioni
`logs.plantUuid → plants.uuid` · `photos.plantUuid → plants.uuid` (null ammesso) · nessuna chiave esterna imposta dal browser: l'integrità è verificata in migrazione, ripristino e «Verifica dati».
Le foto di una pianta eliminata restano (non si cancellano dati dell'utente): compaiono nella Galleria senza pianta.

## 4. Migrazione dalla v9 (fatta una volta, poi idempotente)
1. Legge LS `grow-plants` e `Grow420DB` **senza modificarli**. Se illeggibili → annulla (Modalità sicura).
2. Controlla lo spazio (`navigator.storage.estimate`).
3. Registra inventario + testo originale di `grow-plants` in `migrationLog`.
4. Assegna UUID a piante e log (campo `uuid` *aggiunto*, nessun altro campo cambia), copia piante/log (da LS = fonte autentica), foto e promemoria **con gli stessi id**, dati condivisi.
5. Verifica: conteggi, insiemi di id, riferimenti, piante deep-equal, **contenuto di ogni foto uguale**. Se fallisce → svuota solo il DB v10 e resta in Modalità sicura.
6. Solo dopo: scrive gli UUID nella cache LS e registra `complete`.
Le righe del vecchio `db.logs` già presenti nel diario sono doppioni e non vengono copiate; quelle **non** presenti vengono conservate in `migrationLog.legacy-extras`.

## 5. Specchio per il rollback
Foto e promemoria creati/modificati/eliminati in v10 sono ripetuti (best effort) in `Grow420DB` con lo stesso id; le piante restano in LS (v9 ignora il campo `uuid`). Al rientro in v10 un *delta import* recupera foto/promemoria aggiunti in v9.

## 6. Sync — modello
- **Push**: per ogni voce in coda: `insert` (version 1) se `synced=0`, altrimenti `update … where id=? and version=synced` con `version=synced+1`. 0 righe aggiornate = qualcuno ha cambiato prima → si legge la riga remota: contenuto uguale → adotta; diverso → **conflitto**.
- **Pull**: `select where server_seq > cursore order by server_seq limit 200` per tabella (ordine: piante, log, foto, promemoria, impostazioni). Riga remota con modifica locale non inviata: contenuto uguale → ok; diverso → conflitto.
- **Applicazione remota** (`DL.remoteApply`): sezione critica che ricostruisce LS senza perdere modifiche fatte nel frattempo (merge a 3 vie per pianta/log; stesso campo cambiato in due punti → conflitto).
- **Foto**: upload su `photos/<user_id>/<uuid>.jpg`, impronta SHA-256 dei byte; al download l'impronta è verificata: file non corrispondente = rifiutato, ciclo in errore, nulla salvato.
- **Cancellazioni**: tombstone (`deleted_at`); `DELETE` non è concesso nemmeno al proprietario. Eliminazione foto → file rimosso dallo Storage.
- **Conflitti**: riga in `syncMeta`, voce di coda in stato `conflict` (non parte), UI di confronto, scelta registrata in `migrationLog`.
- Limite teorico: `server_seq` è assegnato alla scrittura, non al commit; con transazioni concorrenti dello stesso utente (praticamente impossibile con questa app) un cursore potrebbe saltare una riga. Se un giorno servisse: finestra di sovrapposizione.

## 7. Supabase (vedi `supabase/01_schema.sql`)
Tabelle `plants, logs, photos, reminders, settings` con `user_id uuid default auth.uid()`, chiave `(user_id, id)`, `version`, `server_seq`, `deleted_at`; trigger `sync_touch` (server_seq, version=1 all'inserimento, update solo con `version = precedente+1`, `user_id` immutabile); RLS attiva **e forzata**; policy `select/insert/update` limitate a `user_id = auth.uid()` per `authenticated`; `anon` senza accesso; nessun `delete`; bucket privato `photos` con policy sulla cartella `<user_id>/`.
Scelta consapevole: **COA e community** sono righe di `settings` (`grow-coa`, `grow-community`) e non tabelle a sé: oggi sono liste locali dell'utente. Una tabella `community` dedicata servirà quando ci saranno contenuti condivisi tra utenti (RLS diversa).
