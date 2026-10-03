import * as SQLite from 'expo-sqlite';
import { Paths, Directory, File } from 'expo-file-system';
import { db_record_row, save_record_params, parsed_record_row } from '../types/record_types';
import { record_status, extracted_record_data } from '../types/chat_types';

const database_name = 'dayone_codeml.db';
let database_instance: SQLite.SQLiteDatabase | null = null;

/**
 * Initialise la connexion SQLite et crée la table record si nécessaire.
 */
export const get_database_connection = async (): Promise<SQLite.SQLiteDatabase> => {
  if (database_instance) {
    return database_instance;
  }

  database_instance = await SQLite.openDatabaseAsync(database_name);

  // Exécution du schéma SQLite
  await database_instance.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS record (
      id TEXT PRIMARY KEY NOT NULL,
      patient_id TEXT,
      image_uri TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('capture', 'en_attente_ia', 'traite_ia', 'a_reviser', 'valide')),
      extracted_data TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_record_status ON record (status);
    CREATE INDEX IF NOT EXISTS idx_record_created_at ON record (created_at);
  `);

  return database_instance;
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

  let persistent_image_uri = params.source_image_uri;

  try {
    // Création du répertoire dédié aux photos de registre dans le stockage document
    const storage_dir = new Directory(Paths.document, 'registres_photos');
    if (!storage_dir.exists) {
      storage_dir.create({ idempotent: true });
    }

    // Si l'URI source est un fichier local (ex: cache appareil photo), on le copie dans le dossier persistant
    if (params.source_image_uri.startsWith('file://')) {
      const source_file = new File(params.source_image_uri);
      const destination_file = new File(storage_dir, `${generated_id}.jpg`);
      await source_file.copy(destination_file);
      persistent_image_uri = destination_file.uri;
    }
  } catch (storage_error) {
    console.warn(
      'Avertissement lors de la copie locale du fichier, conservation du chemin source :',
      storage_error
    );
  }

  // Insertion dans la base SQLite locale avec le statut obligatoire 'en_attente_ia'
  const initial_status: record_status = 'en_attente_ia';

  await db.runAsync(
    `INSERT INTO record (id, patient_id, image_uri, status, extracted_data, created_at)
     VALUES (?, ?, ?, ?, ?, ?);`,
    [
      generated_id,
      params.patient_id ?? null,
      persistent_image_uri,
      initial_status,
      null,
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
  extracted_data?: extracted_record_data | string | null
): Promise<void> => {
  const db = await get_database_connection();
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
      'UPDATE record SET status = ?, extracted_data = ? WHERE id = ?;',
      [new_status, serialized_data, record_id]
    );
  } else {
    await db.runAsync('UPDATE record SET status = ? WHERE id = ?;', [
      new_status,
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
