import React from 'react';
import { FlatList, Image, Text, TouchableOpacity, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { gallery_photo } from '../hooks/use_gallery_photos';

export interface grid_action_tile {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  on_press: () => void;
}

interface photo_grid_props {
  photos: gallery_photo[];
  on_select_photo: (image_uri: string) => void;
  on_end_reached?: () => void;
  action_tiles?: grid_action_tile[];
  column_count?: number;
  bottom_padding?: number;
  empty_text?: string;
}

type grid_item = { kind: 'action'; tile: grid_action_tile } | { kind: 'photo'; photo: gallery_photo };

const grid_gap = 2;

/**
 * Grille de photos façon WhatsApp, avec des tuiles d'action en tête (caméra, démo...).
 */
export const PhotoGrid: React.FC<photo_grid_props> = ({
  photos,
  on_select_photo,
  on_end_reached,
  action_tiles = [],
  column_count = 3,
  bottom_padding = 0,
  empty_text,
}) => {
  const { width: screen_width } = useWindowDimensions();
  const tile_size = (screen_width - grid_gap * (column_count - 1)) / column_count;

  const grid_items: grid_item[] = [
    ...action_tiles.map((tile): grid_item => ({ kind: 'action', tile })),
    ...photos.map((photo): grid_item => ({ kind: 'photo', photo })),
  ];

  return (
    <FlatList
      data={grid_items}
      keyExtractor={(item) => (item.kind === 'action' ? `action_${item.tile.key}` : item.photo.id)}
      numColumns={column_count}
      columnWrapperStyle={{ gap: grid_gap }}
      contentContainerStyle={{ gap: grid_gap, paddingBottom: bottom_padding }}
      onEndReached={on_end_reached}
      onEndReachedThreshold={0.6}
      ListFooterComponent={
        photos.length === 0 && empty_text ? (
          <Text className="text-whatsapp_gray_text text-center text-sm mt-4 px-6">{empty_text}</Text>
        ) : null
      }
      renderItem={({ item }) =>
        item.kind === 'action' ? (
          <TouchableOpacity
            onPress={item.tile.on_press}
            activeOpacity={0.7}
            style={{ width: tile_size, height: tile_size }}
            className="bg-whatsapp_chat_bar items-center justify-center"
            accessibilityLabel={item.tile.label}
          >
            <Ionicons name={item.tile.icon} size={30} color="#128C7E" />
            <Text className="text-whatsapp_dark_text text-xs mt-1.5">{item.tile.label}</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity onPress={() => on_select_photo(item.photo.uri)} activeOpacity={0.8}>
            <Image
              source={{ uri: item.photo.uri }}
              style={{ width: tile_size, height: tile_size }}
              resizeMode="cover"
              resizeMethod="resize"
            />
          </TouchableOpacity>
        )
      }
    />
  );
};
