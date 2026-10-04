import * as SQLite from 'expo-sqlite';
import { Paths, Directory, File } from 'expo-file-system';
import { db_record_row, save_record_params, parsed_record_row } from '../types/record_types';
import {
  record_status,
  extracted_record_data,
  all_record_statuses,
} from '../types/chat_types';

const database_name = 'dayone_codeml.db';
const schema_version = 2;
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
    last_error TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_record_status ON record (status);
  CREATE INDEX IF NOT EXISTS idx_record_created_at ON record (created_at);
`;

const open_and_migrate_database = async (): Promise<SQLite.SQLiteDatabase> => {
  const db = await SQLite.openDatabaseAsync(database_name);
  await db.execAsync('PRAGMA journal_mode = WAL;');

  const version_row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version;');
  const current_version = version_row?.user_version ?? 0;

  if (current_version < schema_version) {
    const existing_table = await db.getFirstAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'record';"
    );

    await db.withExclusiveTransactionAsync(async (tx) => {
      if (existing_table) {
        // v1 : contrainte CHECK à 5 statuts et pas de last_error -> on recrée la table en gardant les lignes
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
  if (!source_image_uri.startsWith('file://')) {
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
    `UPDATE record SET image_uri = ?, status = 'en_attente_ia', extracted_data = NULL, last_error = NULL
     WHERE id = ?;`,
    [persistent_image_uri, record_id]
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
  await db.runAsync('UPDATE record SET status = ?, last_error = ? WHERE id = ?;', [
    failure_status,
    error_message,
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
      'UPDATE record SET status = ?, extracted_data = ?, last_error = NULL WHERE id = ?;',
      [new_status, serialized_data, record_id]
    );
  } else {
    await db.runAsync('UPDATE record SET status = ?, last_error = NULL WHERE id = ?;', [
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
