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

export interface parsed_record_row {
  id: string;
  patient_id: string | null;
  image_uri: string;
  status: record_status;
  extracted_data: extracted_record_data | null;
  created_at: string;
  last_error: string | null;
}
