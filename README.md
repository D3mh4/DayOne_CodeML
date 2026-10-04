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

Sur macOS/Linux, `./run_server.sh` crée le `.venv` si besoin et lance le serveur avec le bon Python
(sinon : erreur « cannot import name 'genai' »).

Fournisseurs (`EXTRACTION_PROVIDER` dans `backend/.env`) : `auto` (Gemini, plusieurs modèles si l'un est saturé,
puis Groq si `GROQ_API_KEY` est mise), `gemini`, `groq`, ou `mock`. `mock` (ou aucune clé) renvoie des données factices
**marquées comme simulées**. Si l'IA échoue, le serveur renvoie une erreur 502 : le mobile garde la photo en
`echec_traitement` et la renvoie plus tard. Jamais de données inventées à la place d'une vraie lecture.

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

## Extraction : schéma d'abord, pas d'OCR générique

Le schéma des 8 pages du livret est dans [backend/app/schemas/registry_pages.py](backend/app/schemas/registry_pages.py)
(couverture, identification et antécédents, grossesse actuelle avec 9 colonnes de visites, accouchement,
post-partum précoce et tardif pour la mère et le nouveau-né). Il est la source unique de vérité : il génère le schéma
JSON imposé à Gemini et sert à lire la vérité terrain dans le PDF.

Pour chaque photo : (1) Gemini reconnaît le type de page, (2) il remplit le schéma de cette page avec valeur,
confiance et statut par champ, (3) des règles de vraisemblance ([plausibility.py](backend/app/services/plausibility.py))
passent en `a_reviser` les lectures invraisemblables, avec une raison (ex. poids de naissance « 3.5 » : des kg ?).

**Pas d'entraînement ni de fine-tuning.** 80 pages propres (10 par type de page) suffisent pour mesurer,
pas pour entraîner : un modèle entraîné dessus risquerait d'apprendre le rendu synthétique et d'échouer sur une vraie
photo. Gemini n'a jamais vu ces pages, donc il lit aussi bien une photo réelle du livret (`1-x.jpg`).
Aucun identifiant direct (nom, nom du mari, CIN, adresse, téléphone) n'est dans le schéma : il n'est ni demandé, ni stocké.

## Évaluation de la précision

```bash
cd backend
python -m evaluation.ground_truth                     # vérité terrain depuis le PDF -> data/ground_truth.json
python -m evaluation.evaluate --pages 1-8 --run-name essai          # patiente 1 (2 appels Gemini par page)
python -m evaluation.evaluate --pages 1-80 --run-name complet --sleep 4
python -m evaluation.degrade_images                   # copies floues/inclinées/sombres -> data/degraded
python -m evaluation.evaluate --pages 1-80 --images ../data/degraded --run-name degrade
```

Le rapport (`data/eval_runs/<run>/rapport.md`) donne par type de page : exactitude par champ, exactitude sur les
seuls champs remplis, statut correct, valeurs inventées, et la qualité des doutes (part des erreurs que l'agent avait
signalées). Les réponses sont en cache : relancer ne repaie pas les appels.

La vérité terrain est lue dans la géométrie du PDF (texte imprimé vs police manuscrite, cases et coches à l'encre,
pages légèrement inclinées redressées) : 80 pages, 4 650 champs dont 2 467 remplis, aucune erreur de lecture.

Particularités du jeu de données constatées :
- les 129 images = 80 pages uniques (10 patientes × 8 pages) en PNG propres, dont 44 doublons exacts, + 5 vraies photos `1-x.jpg` du livret officiel (sans vérité terrain) ;
- pour 4 patientes, la police manuscrite n'a pas les glyphes « é » et « — » : ils sont absents du PDF **et** de l'image (« Ferm » pour « Fermé »). L'évaluation accepte les deux lectures ;
- le CSV de 200 lignes n'est pas lié aux 10 patientes du PDF : il sert de référence de plages de valeurs.

## Cycle de vie d'un enregistrement

`capture → en_attente_ia → traite_ia | a_reviser → valide → patiente_liee → enregistre → synchronise`,
plus les échecs `echec_traitement`, `echec_synchronisation`, `doublon_suspecte`, `revision_manuelle_requise`.
Statuts par champ : `connu`, `inconnu`, `non_fourni`, `illisible`, `non_applicable`, `a_reviser`.

## Limites connues (à faire)

- Liaison patiente par code, sessions multipages, saisie manuelle complète sans IA, synchronisation serveur : pas encore faits.
- SQLite et photos pas encore chiffrés (prévu : SQLCipher via `expo-sqlite`, ce qui demande un development build).
- Écriture arabe : prise en charge par Gemini et demandée dans la consigne, mais non mesurée (le jeu fourni ne contient aucun caractère arabe).
