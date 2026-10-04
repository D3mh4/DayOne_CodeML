# DayOne_CodeML

Agent de type WhatsApp, hors ligne d'abord, qui transforme la photo d'une page de registre maternel papier en dossier structuré, vérifié par la sage-femme.

- `mobile/` : app Expo (React Native, TypeScript, NativeWind, SQLite)
- `backend/` : API FastAPI qui appelle Gemini pour l'extraction
- `data/` : données synthétiques des organisateurs, **non versionnées** (repo public). Les télécharger depuis le
  [Drive du défi](https://drive.google.com/drive/folders/1RtBBVDkPFfMiouPEry2Ogzu26Odh8JUF?usp=sharing) dans `data/` (ne pas les modifier)

## Lancer le backend

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate        # Windows (macOS/Linux : source .venv/bin/activate)
pip install -r requirements.txt
cp .env.example .env          # puis mettre GEMINI_API_KEY, ou EXTRACTION_PROVIDER=mock pour ne rien appeler
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
python -m pytest tests
```

`EXTRACTION_PROVIDER=mock` renvoie des données factices **marquées comme simulées** (aucun coût API). En mode `gemini`, une erreur d'extraction renvoie un HTTP 502 : le mobile garde la photo en `echec_traitement` et la renvoie au prochain retour réseau. Aucune donnée inventée.

## Lancer le mobile

```bash
cd mobile
npm install
npx expo start
```

- Émulateur Android : rien à configurer (le backend est joint via `10.0.2.2:8000`).
- Vrai téléphone avec Expo Go : créer `mobile/.env` avec `EXPO_PUBLIC_API_URL=http://<IP-LAN-du-PC>:8000`.
- Le bouton wifi dans l'en-tête simule une coupure réseau pour la démo.
- Dans l'appareil photo, le bouton « document » envoie une vraie page du registre synthétique (utile sur émulateur).

## Cycle de vie d'un enregistrement

`capture → en_attente_ia → traite_ia | a_reviser → valide → patiente_liee → enregistre → synchronise`,
plus les échecs `echec_traitement`, `echec_synchronisation`, `doublon_suspecte`, `revision_manuelle_requise`.
Statuts par champ : `connu`, `inconnu`, `non_fourni`, `illisible`, `non_applicable`, `a_reviser`.

## Limites connues (à faire)

- Le schéma de champs est provisoire : il ne correspond pas encore aux 8 pages du registre (`data/Paper Registry`).
- Liaison patiente par code, sessions multipages, saisie manuelle complète sans IA, synchronisation serveur : pas encore faits.
- SQLite et photos pas encore chiffrés (prévu : SQLCipher via `expo-sqlite`, ce qui demande un development build).
- Pas encore de script d'évaluation de l'extraction contre les valeurs de référence.
