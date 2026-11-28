# Pubblicazione, configurazione Supabase e rollback

## A. Configurazione Supabase (una sola volta, ~10 minuti)
1. **Authentication → Providers → Email**: attiva *Enable Email provider* e **Confirm email = ON** (necessario: l'app sincronizza solo dopo la verifica). Lascia disattivati gli altri metodi: accesso solo email+password.
2. **Authentication → URL Configuration**: *Site URL* = `https://enea-tech.github.io/mysteryOFgrowing/` ; in *Redirect URLs* aggiungi lo stesso indirizzo.
3. **Authentication → Policies/Passwords**: lunghezza minima 8 (l'app la richiede già).
4. **SQL Editor** → incolla ed esegui `supabase/01_schema.sql` (si può rilanciare senza danni). Poi esegui `supabase/03_verify_rls.sql`: devi vedere `rls_on = true` per le 5 tabelle, nessuna riga nei controlli 2, solo `INSERT,SELECT,UPDATE` per `authenticated`, bucket `photos` con `public = false`.
5. Nel frontend ci sono solo `SUPABASE_URL` e la chiave **anon** (pubblica per progettazione). **Non mettere mai la chiave `service_role` nel sito.**
6. **Più avanti, dopo aver importato i vecchi dati cloud su tutti i dispositivi**: esegui `supabase/02_legacy_lockdown.sql` per chiudere la vecchia tabella `grow_sync` (oggi leggibile da chiunque conosca l'id). Non cancella nulla.

## B. Pubblicazione su GitHub Pages (come sempre)
1. Nella repo `mysteryOFgrowing` sostituisci **`index.html`, `sw.js`, `manifest.json`** con quelli dello zip (la cartella `assets/` non cambia). Il resto dello zip (`docs/`, `supabase/`, `tests/`) è da conservare, non serve pubblicarlo.
2. Commit + push. Dopo 1–2 minuti apri il sito.
3. Primo avvio: l'app migra da sola (di solito < 2 s). Poi **☰ → Account & Sync** non serve subito: l'app funziona identica anche senza account.
4. Subito dopo la prima apertura: **Journal → 📥 Backup completo (V2)** e conserva il file; poi **🛡️ Verifica dati** deve dire «Tutto coerente».
5. Aggiornamenti futuri: comparirà il banner «Nuova versione disponibile» → *Aggiorna* (scrive i dati in coda e poi attiva).
6. Primo collegamento: **Account & Sync → Crea account** → apri il link nell'email → torna e **Accedi**. Sul primo dispositivo parte il caricamento; sul secondo, se ha già dati, l'app chiede *Unisci* / *Usa il cloud*.

## C. Rollback alla v9 (i tuoi dati restano)
1. Ripubblica i file della v9.1 (`grow420-v9.1.zip`): `index.html`, `sw.js`, `manifest.json`.
2. Riapri l'app (se vedi la v10 chiudi e riapri la PWA una volta).
3. La v9 legge LocalStorage (le piante, con un campo `uuid` in più che ignora) e `Grow420DB` (foto e promemoria, aggiornati anche con quanto fatto in v10). **Non cancellare nulla dai dati del sito** e non usare «Cancella dati» del browser.
4. Per tornare alla v10: ripubblica la v10; le foto/promemoria aggiunti in v9 vengono recuperati da soli.
Se qualcosa non torna in v10 ma i dati servono: **Account & Sync → Backup completo** o, in assenza di app funzionante, i file `grow420-copia-prima-…json` e i backup V2 scaricati.

## D. Se l'app mostra «Modalità sicura»
Significa che la migrazione non ha superato un controllo: **i tuoi dati sono intatti nel formato v9** e l'app continua a funzionare (foto, promemoria, diario). Esporta il backup v1 dal menù ☰ e scrivimi il messaggio che compare in «Verifica dati».
