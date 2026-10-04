import React, { useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { extracted_record_data, doubtful_field_statuses } from '../types/chat_types';

interface correction_modal_props {
  is_visible: boolean;
  record_id: string | null;
  patient_id?: string;
  initial_data: extracted_record_data | null;
  on_close: () => void;
  on_save_corrections: (
    record_id: string,
    updated_data: extracted_record_data
  ) => void;
}

export const CorrectionModal: React.FC<correction_modal_props> = ({
  is_visible,
  record_id,
  patient_id,
  initial_data,
  on_close,
  on_save_corrections,
}) => {
  const [form_values, set_form_values] = useState<Record<string, string>>({});

  useEffect(() => {
    if (initial_data) {
      const mapped_values: Record<string, string> = {};
      Object.entries(initial_data).forEach(([key, field_val]) => {
        if (field_val) {
          mapped_values[key] = field_val.valeur !== null ? String(field_val.valeur) : '';
        }
      });
      set_form_values(mapped_values);
    }
  }, [initial_data]);

  const handle_field_change = (field_key: string, new_text_val: string) => {
    set_form_values((prev_values) => ({
      ...prev_values,
      [field_key]: new_text_val,
    }));
  };

  const handle_submit = () => {
    if (!record_id || !initial_data) return;

    const updated_record_data: extracted_record_data = { ...initial_data };

    Object.entries(form_values).forEach(([key, typed_val]) => {
      const existing_field = updated_record_data[key];
      const trimmed_val = typed_val.trim();
      const original_val =
        existing_field?.valeur !== null && existing_field?.valeur !== undefined
          ? String(existing_field.valeur)
          : '';

      // Champ non modifié : on garde le statut et la confiance de l'IA (sinon on effacerait ses doutes)
      if (trimmed_val === original_val) return;

      updated_record_data[key] = {
        valeur: trimmed_val || null,
        confiance: 1.0, // Correction manuelle par la sage-femme = confiance maximale
        statut: trimmed_val ? 'connu' : 'non_fourni',
      };
    });

    on_save_corrections(record_id, updated_record_data);
    on_close();
  };

  if (!initial_data || !record_id) return null;

  return (
    <Modal visible={is_visible} animationType="slide" transparent>
      <View className="flex-1 bg-black/60 justify-end">
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          className="bg-white rounded-t-3xl max-h-[85%] overflow-hidden shadow-2xl"
        >
          {/* En-tête modal style WhatsApp / médical */}
          <View className="bg-whatsapp_teal px-4 py-3.5 flex-row justify-between items-center">
            <View>
              <Text className="text-white text-base font-bold">
                Correction du Registre
              </Text>
              <Text className="text-white/80 text-xs">
                Dossier : {patient_id || record_id}
              </Text>
            </View>
            <TouchableOpacity onPress={on_close} className="p-1" activeOpacity={0.7}>
              <Ionicons name="close-circle" size={26} color="#FFFFFF" />
            </TouchableOpacity>
          </View>

          <ScrollView className="p-4" showsVerticalScrollIndicator={false}>
            <Text className="text-xs text-slate-500 mb-3 font-medium">
              Vérifiez et corrigez les valeurs manuscrites extraites par l'IA avant validation définitive :
            </Text>

            {Object.entries(initial_data).map(([field_key, field_obj]) => {
              if (!field_obj) return null;

              const is_illisible_initial = doubtful_field_statuses.includes(field_obj.statut);
              const current_field_value = form_values[field_key] ?? '';

              return (
                <View key={field_key} className="mb-3">
                  <View className="flex-row justify-between items-center mb-1">
                    <Text className="text-xs font-semibold text-slate-700 capitalize">
                      {field_key.replace(/_/g, ' ')} :
                    </Text>
                    {is_illisible_initial && (
                      <View className="bg-rose-100 px-2 py-0.5 rounded-full flex-row items-center">
                        <Ionicons name="alert-circle" size={12} color="#E11D48" />
                        <Text className="text-[10px] text-rose-700 font-bold ml-1">
                          À vérifier
                        </Text>
                      </View>
                    )}
                  </View>

                  <TextInput
                    value={current_field_value}
                    onChangeText={(val) => handle_field_change(field_key, val)}
                    placeholder={`Saisir ${field_key.replace(/_/g, ' ')}...`}
                    placeholderTextColor="#94A3B8"
                    className={`border rounded-xl px-3 py-2 text-sm text-slate-900 bg-slate-50 ${
                      is_illisible_initial && !current_field_value
                        ? 'border-rose-400 bg-rose-50/40'
                        : 'border-slate-300'
                    }`}
                  />
                </View>
              );
            })}

            {/* Boutons d'action */}
            <View className="flex-row justify-between mt-4 mb-6">
              <TouchableOpacity
                onPress={on_close}
                className="flex-1 bg-slate-200 py-3 rounded-xl mr-2 items-center"
                activeOpacity={0.8}
              >
                <Text className="text-slate-700 font-bold text-sm">Annuler</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={handle_submit}
                className="flex-1 bg-whatsapp_green py-3 rounded-xl ml-2 items-center flex-row justify-center"
                activeOpacity={0.8}
              >
                <Ionicons name="checkmark" size={18} color="#FFFFFF" />
                <Text className="text-white font-bold text-sm ml-1">Enregistrer</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
};

