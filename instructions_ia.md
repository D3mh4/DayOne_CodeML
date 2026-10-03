# 📄 CONTEXTE ET DIRECTIVES POUR L'AGENT IA

**Rôle de l'IA :** 
Tu es un développeur Full-Stack expert en React Native et Python. Ton objectif est de m'aider à construire un prototype pour un hackathon (Défi CodeML). L'application permet à des sages-femmes dans des milieux à faibles ressources de photographier des registres papier, de stocker les données hors ligne, puis d'extraire les informations via une IA lorsque la connexion internet revient, le tout dans une interface imitant WhatsApp.

## 🛠️ Stack Technologique
*   **Frontend Mobile :** React Native (Expo), TypeScript, NativeWind (pour le styling utilitaire).
*   **Base de données locale :** SQLite (chiffré si possible, pour le stockage hors ligne).
*   **Backend :** Python, FastAPI.
*   **Extraction IA :** API Google Gemini (via `google-generativeai`) pour l'analyse multimodale gratuite.

## ⚠️ Règles de code strictes
1.  **Formatage des variables :** Utilise exclusivement des lettres minuscules avec des underscores (`snake_case`) pour nommer les variables (ex: `patient_id`, `status_code`, jamais de camelCase comme `patientId` pour les variables internes et la base de données).
2.  **Types :** Utilise TypeScript de manière stricte sur le frontend et Pydantic sur le backend.
3.  **UI/UX :** Le design doit reprendre les codes visuels de WhatsApp (bulles de chat vertes/blanches, input en bas, header vert).
4.  **Découpage :** Ne génère pas tout le projet d'un coup. Attends mes instructions pour passer d'une étape à l'autre.

---

## 🚀 FEUILLE DE ROUTE (MARCHE À SUIVRE)

### Étape 1 : Initialisation et Interface Conversationnelle (Frontend)
*   Configurer un projet Expo avec NativeWind et TypeScript.
*   Créer un écran principal de messagerie (`chat_screen`).
*   Intégrer une librairie de chat (comme `react-native-gifted-chat` ou concevoir des composants sur mesure via NativeWind).
*   Ajouter un bouton d'appareil photo dans la barre de saisie.

### Étape 2 : Modèle de Données et Stockage Hors Ligne (SQLite)
*   Créer le schéma SQLite local.
*   Table `record` (champs : `id`, `patient_id`, `image_uri`, `status`, `extracted_data`, `created_at`).
*   Les statuts obligatoires (`status`) : `capture`, `en_attente_ia`, `traite_ia`, `a_reviser`, `valide`.
*   Implémenter la fonction pour sauvegarder le chemin de la photo localement et insérer la ligne avec le statut `en_attente_ia`.

### Étape 3 : Capture Photo et File d'Attente
*   Intégrer `expo-camera` pour prendre une photo directement depuis le chat.
*   Afficher une bulle de message système : "Photo capturée, en attente de réseau..." si l'appareil est hors ligne.
*   Utiliser `@react-native-community/netinfo` pour écouter le retour de la connexion internet.

### Étape 4 : Backend FastAPI et Intégration Gemini
*   Créer un endpoint POST `/extract_registry` en Python FastAPI.
*   Le script doit prendre l'image, construire un prompt contextuel (ex: "Tu es un assistant d'extraction médicale...") et l'envoyer à l'API Gemini (Flash 1.5 ou 2.0).
*   Forcer la sortie de Gemini en JSON structuré en utilisant Pydantic (basé sur le schéma du registre).
*   Associer à chaque champ extrait un niveau de confiance et un statut (`connu`, `inconnu`, `illisible`).

### Étape 5 : Synchronisation et Flux de Validation
*   Dès que le réseau est de retour, le mobile envoie l'image au backend FastAPI.
*   Le backend répond avec le JSON. Le statut de l'enregistrement SQLite passe à `traite_ia`.
*   L'agent conversationnel affiche une bulle avec les données extraites et trois boutons interactifs : **[Confirmer]**, **[Corriger]**, **[Reprendre]**.
*   Si un champ est marqué `illisible`, l'agent pose une question ciblée dans le chat (ex: "Le poids est illisible, pouvez-vous le saisir ?").