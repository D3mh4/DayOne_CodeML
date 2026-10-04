# DayOne_CodeML

Prototype d'agent conversationnel de type WhatsApp, **hors ligne d'abord**, permettant aux sages-femmes en milieux à faibles ressources de photographier des registres de maternité papier, de stocker les fiches localement dans SQLite, d'extraire les données médicales structurées via l'IA au retour de la connexion, et de relier les visites au profil continu de chaque patiente.

- `mobile/` : Application mobile React Native Expo (TypeScript strict, NativeWind, SQLite local).
- `backend/` : Serveur FastAPI Python (Google Gemini Multimodal + Groq Vision + règles de vraisemblance médicale).
- `data/` : Jeu de données synthétiques officiel du défi (80 pages de livret, 129 images).

---

## 🔑 1. Configuration des clés API (Plans 100% Gratuits)

Le backend supporte **Google AI Studio (recommandé)** et **Groq Vision**, avec bascule automatique.

### Option A : Google AI Studio (Recommandé — 500 requêtes gratuites/jour)
1. Rendez-vous sur **[Google AI Studio](https://aistudio.google.com/apikey)** avec un compte Google/Gmail personnel.
2. Cliquez sur **« Create API key »** ➔ **« Create API key in new project »**.
3. Copiez votre clé (elle commence par `AIzaSy...`).
4. Ouvrez `backend/.env` et renseignez :
   ```env
   GEMINI_API_KEY=AIzaSyVotreCleIci...
   GEMINI_MODEL=gemini-3.5-flash-lite
   EXTRACTION_PROVIDER=auto
   ```
   > 💡 **Pourquoi `gemini-3.5-flash-lite` ?** Sur le plan gratuit Google AI Studio, ce modèle offre **500 requêtes gratuites par jour** (contre seulement 20 requêtes pour Gemini 3.8 Flash), avec une exactitude mesurée de **99.1 %** sur notre jeu de test.

### Option B : Groq Vision (Alternative)
1. Rendez-vous sur **[Groq Console](https://console.groq.com/keys)** et créez un compte gratuit.
2. Générez une clé d'API (elle commence par `gsk_...`).
3. Dans `backend/.env` :
   ```env
   GROQ_API_KEY=gsk_VotreCleIci...
   GROQ_MODEL=llama-3.2-11b-vision-preview
   EXTRACTION_PROVIDER=groq
   ```

---

## 🚀 2. Lancer l'application (Pas à pas)

### Étape 1 : Démarrer le Backend (FastAPI)
```bash
cd backend
./run_server.sh
```
*(Le script active automatiquement le `.venv` et démarre Uvicorn sur `http://0.0.0.0:8000`).*

Vérifiez que le serveur répond :
```bash
curl http://localhost:8000/health
```

### Étape 2 : Démarrer le Mobile (Expo / React Native)
```bash
cd mobile
npm install
npx expo start -c
```
1. Ouvrez l'application **Expo Go** sur votre téléphone (iOS ou Android), connecté sur le **même réseau Wi-Fi** que votre ordinateur.
2. Scannez le QR Code affiché dans le terminal.
3. *Astuce vrai téléphone :* si l'IP n'est pas détectée automatiquement, créez `mobile/.env` avec :
   ```env
   EXPO_PUBLIC_API_URL=http://<IP-LOCALE-DE-VOTRE-PC>:8000
   ```

---

## 🔄 3. Comment vider le cache et tester de A à Z ?

Pour repartir d'un chat totalement vierge et retester tout le workflow de zéro :

### Méthode 1 : Directement dans le chat (Recommandé — Instantané) ⚡
1. Dans la barre de message en bas de l'application, tapez simplement :
   > **`reset`** ou **`vider`**
2. Le bot vous demandera confirmation via une puce WhatsApp.
3. Cliquez sur **`[🗑️ Confirmer l’effacement]`**.
4. Toute la base locale SQLite et les photos locales sont effacées, et l'application repart sur son écran d'accueil d'origine !

### Méthode 2 : Vider le cache Expo (Metro Bundler)
Dans votre terminal mobile :
```bash
npx expo start -c
```
*(L'option `-c` vide tout le cache JavaScript et recharge les composants).*

### Méthode 3 : Sur le téléphone physique (Expo Go)
- **Sur Android :** Paramètres du téléphone ➔ Applications ➔ Expo Go ➔ Stockage ➔ **« Vider les données »** et **« Vider le cache »**.
- **Sur iOS :** Supprimez et réinstallez Expo Go si vous souhaitez purger le conteneur sandboxed d'iOS.

---

## 💬 4. Le Workflow 100% Conversationnel (Zéro Popup)

Toutes les interactions se font **exclusivement par messages WhatsApp et boutons de réponses rapides** :

1. **Capture & Mode Hors Ligne :**
   - Le bouton Wi-Fi dans l'en-tête permet de simuler une coupure réseau.
   - Les photos prises hors ligne sont enregistrées dans SQLite sous le statut `en_attente_ia`.
   - Au retour du réseau, la synchronisation s'exécute automatiquement en arrière-plan.

2. **Extraction & Signalement des doutes :**
   - L'IA extrait les données selon le schéma strict de la page (8 pages supportées).
   - Les règles médicales ([`plausibility.py`](backend/app/services/plausibility.py)) détectent les incohérences (ex. poids en kg au lieu de g, tension anormale).
   - L'agent pose des questions de suivi ciblées dans le chat pour chaque doute.

3. **Correction conversationnelle :**
   - En cliquant sur `[Corriger]` ou en tapant `corriger`, le bot affiche la liste numérotée des champs.
   - La sage-femme tape le numéro (ex: `5`) ou le nom (`poids`).
   - Un algorithme déterministe valide la nouvelle saisie médicale et met à jour le dossier en temps réel.
   - Tapez `annuler` à tout moment pour revenir en arrière.

4. **Liaison Patiente (Patient Matching) :**
   - Dès la validation de la fiche, le bot propose :
     * `1. Patiente existante A`
     * `2. Patiente existante B`
     * `3. ➕ Créer nouveau profil`
     * `4. ❓ Classer sans lier`
   - Le statut passe à `patiente_liee` puis `enregistre`.

5. **Sessions Multi-pages :**
   - L'agent propose immédiatement d'ajouter la page suivante du livret (`[📸 Ajouter une page]` ou `[🏁 Terminer]`).

6. **Saisie Manuelle Complète :**
   - Accessible via le trombone d'attachements (`Saisie manuelle`) ou en tapant `manuel` dans le chat pour saisir une fiche sans appareil photo.

7. **Commandes disponibles dans le chat :**
   - `info` ou `aide` : affiche le guide complet des commandes et raccourcis.
   - `setting` ou `parametres` : ouvre le menu de réglages conversationnel (choix de langue FR/EN et configuration de clé API personnalisée Google AI Studio / Groq).
   - `patient` ou `dossier` : consulte les patientes enregistrées, détaille les fiches associées avec possibilité de modification, suppression et navigation retour.
   - `stats` ou `dashboard` : affiche le tableau de bord épidémiologique anonymisé (taux VIH/Syphilis/Hépatite C, constantes maternelles, poids de naissance).
   - `lang en` / `lang fr` : bascule instantanément la langue de l'interface et de l'assistant (Français / Anglais).
   - `photo` : déclenche la prise de photo du livret.
   - `manuel` : démarre la saisie guidée pas à pas sans caméra.
   - `corriger` : liste les champs de la fiche pour modification déterministe.
   - `confirmer` : valide la fiche en cours.
   - `annuler` : annule n'importe quelle action ou saisie en cours.
   - `reset` ou `vider` : efface l'intégralité des fiches, des patientes et des photos pour repartir d'un dispensaire vierge (les clés API et réglages restent préservés).

---

## ⚙️ 5. Menu « Setting » & Clé API Personnalisée (Client Mobile)

Dans l'esprit 100% conversationnel (sans aucun formulaire popup), la commande `setting` permet de personnaliser l'application :

1. **Choix de la langue de l'agent :**
   - Tapez `1` (ou `langue`) pour basculer entre **Français** et **English**.
   - Le choix est persisté en base locale SQLite et réutilisé à chaque réouverture de l'application.

2. **Saisie d'une clé API personnalisée :**
   - Tapez `2` (ou `api`) pour accéder au sous-menu API :
     * `1. Google AI Studio` (Gemini Flash)
     * `2. Groq` (Llama 3.2 Vision)
     * `3. Voir la configuration actuelle` (affichage masqué type `AIzaSy...4x9q`)
     * `4. Réinitialiser` (revenir aux identifiants `.env` du serveur backend)
     * `5. Retour`
   - **Résistance absolue au `reset` :** La clé API est stockée dans une table isolée `app_setting` de SQLite. Lorsque la commande `reset` est lancée pour réinitialiser les données de santé et les photos, **la clé API et les préférences linguistiques ne sont jamais supprimées**.
   - **Priorité client :** Dès qu'une clé personnalisée est enregistrée, le mobile la transmet automatiquement dans chaque requête d'extraction IA (`custom_api_key`), court-circuitant ainsi les quotas du serveur de démo pour utiliser votre propre quota gratuit.

---

## 💡 Focus : La liaison patiente et l'option « 4. ❓ Classer sans lier »

Dans la section **5. Tâche demandée aux participants (Tâche 6)** du sujet officiel :
> *« Implémenter la liaison patiente : rattacher chaque nouvelle visite au profil existant par le code de la sage-femme ; proposer les correspondances possibles sans jamais créer automatiquement une patiente quand une correspondance est plausible ; offrir [Patiente 1] [Patiente 2] [Aucune, créer] [Je ne sais pas]. »*

Notre application respecte scrupuleusement cette exigence :
1. `[1. Patiente A]` & `[2. Patiente B]` : correspondances probables identifiées par l'algorithme (basé sur le numéro ou village).
2. `[3. ➕ Créer un nouveau profil]` : crée un nouvel identifiant anonyme généré aléatoirement (`PAT-xxx`).
3. `[4. ❓ Classer sans lier (Je ne sais pas)]` :
   - **Pourquoi cette option existe ?** Sur le terrain, une sage-femme peut photographier une page où le code est tronqué, ou douter de l'identité de la patiente. Le cahier des charges interdit formellement d'inventer une patiente ou de forcer un rattachement incertain.
   - **Comportement :** La fiche médicale est sauvegardée en toute sécurité dans SQLite avec `patient_id = null`. Elle apparaît dans le dossier `📄 Fiches non liées` où la sage-femme peut la retrouver, la consulter, la modifier ou la rattacher ultérieurement.

---

## 🏆 Bonus officiels du défi implémentés

Conformément à la section **8. Bonus (facultatif)** du sujet :
1. **Interface bilingue Français / Anglais :** Taper `lang en` ou `lang fr` (ou cliquer sur la puce de langue) bascule instantanément tout l'assistant, les invites et les boutons.
2. **Tableau de bord épidémiologique anonymisé :** Taper `stats` ou `dashboard` agrège en temps réel les indicateurs clés (dépistage VIH/Syphilis/Hépatite C, tension artérielle moyenne, poids moyen des nouveau-nés, % césariennes vs voies basses).
3. **Contrôle de la qualité d'image sur l'appareil :** Alerte bienveillante immédiate dans le chat si la photo capturée est sombre ou trop basse résolution avant traitement.

---

## 📊 5. Évaluation de la précision (Banc de test officiel)

Le banc de test mesure l'exactitude champ par champ contre la vérité terrain :
```bash
cd backend
python -m evaluation.evaluate --pages 1-8 --run-name complet
```
- **Exactitude globale : 99.1 %**
- **Exactitude sur les champs remplis : 98.7 %**
- **Reconnaissance du type de page : 100.0 %** (8 types de pages sur 8)
- **Exactitude des statuts de champs : 100.0 %**
- **Valeurs inventées / hallucinations : 0**
- Rapport complet détaillé dans `data/eval_runs/complet/rapport.md`.

---

## 🔒 Confidentialité & Sécurité
- **Zéro identifiant direct :** Aucun nom de femme, nom du conjoint, numéro national (CIN), téléphone ou adresse n'est jamais collecté, demandé à l'IA ou stocké dans la base locale.
- Les identifiants patientes (`PAT-xxx`) sont générés automatiquement de façon aléatoire et anonyme.
