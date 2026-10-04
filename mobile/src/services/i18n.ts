import { epidemiological_stats } from '../database/record_repository';

export type app_language = 'fr' | 'en';

export interface manual_entry_step {
  key: string;
  label: string;
  question: string;
  hint: string;
}

export const manual_entry_steps_by_lang: Record<app_language, manual_entry_step[]> = {
  fr: [
    {
      key: 'titre_document',
      label: 'Nom du document',
      question: '📝 Quel est le nom ou type de ce document médical ? (Obligatoire)',
      hint: 'Ex: Accouchement, Suivi prénatal, Surveillance post-partum, Carnet de santé...',
    },
    {
      key: 'numero_registre',
      label: 'Numéro de registre',
      question: 'Quel est le numéro de registre ou d’enregistrement ?',
      hint: 'Ex: 2026-823-001 ou PAT-823',
    },
    {
      key: 'date_visite',
      label: 'Date de consultation',
      question: 'Quelle est la date de la consultation ou de l’admission ?',
      hint: 'Format JJ/MM/AAAA, ex: 14/03/2026',
    },
    {
      key: 'age',
      label: 'Âge de la patiente',
      question: 'Quel est l’âge de la patiente ?',
      hint: 'Ex: 24 ans (nombre entre 10 et 60)',
    },
    {
      key: 'tension_arterielle',
      label: 'Tension artérielle',
      question: 'Quelle est la tension artérielle (TA) ?',
      hint: 'Format Systolique/Diastolique, ex: 120/80',
    },
    {
      key: 'temperature',
      label: 'Température corporelle',
      question: 'Quelle est la température corporelle (°C) ?',
      hint: 'Ex: 37.2 ou 37,2',
    },
    {
      key: 'poids',
      label: 'Poids de la patiente',
      question: 'Quel est le poids de la patiente en kg ?',
      hint: 'Ex: 58.5 kg',
    },
    {
      key: 'statut_vih',
      label: 'Dépistage VIH',
      question: 'Quel est le résultat du test de dépistage VIH ?',
      hint: 'Répondez : négatif, positif, ou non testé',
    },
    {
      key: 'statut_syphilis',
      label: 'Dépistage Syphilis',
      question: 'Quel est le résultat du test Syphilis (VDRL/TPHA) ?',
      hint: 'Répondez : négatif, positif, ou non testé',
    },
    {
      key: 'mode_accouchement',
      label: 'Mode d’accouchement',
      question: 'Quel a été le mode d’accouchement ?',
      hint: 'Répondez : voie basse ou césarienne (ou sans objet)',
    },
    {
      key: 'poids_naissance',
      label: 'Poids du nouveau-né',
      question: 'Quel est le poids du nouveau-né à la naissance en grammes ?',
      hint: 'Ex: 3100 ou 3.1 kg (ou sans objet)',
    },
  ],
  en: [
    {
      key: 'titre_document',
      label: 'Document name',
      question: '📝 What is the name or type of this medical document? (Mandatory)',
      hint: 'E.g. Delivery, Prenatal care, Post-partum follow-up, Health record...',
    },
    {
      key: 'numero_registre',
      label: 'Registry number',
      question: 'What is the registry or patient code number?',
      hint: 'E.g. 2026-823-001 or PAT-823',
    },
    {
      key: 'date_visite',
      label: 'Visit date',
      question: 'What is the consultation or admission date?',
      hint: 'Format DD/MM/YYYY, e.g. 14/03/2026',
    },
    {
      key: 'age',
      label: 'Patient age',
      question: 'What is the age of the patient?',
      hint: 'E.g. 24 years (number between 10 and 60)',
    },
    {
      key: 'tension_arterielle',
      label: 'Blood pressure',
      question: 'What is the blood pressure (BP)?',
      hint: 'Format Systolic/Diastolic, e.g. 120/80',
    },
    {
      key: 'temperature',
      label: 'Body temperature',
      question: 'What is the body temperature (°C)?',
      hint: 'E.g. 37.2',
    },
    {
      key: 'poids',
      label: 'Patient weight',
      question: 'What is the patient weight in kg?',
      hint: 'E.g. 58.5 kg',
    },
    {
      key: 'statut_vih',
      label: 'HIV screening',
      question: 'What is the HIV screening test result?',
      hint: 'Answer: negative, positive, or not tested',
    },
    {
      key: 'statut_syphilis',
      label: 'Syphilis screening',
      question: 'What is the Syphilis screening result?',
      hint: 'Answer: negative, positive, or not tested',
    },
    {
      key: 'mode_accouchement',
      label: 'Delivery mode',
      question: 'What was the mode of delivery?',
      hint: 'Answer: vaginal delivery or c-section (or n/a)',
    },
    {
      key: 'poids_naissance',
      label: 'Newborn birth weight',
      question: 'What is the newborn birth weight in grams?',
      hint: 'E.g. 3100 or 3.1 kg (or n/a)',
    },
  ],
};

export const get_welcome_text = (lang: app_language): string => {
  if (lang === 'en') {
    return (
      '👋 *Hello!* I am your maternal registry assistant.\n\n' +
      '• 📸 Tap the *camera* icon to scan a paper registry.\n' +
      '• 👥 Type *patients* to browse clinical records.\n' +
      '• 📊 Type *stats* for the epidemiological dashboard.\n' +
      '• ⚙️ Type *setting* to configure language or custom API key.\n' +
      '• ℹ️ Type *info* anytime to view all available commands.'
    );
  }
  return (
    '👋 *Bonjour !* Je suis votre assistant pour les registres de maternité.\n\n' +
    '• 📸 Prenez en *photo* une page de registre pour l’analyser.\n' +
    '• 👥 Tapez *patients* pour consulter les dossiers médicaux.\n' +
    '• 📊 Tapez *stats* pour le tableau de bord épidémiologique.\n' +
    '• ⚙️ Tapez *setting* pour configurer la langue ou votre clé API.\n' +
    '• ℹ️ Tapez *info* à tout moment pour afficher l’aide.'
  );
};

export const get_main_quick_replies = (lang: app_language): { label: string; value: string }[] => {
  if (lang === 'en') {
    return [
      { label: '📸 Camera', value: 'photo' },
      { label: '👥 Patients', value: 'patients' },
      { label: '📊 Stats', value: 'stats' },
      { label: '⚙️ Settings', value: 'setting' },
      { label: 'ℹ️ Info', value: 'info' },
    ];
  }
  return [
    { label: '📸 Photo', value: 'photo' },
    { label: '👥 Dossiers', value: 'patients' },
    { label: '📊 Stats', value: 'stats' },
    { label: '⚙️ Paramètres', value: 'setting' },
    { label: 'ℹ️ Info', value: 'info' },
  ];
};

export const get_info_text = (lang: app_language): string => {
  if (lang === 'en') {
    return (
      '📖 *COMMANDS GUIDE*\n' +
      '_Type any keyword directly into the chat conversation._\n\n' +
      '📋 *CLINICAL WORKFLOW*\n\n' +
      '• 📸 *photo* or *camera*\n' +
      '  _Capture a paper registry page for automatic AI extraction_\n\n' +
      '• 👥 *patients* or *records*\n' +
      '  _Browse patient files, view documents, and edit clinical data_\n\n' +
      '• 📊 *stats* or *dashboard*\n' +
      '  _Community epidemiological indicators (HIV, BP, delivery)_\n\n' +
      '• 📝 *manual* or *entry*\n' +
      '  _Guided step-by-step form entry without camera_\n\n' +
      '─────────────────────\n\n' +
      '⚙️ *SETTINGS & LANGUAGE*\n\n' +
      '• ⚙️ *setting* or *settings*\n' +
      '  _Configure language or set custom API key (Google AI Studio / Groq)_\n\n' +
      '• 🌐 *lang fr* or *lang en*\n' +
      '  _Instant language toggle_\n\n' +
      '─────────────────────\n\n' +
      '🛠️ *MANAGEMENT & HELP*\n\n' +
      '• 🗑️ *reset* or *clear*\n' +
      '  _Complete wipe (clears patients & records; preserves API keys)_\n\n' +
      '• ℹ️ *info* or *help*\n' +
      '  _Display this commands guide_\n\n' +
      '💡 *Tip:* Type *setting* to configure your own Google AI Studio or Groq key.'
    );
  }
  return (
    '📖 *GUIDE DES COMMANDES*\n' +
    '_Tapez simplement le mot-clé dans la conversation._\n\n' +
    '📋 *ACTIONS CLINIQUES*\n\n' +
    '• 📸 *photo* ou *camera*\n' +
    '  _Photographier un registre papier pour extraction IA_\n\n' +
    '• 👥 *patients* ou *dossier*\n' +
    '  _Consulter les patientes, leurs fiches et modifier les données_\n\n' +
    '• 📊 *stats* ou *dashboard*\n' +
    '  _Tableau épidémiologique communautaire (VIH, TA, naissances)_\n\n' +
    '• 📝 *manuel* ou *saisie*\n' +
    '  _Saisie médicale guidée pas à pas sans appareil photo_\n\n' +
    '─────────────────────\n\n' +
    '⚙️ *RÉGLAGES & LANGUE*\n\n' +
    '• ⚙️ *setting* ou *parametres*\n' +
    '  _Changer la langue ou configurer votre clé API (Google / Groq)_\n\n' +
    '• 🌐 *lang fr* ou *lang en*\n' +
    '  _Bascule instantanée de la langue de l’assistant_\n\n' +
    '─────────────────────\n\n' +
    '🛠️ *GESTION & AIDE*\n\n' +
    '• 🗑️ *reset* ou *vider*\n' +
    '  _Remise à zéro complète (efface fiches/patientes, préserve les clés)_\n\n' +
    '• ℹ️ *info* ou *aide*\n' +
    '  _Réafficher ce guide des commandes_\n\n' +
    '💡 *Astuce :* Tapez *setting* pour configurer votre propre clé API.'
  );
};

export const format_epidemiological_dashboard = (
  stats: epidemiological_stats,
  lang: app_language
): string => {
  const is_en = lang === 'en';

  const format_pct = (positive: number, tested: number): string => {
    if (tested === 0) return is_en ? '0% (0 tested)' : '0% (0 testé)';
    const pct = ((positive / tested) * 100).toFixed(1);
    return `${pct}% (${positive}/${tested})`;
  };

  if (is_en) {
    return (
      `📊 Anonymized Epidemiological Dashboard\n\n` +
      `📈 Volume: ${stats.total_records} records | ${stats.total_patients} patients\n\n` +
      `🩺 Infectious Disease Screening:\n` +
      `• HIV Seropositivity: ${format_pct(stats.hiv_positive, stats.hiv_tested)}\n` +
      `• Syphilis Seropositivity: ${format_pct(stats.syphilis_positive, stats.syphilis_tested)}\n` +
      `• Hepatitis C: ${format_pct(stats.hep_c_positive, stats.hep_c_tested)}\n\n` +
      `💓 Vitals & Biometrics:\n` +
      `• Mean Blood Pressure: ${
        stats.avg_systolic && stats.avg_diastolic
          ? `${stats.avg_systolic}/${stats.avg_diastolic} mmHg`
          : 'N/A'
      }\n` +
      `• Mean Temperature: ${stats.avg_temperature ? `${stats.avg_temperature}°C` : 'N/A'}\n\n` +
      `👶 Maternity & Neonatology:\n` +
      `• Newborns Recorded: ${stats.newborn_count}\n` +
      `• Mean Birth Weight: ${stats.avg_birth_weight ? `${stats.avg_birth_weight} g` : 'N/A'}\n` +
      `• Low Birth Weight (<2500g): ${stats.low_birth_weight_count}\n` +
      `• Deliveries: ${stats.vaginal_delivery_count} vaginal, ${stats.cesarean_count} c-section`
    );
  }

  return (
    `📊 Tableau de bord épidémiologique anonymisé\n\n` +
    `📈 Activité : ${stats.total_records} fiches enregistrées | ${stats.total_patients} patientes suivies\n\n` +
    `🩺 Dépistage des maladies infectieuses :\n` +
    `• Taux de positivité VIH : ${format_pct(stats.hiv_positive, stats.hiv_tested)}\n` +
    `• Taux de positivité Syphilis : ${format_pct(stats.syphilis_positive, stats.syphilis_tested)}\n` +
    `• Taux de positivité Hépatite C : ${format_pct(stats.hep_c_positive, stats.hep_c_tested)}\n\n` +
    `💓 Constantes vitales moyennes :\n` +
    `• Tension artérielle : ${
      stats.avg_systolic && stats.avg_diastolic
        ? `${stats.avg_systolic}/${stats.avg_diastolic} mmHg`
        : 'Non renseignée'
    }\n` +
    `• Température : ${stats.avg_temperature ? `${stats.avg_temperature}°C` : 'Non renseignée'}\n\n` +
    `👶 Maternité et néonatologie :\n` +
    `• Nouveau-nés enregistrés : ${stats.newborn_count}\n` +
    `• Poids moyen à la naissance : ${stats.avg_birth_weight ? `${stats.avg_birth_weight} g` : 'Non renseigné'}\n` +
    `• Faible poids de naissance (<2500g) : ${stats.low_birth_weight_count}\n` +
    `• Accouchements : ${stats.vaginal_delivery_count} voie basse, ${stats.cesarean_count} césarienne`
  );
};

