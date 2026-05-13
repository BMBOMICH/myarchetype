import React from 'react';
import { ActivityIndicator, Image, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { s } from './styles';

interface PhotoSectionProps {
  photos: string[];
  primaryPhotoIndex: number;
  photoToUpload: string | null;
  showDeleteConfirm: boolean;
  deletingPhotoIndex: number;
  uploadMutationPending: boolean;
  onPickImage: () => void;
  onTakePhoto: () => void;
  onSetPrimary: (index: number) => void;
  onLongPress: (index: number) => void;
  onCancelUpload: () => void;
  onConfirmUpload: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}

export function PhotoSection({
  photos,
  primaryPhotoIndex,
  photoToUpload,
  showDeleteConfirm,
  uploadMutationPending,
  onPickImage,
  onTakePhoto,
  onSetPrimary,
  onLongPress,
  onCancelUpload,
  onConfirmUpload,
  onCancelDelete,
  onConfirmDelete,
}: PhotoSectionProps) {
  return (
    <>
      <View style={s.photoSection}>
        <Text style={s.sectionTitle}>Photos {photos.length}/6</Text>
        <View style={s.photoGrid}>
          {photos.map((uri, i) => (
            <View key={`${uri}_${i}`} style={s.photoCell}>
              <Pressable
                onPress={() => onSetPrimary(i)}
                onLongPress={() => onLongPress(i)}
                delayLongPress={400}
              >
                <Image
                  source={{ uri }}
                  style={[s.photoImage, { width: 100, height: 100 }, i === primaryPhotoIndex && s.photoPrimary]}
                  resizeMode="cover"
                  accessibilityLabel={`Profile photo ${i + 1}${i === primaryPhotoIndex ? ', primary' : ''}`}
                />
                {i === primaryPhotoIndex && (
                  <View style={s.primaryBadge}>
                    <Text style={s.primaryBadgeText}>Primary</Text>
                  </View>
                )}
                <View style={s.photoIndexBadge}>
                  <Text style={s.photoIndexText}>{i + 1}</Text>
                </View>
              </Pressable>
            </View>
          ))}
          {photos.length < 6 && (
            <Pressable
              style={s.photoAddCell}
              onPress={onPickImage}
              accessibilityLabel="Add photo"
              accessibilityRole="button"
            >
              <Ionicons name="add" size={28} color="#6C63FF" />
              <Text style={s.photoAddText}>Add</Text>
            </Pressable>
          )}
        </View>
        <View style={s.photoActions}>
          <Pressable style={s.photoActionBtn} onPress={onPickImage} accessibilityLabel="Pick from gallery" accessibilityRole="button">
            <Ionicons name="image-outline" size={16} color="#6C63FF" />
            <Text style={s.photoActionText}>Gallery</Text>
          </Pressable>
          <Pressable style={s.photoActionBtn} onPress={onTakePhoto} accessibilityLabel="Take a photo" accessibilityRole="button">
            <Ionicons name="camera-outline" size={16} color="#6C63FF" />
            <Text style={s.photoActionText}>Camera</Text>
          </Pressable>
        </View>
      </View>

      {photoToUpload && (
        <View style={s.photoPreviewOverlay}>
          <View style={s.photoPreviewCard}>
            <Text style={s.photoPreviewTitle}>Add this photo?</Text>
            <Image
              source={{ uri: photoToUpload }}
              style={[s.photoPreviewImage, { width: 280, height: 280 }]}
              resizeMode="cover"
              accessibilityLabel="Photo preview"
            />
            <View style={s.photoPreviewBtns}>
              <Pressable style={s.photoPreviewCancel} onPress={onCancelUpload} accessibilityLabel="Cancel photo upload" accessibilityRole="button">
                <Text style={s.photoPreviewCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[s.photoPreviewConfirm, uploadMutationPending && s.photoPreviewConfirmDisabled]}
                onPress={onConfirmUpload}
                disabled={uploadMutationPending}
                accessibilityLabel="Confirm add photo"
                accessibilityRole="button"
              >
                {uploadMutationPending
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={s.photoPreviewConfirmText}>Add Photo</Text>
                }
              </Pressable>
            </View>
          </View>
        </View>
      )}

      {showDeleteConfirm && (
        <View style={s.deleteOverlay}>
          <View style={s.deleteCard}>
            <Text style={s.deleteTitle}>Remove photo?</Text>
            <Text style={s.deleteSub}>This photo will be removed from your profile.</Text>
            <View style={s.deleteBtns}>
              <Pressable style={s.deleteCancel} onPress={onCancelDelete} accessibilityLabel="Cancel delete" accessibilityRole="button">
                <Text style={s.deleteCancelText}>Cancel</Text>
              </Pressable>
              <Pressable style={s.deleteConfirm} onPress={onConfirmDelete} accessibilityLabel="Confirm remove photo" accessibilityRole="button">
                <Text style={s.deleteConfirmText}>Remove</Text>
              </Pressable>
            </View>
          </View>
        </View>
      )}
    </>
  );
}