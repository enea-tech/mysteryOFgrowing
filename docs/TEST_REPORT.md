# GROW 420 v10 — Rapporto dei test

Tutti i test elencati come **ESEGUITO** sono stati realmente lanciati in questo ambiente (Chromium emulato mobile 390×844 con Playwright). I risultati grezzi sono in `tests/RISULTATI.txt`. Ciò che **non** ho potuto eseguire è elencato in fondo, senza giri di parole.

## Come sono stati provati i pezzi che dipendono da Supabase
- **Schema SQL**: eseguito su un vero PostgreSQL (PGlite = Postgres in WebAssembly) con ruoli `anon/authenticated` e `auth.uid()` ricreati. Le policy RLS, i trigger, i privilegi e le policy dello Storage sono quelli reali.
- **Sync**: l'app parla con un server di prova (`tests/mocksb.js`) che usa quel **database PostgreSQL reale** (stesso schema, stessa RLS, stessi trigger) dietro a una traduzione HTTP **scritta da me** di PostgREST + Auth + Storage. Il codice dell'app è identico a quello di produzione (stessa libreria `supabase-js`); cambia solo il server.
- **Due dispositivi** = due contesti browser separati (storage separato) collegati allo stesso account.

## Test obbligatori del brief
| # | Test | Esito | Dove |
|---|---|---|---|
| 1 | Migrazione completa (conteggi, ID, riferimenti, foto byte per byte, DB v9 intatto, idempotenza) | ESEGUITO ✅ 22/22 | `m1` |
| 2 | Import backup v1 (reale, esportato dalla v9) e v2 | ESEGUITO ✅ | `m3` |
| 3 | Export completo (manifest, conteggi, checksum, SHA-256 per foto, nessun token, backup incompleto segnalato) | ESEGUITO ✅ | `m3` |
| 4 | Integrità foto (migrazione, backup/ripristino, upload/download con SHA-256, file corrotto rifiutato) | ESEGUITO ✅ | `m1 m3 s1 s3` |
| 5 | Offline (scritture in coda, persistono al riavvio offline, app aperta offline da cache con SW reale) | ESEGUITO ✅ | `s2 p1` |
| 6 | Riconnessione (evento `online`, riapertura con coda persistita) | ESEGUITO ✅ | `s2` |
| 7 | Sync bidirezionale (log, foto, pianta, promemoria, dati condivisi) | ESEGUITO ✅ | `s1` |
| 8 | Due dispositivi (stesso account, ID identici, convergenza finale) | ESEGUITO ✅ (due contesti browser, **non** due telefoni) | `s1 s2` |
| 9 | Conflitti (pianta/log/promemoria; locale / cloud / entrambe; eliminato-vs-modificato; modifiche identiche; race durante l'applicazione) | ESEGUITO ✅ | `s2` |
| 10 | Cancellazioni (tombstone, nessun DELETE, foto con rimozione file, propagazione) | ESEGUITO ✅ | `s1 pg_sql` |
| 11 | Aggiornamento PWA (SW in attesa, banner, dati non ancora scritti salvati, DB intatto) | ESEGUITO ✅ 8/8 | `p1` |
| 12 | Rollback alla v9 (la v9 legge piante, foto — anche quelle scattate in v10 — e promemoria; ritorno con delta import) | ESEGUITO ✅ | `m2` |

## Elenco per suite
| Suite | Esito |
|---|---|
| `pg_sql` — schema SQL su Postgres reale: RLS, isolamento utenti, no DELETE, trigger versioni, Storage, idempotenza, lockdown legacy | 26/26 ✅ |
| `m1` — migrazione | 22/22 ✅ |
| `m2` — scritture via Data Layer, coda, soft delete, recupero da LS vuoto, rollback v9 | 11/11 ✅ |
| `m3` — backup V1/V2, validazione file manomessi, ripristino, modalità sicura | 26/26 ✅ |
| `s1` — Auth, primo push, secondo dispositivo, bidirezionale, cancellazioni, RLS tra utenti, sessione | 25/25 ✅ |
| `s2` — offline, ripresa, conflitti, race | 17/17 ✅ |
| `s3` — primo collegamento (scelta), import cloud legacy, foto corrotta, permessi negati, sessione scaduta, UI | 16/16 ✅ |
| `p1` — PWA: offline reale, aggiornamento controllato | 8/8 ✅ |
| `m4` — carico: 250 foto ≈ 75 MB: migrazione 2 s, backup 2,9 s, validazione 8 s, Galleria 0,3 s | 4/4 ✅ |
| Regressione app v9 (`t1 t2 t4 t5 t6 t7 t8 t9 v9b st2`): nessun errore JS in console; unici messaggi = 504 attesi dei test offline | ✅ |
**Totale suite v10: 155 controlli, 155 passati.**

## NON eseguito (da fare da te, al primo collegamento reale)
1. **Progetto Supabase reale**: invio e-mail di verifica/reset, comportamento di `Confirm email`, limiti di velocità, PostgREST/Storage reali. Il server di prova è una mia simulazione: differenze minori sono possibili (es. codici di errore). Procedura di controllo in `docs/PUBBLICAZIONE.md` §A.
2. **Telefoni reali / Safari iOS / WebKit**: provato solo Chromium. Da verificare su iPhone: installazione PWA, archiviazione persistente, foto da fotocamera, riapertura con coda.
3. **Pubblicazione su GitHub Pages reale** (percorso `/mysteryOFgrowing/` con Service Worker): provato in locale su `http://localhost`.
4. **Notifiche push / promemoria a app chiusa**: invariato rispetto alla v9, non testato.
5. **Carichi > 250 foto** e **sessioni con molte settimane di coda offline**.
6. **Due schede aperte contemporaneamente** sulla stessa app: la logica è pensata per funzionare (LocalStorage condiviso, lock `navigator.locks` sulla sync) ma **non ho un test dedicato**.
