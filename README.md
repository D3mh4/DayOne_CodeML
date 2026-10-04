# DayOne_CodeML

Agent conversationnel de type WhatsApp, **hors ligne d'abord**, pour les sages-femmes : on photographie une page du registre maternel papier, l'IA la transforme en fiche structurée (valeur, statut et confiance par champ), la sage-femme vérifie dans le chat, et les visites sont reliées au dossier de chaque patiente. Le registre papier reste l'outil de référence.

- `mobile/` : application Expo / React Native (TypeScript, NativeWind, SQLite local). C'est le prototype.
- `backend/` : API FastAPI (Python) qui fait l'extraction avec Gemini (Groq en secours) et les contrôles de vraisemblance. Le backend ne stocke aucune donnée.
- `data/` : données synthétiques des organisateurs, **non versionnées** (dépôt public). À télécharger depuis le
  [Drive du défi](https://drive.google.com/drive/folders/1RtBBVDkPFfMiouPEry2Ogzu26Odh8JUF?usp=sharing) dans `data/` (ne pas les modifier).

---

## 1. Installation et lancement

### Clé API (plans gratuits)
- **Google AI Studio (recommandé)** : créer une clé sur https://aistudio.google.com/apikey (elle commence par `AIzaSy`).
- **Groq (secours, optionnel)** : https://console.groq.com/keys (clé `gsk_...`).

```bash
cd backend
cp .env.example .env
```
Dans `backend/.env` :
```env
GEMINI_API_KEY=AIzaSy...votre_cle
GEMINI_MODEL=gemini-3.5-flash-lite
EXTRACTION_PROVIDER=auto          # auto = Gemini puis Groq ; mock = données simulées sans IA
```
`gemini-3.5-flash-lite` a le plus gros quota gratuit (~500 requêtes/jour). Si le modèle configuré est saturé (429/503), le backend essaie automatiquement les modèles suivants de sa liste.

### Backend
```bash
cd backend
./run_server.sh                    # macOS/Linux : crée le .venv si besoin et lance le serveur
# Windows : python -m venv .venv && .venv\Scripts\activate && pip install -r requirements.txt
#           uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
curl http://localhost:8000/health  # doit indiquer ai_service_configured: true
python -m pytest tests             # tests du backend
```

### Mobile
```bash
cd mobile
npm install
npx expo start -c
```
Ouvrir **Expo Go** sur un téléphone connecté au **même Wi-Fi** que l'ordinateur, puis scanner le QR code. L'adresse du backend est détectée automatiquement ; sinon créer `mobile/.env` avec `EXPO_PUBLIC_API_URL=http://<IP-du-PC>:8000`.
Le bouton Wi-Fi en haut de l'écran **simule une coupure réseau** (pour la démo hors ligne).

### Repartir de zéro
Taper `reset` dans le chat, puis confirmer : fiches, patientes et photos locales sont effacées (la langue et la clé API sont conservées).

---

## 2. Cycle de vie d'un enregistrement

```
Photo prise ──► copiée dans le stockage de l'app + fiche SQLite  [en_attente_ia]
                     │
     réseau absent ──┴──► reste en file sur le téléphone ; envoi automatique au retour du réseau
                     │      (réel ou simulé) ou en touchant « N en attente IA » dans l'en-tête
     réseau présent ─┴──► envoi au backend : 1) type de page  2) extraction des champs  3) contrôles
                     │
          échec ─────┴──► [echec_traitement] (serveur injoignable, quota, page non reconnue) :
                     │      la photo n'est jamais perdue, elle est renvoyée au prochain retour réseau
          succès ────┴──► [traite_ia] aucun doute  |  [a_reviser] doutes → questions une par une
                     │
     « Confirmer » ──┴──► [valide] ──► liaison patiente ──► [enregistre] dans le dossier patiente
                                                        ──► « page suivante » ou « terminer le livret »
                                                            (retour au menu, fil de conversation vidé)
```
- **Reprendre la photo** remplace l'image d'une fiche et la renvoie en file `en_attente_ia`.
- **Saisie manuelle** (sans photo, si l'IA est indisponible) crée directement une fiche `valide`.
- Une fiche enregistrée reste modifiable champ par champ depuis `patients`.
- Une seule fiche est vérifiée à la fois : si plusieurs pages reviennent du serveur en même temps, les suivantes attendent (bouton « Vérifier la fiche suivante »).

Statuts de champ : `connu`, `inconnu`, `non_fourni`, `illisible`, `non_applicable`, `a_reviser`.

---

## 3. Choix de conception

### Schéma d'abord, pas d'OCR générique
Le schéma des **8 pages du livret** est dans [backend/app/schemas/registry_pages.py](backend/app/schemas/registry_pages.py) : couverture, identification et antécédents, grossesse actuelle (9 colonnes de visites), accouchement, post-partum précoce et tardif (mère et nouveau-né). Il génère le schéma JSON imposé à Gemini et sert à lire la vérité terrain du PDF.

### Extraction en 2 étapes, puis contrôles
1. Gemini reconnaît le type de page, puis remplit le schéma de cette page (valeur, confiance, statut).
2. Le backend remet les cases à cocher au bon format (oui/non, options).
3. Il applique des **règles de vraisemblance** ([plausibility.py](backend/app/services/plausibility.py)) : unités (poids « 3.5 » → des kg ?), tension, dates.
4. Il applique des **contrôles de cohérence** entre champs : date prévue ≈ DDR + 280 jours, âge gestationnel cohérent avec la date de visite, parité ≤ gestité.

Une lecture douteuse passe `a_reviser` avec une raison, et l'agent pose la question. La confiance déclarée par Gemini est presque toujours ~0.99 : ces contrôles sont notre vrai signal de doute.

### Pas d'entraînement ni de fine-tuning
80 pages synthétiques suffisent pour **mesurer**, pas pour entraîner : un modèle entraîné dessus risquerait d'apprendre le rendu synthétique et d'échouer sur une vraie photo. Gemini lit aussi bien les vraies photos du livret (`1-x.jpg`).

### Pourquoi un backend
- La clé API ne vit pas dans l'application.
- Le prompt, le schéma et les règles se modifient sans republier l'app.
- On peut changer de fournisseur IA (Gemini, Groq).
- Le banc d'évaluation réutilise exactement le même code.

### Hors ligne d'abord
Tout est stocké sur le téléphone (SQLite et photos). Le réseau ne sert qu'à l'extraction IA. Un échec n'efface jamais rien et ne remplace jamais une vraie lecture par des données inventées : le serveur renvoie une erreur et la photo reste en file.

### Multi-pages et re-numérisation
Les pages d'un même livret sont regroupées **par patiente** (dossier patiente). Si une page est mal lue, la sage-femme corrige les champs ou **reprend la photo**, qui remplace la lecture précédente. C'est plus simple sur le terrain que de comparer deux lectures.

### Liaison patiente
Après validation, l'agent propose :
- les profils proches ;
- « créer un nouveau profil » ;
- « je ne sais pas » (la fiche est classée dans « Fiches non liées »).

On peut aussi **taper le code patiente écrit sur le registre** : l'agent rattache la fiche au profil qui a ce code, ou crée le profil avec ce code. Aucun profil n'est créé sans choix explicite. Les identifiants internes sont aléatoires, jamais dérivés de données personnelles.

### Confidentialité
Aucun nom, nom du mari, CIN, adresse ou téléphone dans le schéma : ils ne sont ni demandés à l'IA, ni stockés dans les champs.

---

## 4. Utilisation (tout se fait dans le chat)
- `photo` ou le bouton caméra : photographier une page. Le trombone 📎 ouvre la galerie, la page de démo et la saisie manuelle.
- `patients` : dossiers patientes, triés par modification récente, 8 par page (`suivant` / `précédent`). Depuis un document : modifier un champ, renommer, supprimer.
- `corriger`, `confirmer`, `annuler` (annule l'action en cours et revient au menu).
- `stats` : tableau de bord anonymisé (tension, température, VIH / syphilis, poids de naissance, césariennes).
- `setting` : langue (FR / EN) et clé API personnelle (masquée à l'écran, conservée après `reset`).
- `info` : liste des commandes.

---

## 5. Évaluation de la précision

```bash
cd backend
python -m evaluation.ground_truth                                        # vérité terrain depuis le PDF
python -m evaluation.evaluate --pages 1-80 --run-name complet --sleep 4  # pages en échec réessayées à la relance
python -m evaluation.degrade_images                                      # copies floues / inclinées / sombres
python -m evaluation.evaluate --pages 1-80 --images ../data/degraded --run-name degrade
```
**Simuler des photos de terrain.** Les images fournies sont des rendus propres, alors que la consigne annonce des photos floues, ombrées, inclinées et mal éclairées. [degrade_images.py](backend/evaluation/degrade_images.py) fabrique donc une copie « photo de téléphone » de chaque page, sans toucher aux originaux :
- inclinaison aléatoire ;
- baisse de luminosité et de contraste ;
- ombre en dégradé (main ou téléphone au-dessus de la page) ;
- flou de mise au point ;
- bruit de capteur ;
- résolution réduite et forte compression JPEG.

La vérité terrain reste valable pour ces copies : on mesure ainsi la robustesse sur des photos réalistes avec le même script de score. Les 5 vraies photos du livret (`1-x.jpg`) servent de test qualitatif.

Le rapport (`data/eval_runs/<run>/rapport.md`) donne, par type de page, l'exactitude par champ, l'exactitude sur les seuls champs remplis, les statuts, les valeurs inventées et la part des erreurs signalées par l'agent.

**Résultat mesuré sur la patiente 1 (8 pages, 465 champs, `gemini-3.5-flash-lite`)** :
- 99,1 % d'exactitude par champ ;
- 98,7 % sur les champs remplis ;
- 100 % des statuts corrects ;
- 100 % des types de page reconnus.

Le banc a également été lancé sur les 80 pages (10 écritures différentes) et sur les copies dégradées : les rapports sont générés dans `data/eval_runs/complet/` et `data/eval_runs/degrade/`.

Particularités du jeu de données :
- les 129 images correspondent à 80 pages uniques (10 patientes × 8 pages), dont 44 doublons exacts, plus 5 vraies photos sans vérité terrain ;
- pour 4 patientes, la police manuscrite n'a pas les glyphes « é » et « — » (absents du PDF **et** de l'image). L'évaluation accepte les deux lectures ;
- le CSV de 200 lignes n'est pas lié aux 10 patientes ;
- aucune page ne contient d'arabe.

---

## 6. Limites connues
- **Chiffrement local : prévu dès le départ, volontairement reporté après l'UX.** Pour ce MVP, la base SQLite et les photos sont dans le stockage privé de l'application (inaccessible aux autres applications), mais pas encore chiffrées. Nous avons choisi de prioriser l'expérience de la sage-femme et la fiabilité hors ligne. L'ajout est simple et localisé :
  - `expo-sqlite` intègre SQLCipher : il suffit d'activer l'option dans `app.json` et d'ouvrir la base avec une clé ;
  - la clé est générée au premier lancement et gardée dans le coffre sécurisé du téléphone (`expo-secure-store`) ;
  - les photos se chiffrent au moment de leur copie dans le stockage de l'application.
  
  Le reste du code ne change pas. Seule contrainte : SQLCipher demande un *development build* Expo (plutôt qu'Expo Go), ce qui est le passage normal vers une application de production.
- **La photo originale contient les identifiants imprimés sur le registre.** Elle est gardée localement (exigence du défi) et envoyée au fournisseur IA pour l'extraction. C'est acceptable avec des données synthétiques ; avec des données réelles, il faudrait un modèle hébergé localement ou un caviardage avant l'envoi.
- **Pas d'accès par rôle à l'image, ni d'identifiant de sage-femme** enregistré avec la fiche.
- **Statuts déclarés mais non utilisés.** Le modèle de données prévoit tout le cycle du défi, mais l'app n'utilise pas `capture`, `patiente_liee`, `synchronise`, `echec_synchronisation`, `doublon_suspecte` et `revision_manuelle_requise`. En particulier, il n'y a pas de serveur central qui recevrait les fiches validées : elles restent sur le téléphone.
- **Une erreur définitive** (page non reconnue) est réessayée à chaque retour réseau au lieu d'être mise de côté.
- **Écriture arabe** prise en charge par Gemini mais non mesurée, faute de données.
- **Le contrôle de qualité d'image** est simple : il signale une photo trop petite ou trop sombre.
