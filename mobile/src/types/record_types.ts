import { record_status, extracted_record_data } from './chat_types';

export interface db_record_row {
  id: string;
  patient_id: string | null;
  image_uri: string;
  status: record_status;
  extracted_data: string | null;
  created_at: string;
  last_error: string | null;
}

export interface save_record_params {
  source_image_uri: string;
  patient_id?: string | null;
}

export interface db_patient_row {
  id: string;
  code: string;
  village: string | null;
  created_at: string;
  last_visit_at: string;
  notes: string | null;
}

export interface create_patient_params {
  code?: string;
  village?: string | null;
  notes?: string | null;
}

export interface db_patient_with_count extends db_patient_row {
  records_count: number;
}

export interface parsed_record_row {
  id: string;
  patient_id: string | null;
  image_uri: string;
  status: record_status;
  extracted_data: extracted_record_data | null;
  created_at: string;
  last_error: string | null;
}
