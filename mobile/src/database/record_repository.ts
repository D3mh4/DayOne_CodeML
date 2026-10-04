import * as SQLite from 'expo-sqlite';
import { Paths, Directory, File } from 'expo-file-system';
import {
  db_record_row,
  save_record_params,
  parsed_record_row,
  db_patient_row,
  create_patient_params,
  db_patient_with_count,
} from '../types/record_types';
import {
  record_status,
  extracted_record_data,
  all_record_statuses,
} from '../types/chat_types';

const database_name = 'dayone_codeml.db';
const schema_version = 4;
let database_promise: Promise<SQLite.SQLiteDatabase> | null = null;

const status_check_list = all_record_statuses.map((status_val) => `'${status_val}'`).join(', ');

const create_record_table_sql = `
  CREATE TABLE IF NOT EXISTS record (
    id TEXT PRIMARY KEY NOT NULL,
    patient_id TEXT,
    image_uri TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN (${status_check_list})),
    extracted_data TEXT,
    created_at TEXT NOT NULL,
    last_error TEXT,
    updated_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_record_status ON record (status);
  CREATE INDEX IF NOT EXISTS idx_record_created_at ON record (created_at);
`;

const create_patient_table_sql = `
  CREATE TABLE IF NOT EXISTS patient (
    id TEXT PRIMARY KEY NOT NULL,
    code TEXT NOT NULL UNIQUE,
    village TEXT,
    created_at TEXT NOT NULL,
    last_visit_at TEXT NOT NULL,
    notes TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_patient_code ON patient (code);
`;

export const create_setting_table_sql = `
  CREATE TABLE IF NOT EXISTS app_setting (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
  );
`;

const open_and_migrate_database = async (): Promise<SQLite.SQLiteDatabase> => {
  const db = await SQLite.openDatabaseAsync(database_name);
  await db.execAsync('PRAGMA journal_mode = WAL;');
  await db.execAsync(create_setting_table_sql);

  const version_row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version;');
  const current_version = version_row?.user_version ?? 0;

  if (current_version < schema_version) {
    await db.withExclusiveTransactionAsync(async (tx) => {
      // Migration v1 -> v2
      if (current_version < 2) {
        const existing_table = await tx.getFirstAsync<{ name: string }>(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'record';"
        );
        if (existing_table) {
          await tx.execAsync(`
            ALTER TABLE record RENAME TO record_v1;
            DROP INDEX IF EXISTS idx_record_status;
            DROP INDEX IF EXISTS idx_record_created_at;
            ${create_record_table_sql}
            INSERT INTO record (id, patient_id, image_uri, status, extracted_data, created_at)
              SELECT id, patient_id, image_uri, status, extracted_data, created_at FROM record_v1;
            DROP TABLE record_v1;
          `);
        } else {
          await tx.execAsync(create_record_table_sql);
        }
      }

      // Migration v2 -> v3 : table patient pour la liaison des visites
      await tx.execAsync(create_record_table_sql);
      await tx.execAsync(create_patient_table_sql);

      // Migration v3 -> v4 : date de dernière modification (tri « modifié récemment »)
      const record_columns = await tx.getAllAsync<{ name: string }>('PRAGMA table_info(record);');
      if (!record_columns.some((column) => column.name === 'updated_at')) {
        await tx.execAsync('ALTER TABLE record ADD COLUMN updated_at TEXT;');
      }
      await tx.execAsync(`
        UPDATE record SET updated_at = created_at WHERE updated_at IS NULL;
        CREATE INDEX IF NOT EXISTS idx_record_updated_at ON record (updated_at);
      `);

      await tx.execAsync(`PRAGMA user_version = ${schema_version};`);
    });
  }

  return db;
};

/**
 * Initialise la connexion SQLite (une seule fois, même en cas d'appels concurrents) et migre le schéma.
 */
export const get_database_connection = (): Promise<SQLite.SQLiteDatabase> => {
  if (!database_promise) {
    database_promise = open_and_migrate_database().catch((open_error) => {
      database_promise = null;
      throw open_error;
    });
  }
  return database_promise;
};

/**
 * Copie la photo dans le stockage persistant de l'app et renvoie sa nouvelle URI.
 * Le cache de l'appareil photo peut être purgé par le système, ce qui ferait perdre l'enregistrement :
 * en cas d'échec on lève l'erreur au lieu de garder le chemin du cache.
 */
const persist_photo = async (source_image_uri: string, file_id: string): Promise<string> => {
  // file:// (caméra, iOS, asset de démo) ou content:// (galerie Android)
  if (!source_image_uri.startsWith('file://') && !source_image_uri.startsWith('content://')) {
    throw new Error(`URI de photo non locale, impossible de la stocker hors ligne : ${source_image_uri}`);
  }

  const storage_dir = new Directory(Paths.document, 'registres_photos');
  if (!storage_dir.exists) {
    storage_dir.create({ idempotent: true });
  }

  const source_file = new File(source_image_uri);
  const destination_file = new File(storage_dir, `${file_id}${source_file.extension || '.jpg'}`);
  await source_file.copy(destination_file);
  return destination_file.uri;
};

/**
 * Reprise de photo : la nouvelle image remplace celle du record, qui repart en file d'attente IA.
 * L'ancienne image reste sur le disque (aucune perte).
 */
export const replace_record_image = async (
  record_id: string,
  source_image_uri: string
): Promise<db_record_row> => {
  const db = await get_database_connection();
  const persistent_image_uri = await persist_photo(source_image_uri, `${record_id}_retake_${Date.now()}`);

  await db.runAsync(
    `UPDATE record SET image_uri = ?, status = 'en_attente_ia', extracted_data = NULL, last_error = NULL,
     updated_at = ? WHERE id = ?;`,
    [persistent_image_uri, new Date().toISOString(), record_id]
  );

  const updated_row = await get_record_by_id(record_id);
  if (!updated_row) {
    throw new Error(`Record introuvable après reprise : ${record_id}`);
  }
  return updated_row;
};

/**
 * Sauvegarde une photo localement dans le stockage persistant de l'application
 * et insère la ligne dans SQLite avec le statut 'en_attente_ia'.
 */
export const save_offline_photo_record = async (
  params: save_record_params
): Promise<db_record_row> => {
  const db = await get_database_connection();
  const generated_id = `rec_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const current_iso_date = new Date().toISOString();

  const persistent_image_uri = await persist_photo(params.source_image_uri, generated_id);

  // Insertion dans la base SQLite locale avec le statut obligatoire 'en_attente_ia'
  const initial_status: record_status = 'en_attente_ia';

  await db.runAsync(
    `INSERT INTO record (id, patient_id, image_uri, status, extracted_data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?);`,
    [
      generated_id,
      params.patient_id ?? null,
      persistent_image_uri,
      initial_status,
      null,
      current_iso_date,
      current_iso_date,
    ]
  );

  return {
    id: generated_id,
    patient_id: params.patient_id ?? null,
    image_uri: persistent_image_uri,
    status: initial_status,
    extracted_data: null,
    created_at: current_iso_date,
    updated_at: current_iso_date,
    last_error: null,
  };
};

/**
 * Récupère tous les enregistrements ordonnés du plus récent au plus ancien.
 */
export const get_all_records = async (): Promise<db_record_row[]> => {
  const db = await get_database_connection();
  const rows = await db.getAllAsync<db_record_row>(
    'SELECT * FROM record ORDER BY created_at DESC;'
  );
  return rows;
};

/**
 * Récupère les enregistrements par statut (ex: 'en_attente_ia' pour la synchronisation).
 */
export const get_records_by_status = async (
  status_filter: record_status
): Promise<db_record_row[]> => {
  const db = await get_database_connection();
  const rows = await db.getAllAsync<db_record_row>(
    'SELECT * FROM record WHERE status = ? ORDER BY created_at ASC;',
    [status_filter]
  );
  return rows;
};

/**
 * Records à (re)envoyer à l'IA : jamais traités, ou dont le traitement a échoué.
 */
export const get_records_needing_ai = async (): Promise<db_record_row[]> => {
  const db = await get_database_connection();
  return db.getAllAsync<db_record_row>(
    "SELECT * FROM record WHERE status IN ('en_attente_ia', 'echec_traitement') ORDER BY created_at ASC;"
  );
};

/**
 * Passe un record en état d'échec en gardant la raison (affichable et pour le README / démo).
 */
export const mark_record_failed = async (
  record_id: string,
  failure_status: record_status,
  error_message: string
): Promise<void> => {
  const db = await get_database_connection();
  await db.runAsync('UPDATE record SET status = ?, last_error = ?, updated_at = ? WHERE id = ?;', [
    failure_status,
    error_message,
    new Date().toISOString(),
    record_id,
  ]);
};

/**
 * Récupère un enregistrement par son identifiant unique.
 */
export const get_record_by_id = async (
  record_id: string
): Promise<db_record_row | null> => {
  const db = await get_database_connection();
  const row = await db.getFirstAsync<db_record_row>(
    'SELECT * FROM record WHERE id = ?;',
    [record_id]
  );
  return row;
};

/**
 * Met à jour le statut et éventuellement les données extraites d'un enregistrement.
 */
export const update_record_status_and_data = async (
  record_id: string,
  new_status: record_status,
  extracted_data?: extracted_record_data | string | null,
  // false pour une écriture technique (ex. titre déduit à l'affichage) qui ne doit pas compter comme une modification
  touch_updated_at = true
): Promise<void> => {
  const db = await get_database_connection();
  const updated_at_sql = touch_updated_at ? ', updated_at = ?' : '';
  const updated_at_params = touch_updated_at ? [new Date().toISOString()] : [];
  const serialized_data =
    extracted_data === undefined
      ? undefined
      : typeof extracted_data === 'string'
      ? extracted_data
      : extracted_data === null
      ? null
      : JSON.stringify(extracted_data);

  if (serialized_data !== undefined) {
    await db.runAsync(
      `UPDATE record SET status = ?, extracted_data = ?, last_error = NULL${updated_at_sql} WHERE id = ?;`,
      [new_status, serialized_data, ...updated_at_params, record_id]
    );
  } else {
    await db.runAsync(`UPDATE record SET status = ?, last_error = NULL${updated_at_sql} WHERE id = ?;`, [
      new_status,
      ...updated_at_params,
      record_id,
    ]);
  }
};

/**
 * Supprime un enregistrement par son id.
 */
export const delete_record_by_id = async (record_id: string): Promise<void> => {
  const db = await get_database_connection();
  await db.runAsync('DELETE FROM record WHERE id = ?;', [record_id]);
};

/**
 * Supprime tous les enregistrements et purge les photos locales pour tester de A à Z.
 */
export const reset_database_and_history = async (): Promise<void> => {
  const db = await get_database_connection();
  await db.execAsync('DELETE FROM record; DELETE FROM patient;');

  try {
    const storage_dir = new Directory(Paths.document, 'registres_photos');
    if (storage_dir.exists) {
      storage_dir.delete();
    }
  } catch (clean_err) {
    console.warn('Nettoyage dossier photos :', clean_err);
  }
};

export interface epidemiological_stats {
  total_records: number;
  total_patients: number;
  hiv_tested: number;
  hiv_positive: number;
  syphilis_tested: number;
  syphilis_positive: number;
  hep_c_tested: number;
  hep_c_positive: number;
  avg_systolic: number | null;
  avg_diastolic: number | null;
  avg_temperature: number | null;
  newborn_count: number;
  avg_birth_weight: number | null;
  low_birth_weight_count: number;
  cesarean_count: number;
  vaginal_delivery_count: number;
}

/**
 * Calcule les indicateurs épidémiologiques anonymisés à partir des données de registre (Bonus officiel Défi CodeML).
 */
export const compute_epidemiological_stats = async (): Promise<epidemiological_stats> => {
  const db = await get_database_connection();
  const records = await db.getAllAsync<db_record_row>('SELECT * FROM record;');
  const patient_count_row = await db.getFirstAsync<{ cnt: number }>('SELECT count(*) as cnt FROM patient;');
  const total_patients = patient_count_row?.cnt ?? 0;

  let hiv_tested = 0;
  let hiv_positive = 0;
  let syphilis_tested = 0;
  let syphilis_positive = 0;
  let hep_c_tested = 0;
  let hep_c_positive = 0;

  const systolic_values: number[] = [];
  const diastolic_values: number[] = [];
  const temp_values: number[] = [];
  const birth_weights: number[] = [];
  let low_birth_weight_count = 0;
  let cesarean_count = 0;
  let vaginal_delivery_count = 0;

  for (const rec of records) {
    if (!rec.extracted_data) continue;
    try {
      const data: extracted_record_data = JSON.parse(rec.extracted_data);
      for (const [key, val_obj] of Object.entries(data)) {
        if (!val_obj || val_obj.valeur === null || val_obj.valeur === undefined) continue;
        const raw_str = String(val_obj.valeur).toLowerCase().trim();
        const norm_key = key.toLowerCase();

        // Tests d'infections (VIH, Syphilis, Hépatite C)
        if (norm_key.includes('vih') || norm_key.includes('hiv')) {
          hiv_tested++;
          if (raw_str.includes('pos') || raw_str === '+' || raw_str === 'oui' || raw_str.includes('reactif')) {
            hiv_positive++;
          }
        }
        if (norm_key.includes('syphilis') || norm_key.includes('vdrl') || norm_key.includes('tpha')) {
          syphilis_tested++;
          if (raw_str.includes('pos') || raw_str === '+' || raw_str === 'oui' || raw_str.includes('reactif')) {
            syphilis_positive++;
          }
        }
        // Hépatite C uniquement : « vaccinee_hepatite_b » / « ag_hbs » concernent l'hépatite B
        if ((norm_key.includes('hepatite_c') || norm_key.includes('vhc') || norm_key.includes('hcv')) && !norm_key.includes('vaccin')) {
          hep_c_tested++;
          if (raw_str.includes('pos') || raw_str === '+' || raw_str === 'oui' || raw_str.includes('reactif')) {
            hep_c_positive++;
          }
        }

        // Tension artérielle
        if (norm_key.includes('tension') || norm_key === 'ta') {
          const bp_match = raw_str.match(/(\d{2,3})\s*[\/\-]\s*(\d{2,3})/);
          if (bp_match) {
            systolic_values.push(parseInt(bp_match[1], 10));
            diastolic_values.push(parseInt(bp_match[2], 10));
          }
        }

        // Température corporelle
        if (norm_key.includes('temperature') || norm_key === 'temp') {
          const temp_match = raw_str.replace(',', '.').match(/(\d{2}(\.\d)?)/);
          if (temp_match) {
            const num = parseFloat(temp_match[1]);
            if (num >= 34 && num <= 43) temp_values.push(num);
          }
        }

        // Poids du nouveau-né
        if (
          norm_key.includes('poids') &&
          (norm_key.includes('bebe') || norm_key.includes('naissance') || norm_key.includes('nouveau') || norm_key.includes('bb'))
        ) {
          let w_val: number | null = null;
          if (raw_str.includes('kg')) {
            const kg = parseFloat(raw_str.replace(',', '.').replace(/[^\d.]/g, ''));
            if (!isNaN(kg)) w_val = Math.round(kg * 1000);
          } else {
            const g = parseInt(raw_str.replace(/[^\d]/g, ''), 10);
            if (!isNaN(g)) {
              w_val = g < 20 ? Math.round(g * 1000) : g;
            }
          }
          if (w_val && w_val >= 500 && w_val <= 6500) {
            birth_weights.push(w_val);
            if (w_val < 2500) low_birth_weight_count++;
          }
        }

        // Mode d'accouchement
        if (norm_key.includes('mode_accouchement') || norm_key.includes('accouchement')) {
          if (raw_str.includes('cesar')) cesarean_count++;
          else if (raw_str.includes('basse') || raw_str.includes('eutocique') || raw_str.includes('naturel')) {
            vaginal_delivery_count++;
          }
        }
      }
    } catch {}
  }

  const avg = (arr: number[]) =>
    arr.length > 0 ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10 : null;

  return {
    total_records: records.length,
    total_patients,
    hiv_tested,
    hiv_positive,
    syphilis_tested,
    syphilis_positive,
    hep_c_tested,
    hep_c_positive,
    avg_systolic: avg(systolic_values),
    avg_diastolic: avg(diastolic_values),
    avg_temperature: avg(temp_values),
    newborn_count: birth_weights.length,
    avg_birth_weight: avg(birth_weights),
    low_birth_weight_count,
    cesarean_count,
    vaginal_delivery_count,
  };
};

/**
 * Utilitaire pour formater une ligne de la base avec ses données JSON parsées.
 */
export const parse_record_row = (row: db_record_row): parsed_record_row => {
  let parsed_data: extracted_record_data | null = null;
  if (row.extracted_data) {
    try {
      parsed_data = JSON.parse(row.extracted_data);
    } catch (parse_error) {
      console.warn('Erreur lors du parsing JSON de extracted_data :', parse_error);
    }
  }

  return {
    ...row,
    extracted_data: parsed_data,
  };
};

/**
 * Récupère toutes les patientes répertoriées dans la base locale.
 */
export const get_all_patients = async (): Promise<db_patient_row[]> => {
  const db = await get_database_connection();
  return db.getAllAsync<db_patient_row>('SELECT * FROM patient ORDER BY last_visit_at DESC;');
};

/**
 * Récupère les patientes avec le nombre de fiches associées.
 */
export const get_patients_with_record_counts = async (): Promise<db_patient_with_count[]> => {
  const db = await get_database_connection();
  // « Modifié récemment » : la dernière activité sur le profil OU sur l'une de ses fiches
  return db.getAllAsync<db_patient_with_count>(`
    SELECT p.*, COUNT(r.id) as records_count,
      MAX(p.last_visit_at, COALESCE(MAX(COALESCE(r.updated_at, r.created_at)), p.last_visit_at)) as last_modified_at
    FROM patient p
    LEFT JOIN record r ON r.patient_id = p.id
    GROUP BY p.id
    ORDER BY last_modified_at DESC;
  `);
};

/**
 * Récupère toutes les fiches d'une patiente par son identifiant ou code.
 */
export const get_records_by_patient_id = async (patient_id: string): Promise<db_record_row[]> => {
  const db = await get_database_connection();
  return db.getAllAsync<db_record_row>(
    'SELECT * FROM record WHERE patient_id = ? ORDER BY COALESCE(updated_at, created_at) DESC;',
    [patient_id]
  );
};

/**
 * Récupère les fiches qui n'ont pas encore été liées à une patiente.
 */
export const get_unlinked_records = async (): Promise<db_record_row[]> => {
  const db = await get_database_connection();
  return db.getAllAsync<db_record_row>(
    'SELECT * FROM record WHERE patient_id IS NULL ORDER BY COALESCE(updated_at, created_at) DESC;'
  );
};

/**
 * Récupère un profil patiente par son code (ex: 'PAT-823') ou son identifiant.
 */
export const get_patient_by_code_or_id = async (code_or_id: string): Promise<db_patient_row | null> => {
  const db = await get_database_connection();
  const clean = code_or_id.trim();
  const upper_code = clean.toUpperCase();
  return db.getFirstAsync<db_patient_row>(
    'SELECT * FROM patient WHERE UPPER(code) = ? OR id = ?;',
    [upper_code, clean]
  );
};

/**
 * Crée un nouveau profil patiente anonyme avec un code aléatoire généré automatiquement.
 */
export const create_patient = async (
  params: create_patient_params = {}
): Promise<db_patient_row> => {
  const db = await get_database_connection();
  // Code saisi par la sage-femme, sinon code aléatoire libre (4 chiffres, sans collision avec un code existant)
  let generated_code = params.code?.trim().toUpperCase() ?? '';
  for (let attempt = 0; !generated_code && attempt < 20; attempt++) {
    const candidate = `PAT-${Math.floor(1000 + Math.random() * 9000)}`;
    const taken = await db.getFirstAsync<{ id: string }>('SELECT id FROM patient WHERE code = ?;', [candidate]);
    if (!taken) generated_code = candidate;
  }
  if (!generated_code) throw new Error('Impossible de générer un code patiente libre');
  const generated_id = `pat_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const now_iso = new Date().toISOString();

  await db.runAsync(
    `INSERT INTO patient (id, code, village, created_at, last_visit_at, notes)
     VALUES (?, ?, ?, ?, ?, ?);`,
    [generated_id, generated_code, params.village ?? null, now_iso, now_iso, params.notes ?? null]
  );

  return {
    id: generated_id,
    code: generated_code,
    village: params.village ?? null,
    created_at: now_iso,
    last_visit_at: now_iso,
    notes: params.notes ?? null,
  };
};

/**
 * Recherche des correspondances potentielles de patientes pour une fiche.
 * Analyse le numéro de fiche extrait (ex. "2026-823-001" -> cherche "PAT-823").
 */
export const find_candidate_patients = async (
  extracted_data?: extracted_record_data
): Promise<db_patient_row[]> => {
  const db = await get_database_connection();
  const all_patients = await db.getAllAsync<db_patient_row>(
    'SELECT * FROM patient ORDER BY last_visit_at DESC LIMIT 5;'
  );

  if (!extracted_data) return all_patients.slice(0, 2);

  const numero_val = String(extracted_data?.numero_fiche?.valeur ?? extracted_data?.numero_registre?.valeur ?? '');
  const village_val = String(extracted_data?.region?.valeur ?? extracted_data?.province?.valeur ?? '');

  const matching = all_patients.filter((patient) => {
    if (numero_val && patient.code.includes(numero_val.slice(-3))) return true;
    if (village_val && patient.village && village_val.includes(patient.village)) return true;
    return false;
  });

  return matching.length > 0 ? matching.slice(0, 2) : all_patients.slice(0, 2);
};

/**
 * Relie un enregistrement de visite à un profil de patiente,
 * et passe le statut à 'patiente_liee' puis 'enregistre'.
 */
export const link_record_to_patient = async (
  record_id: string,
  patient_id: string | null
): Promise<void> => {
  const db = await get_database_connection();
  const now_iso = new Date().toISOString();

  await db.runAsync(
    "UPDATE record SET patient_id = ?, status = 'enregistre', updated_at = ? WHERE id = ?;",
    [patient_id, now_iso, record_id]
  );

  if (patient_id) {
    await db.runAsync('UPDATE patient SET last_visit_at = ? WHERE id = ?;', [now_iso, patient_id]);
  }
};

/**
 * Crée un enregistrement sans photo (saisie manuelle de secours sans IA).
 */
export const create_manual_record = async (
  extracted_data: extracted_record_data,
  patient_id?: string | null
): Promise<db_record_row> => {
  const db = await get_database_connection();
  const generated_id = `rec_man_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const now_iso = new Date().toISOString();
  const serialized = JSON.stringify(extracted_data);

  await db.runAsync(
    `INSERT INTO record (id, patient_id, image_uri, status, extracted_data, created_at, updated_at)
     VALUES (?, ?, 'manual://entry', 'valide', ?, ?, ?);`,
    [generated_id, patient_id ?? null, serialized, now_iso, now_iso]
  );

  return {
    id: generated_id,
    patient_id: patient_id ?? null,
    image_uri: 'manual://entry',
    status: 'valide',
    extracted_data: serialized,
    created_at: now_iso,
    updated_at: now_iso,
    last_error: null,
  };
};
