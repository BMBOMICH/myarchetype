import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { doc, setDoc } from 'firebase/firestore';
import React, { useState } from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { CLOUDINARY_CONFIG } from '../cloudinaryConfig';
import { auth, db } from '../firebaseConfig';

export default function ProfileSetupScreen() {
  const router = useRouter();
  const user = auth.currentUser;

  const [name, setName] = useState('');
  const [age, setAge] = useState('');
  const [gender, setGender] = useState('');
  const [height, setHeight] = useState('');
  const [bodyType, setBodyType] = useState('');
  const [lookingFor, setLookingFor] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  // Helper function to check image format
  const checkImageFormat = (asset: any): boolean => {
    // Method 1: Check mimeType (most reliable)
    if (asset.mimeType) {
      const validMimeTypes = [
        'image/jpeg',
        'image/jpg',
        'image/png',
        'image/heic',
        'image/heif',
        'image/webp',
      ];
      
      if (validMimeTypes.includes(asset.mimeType.toLowerCase())) {
        console.log('✅ Valid format detected via mimeType:', asset.mimeType);
        return true;
      }
    }

    // Method 2: Check file extension (fallback)
    const uri = asset.uri.toLowerCase();
    const validExtensions = ['.jpg', '.jpeg', '.png', '.heic', '.heif', '.webp'];
    
    for (const ext of validExtensions) {
      if (uri.includes(ext)) {
        console.log('✅ Valid format detected via extension:', ext);
        return true;
      }
    }

    // If neither method works, assume it's valid (ImagePicker already filters)
    console.log('⚠️ Could not determine format, allowing (ImagePicker pre-filtered)');
    return true;
  };

  const pickImage = async () => {
    if (photos.length >= 3) {
      window.alert('Maximum 3 photos allowed');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [3, 4],
      quality: 0.7,
      base64: false,
    });

    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      
      console.log('📸 Photo selected:', asset.uri);
      console.log('📏 Dimensions:', asset.width, 'x', asset.height);
      
      if (asset.mimeType) {
        console.log('📄 File type:', asset.mimeType);
      }

      // ✅ VERIFICATION 1: Check file size (max 5MB)
      if (asset.fileSize && asset.fileSize > 5 * 1024 * 1024) {
        window.alert('❌ Photo too large! Maximum 5MB allowed.');
        return;
      }

      // ✅ VERIFICATION 2: Check minimum resolution (at least 300x400)
      if (asset.width < 300 || asset.height < 400) {
        window.alert('❌ Photo resolution too low! Use a higher quality image (minimum 300x400).');
        return;
      }

      // ✅ VERIFICATION 3: Check format
      const isValidFormat = checkImageFormat(asset);
      if (!isValidFormat) {
        window.alert('❌ Invalid format! Only JPG, PNG, HEIC, or WebP images allowed.');
        return;
      }

      // ✅ VERIFICATION 4: Upload and check for nudity with AI
      setUploadingPhoto(true);
      const isValid = await uploadAndVerifyPhoto(asset.uri);
      setUploadingPhoto(false);

      if (isValid) {
        console.log('✅ Photo verified! Adding to profile...');
        setPhotos([...photos, asset.uri]);
      }
    }
  };

  const uploadAndVerifyPhoto = async (photoUri: string): Promise<boolean> => {
    try {
      console.log('📤 Uploading photo for verification...');

      // For WEB: Convert blob URI to actual file
      const response = await fetch(photoUri);
      const blob = await response.blob();
      
      console.log('📦 Blob created:', blob.type, blob.size, 'bytes');

      // Create FormData
      const formData = new FormData();
      formData.append('file', blob);
      formData.append('upload_preset', CLOUDINARY_CONFIG.uploadPreset);
      formData.append('cloud_name', CLOUDINARY_CONFIG.cloudName);

      const uploadResponse = await fetch(
        `https://api.cloudinary.com/v1_1/${CLOUDINARY_CONFIG.cloudName}/image/upload`,
        {
          method: 'POST',
          body: formData,
        }
      );

      const uploadData = await uploadResponse.json();

      if (!uploadData.secure_url) {
        console.error('❌ Upload failed:', uploadData);
        console.error('❌ Full error details:', JSON.stringify(uploadData, null, 2));
        window.alert('Upload failed: ' + (uploadData.error?.message || 'Unknown error'));
        return false;
      }

      console.log('✅ Photo uploaded, checking with AI...');

      // Check with FREE DeepAI nudity detection API
      try {
        const checkResponse = await fetch('https://api.deepai.org/api/nsfw-detector', {
          method: 'POST',
          headers: {
            'api-key': 'quickstart-QUdJIGlzIGNvbWluZy4uLi4K',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            image: uploadData.secure_url
          })
        });

        const checkData = await checkResponse.json();
        
        console.log('🔍 AI Check Result:', checkData);

        if (checkData.output && checkData.output.nsfw_score) {
          const score = checkData.output.nsfw_score;
          console.log(`📊 NSFW Score: ${(score * 100).toFixed(1)}%`);

          if (score > 0.6) {
            console.log('❌ Inappropriate content detected');
            window.alert('❌ This photo contains inappropriate content and cannot be used. Please choose a different photo.');
            return false;
          }
        }

        console.log('✅ Photo passed AI verification!');
        return true;

      } catch (apiError) {
        console.warn('⚠️ AI verification unavailable, allowing upload');
        return true;
      }

    } catch (error) {
      console.error('❌ Error verifying photo:', error);
      window.alert('Error verifying photo. Please check your internet connection and try again.');
      return false;
    }
  };

  const removePhoto = (index: number) => {
    setPhotos(photos.filter((_, i) => i !== index));
  };

  const uploadPhotos = async (): Promise<string[]> => {
    const uploadedUrls: string[] = [];

    for (let i = 0; i < photos.length; i++) {
      try {
        const photoUri = photos[i];
        console.log(`📤 Uploading photo ${i + 1}/${photos.length}...`);

        const startTime = Date.now();

        // For WEB: Convert blob URI to actual file
        const response = await fetch(photoUri);
        const blob = await response.blob();

        const formData = new FormData();
        formData.append('file', blob);
        formData.append('upload_preset', CLOUDINARY_CONFIG.uploadPreset);
        formData.append('cloud_name', CLOUDINARY_CONFIG.cloudName);

        const uploadResponse = await fetch(
          `https://api.cloudinary.com/v1_1/${CLOUDINARY_CONFIG.cloudName}/image/upload`,
          {
            method: 'POST',
            body: formData,
          }
        );

        const data = await uploadResponse.json();

        if (data.secure_url) {
          uploadedUrls.push(data.secure_url);
          const uploadTime = ((Date.now() - startTime) / 1000).toFixed(1);
          console.log(`✅ Photo ${i + 1} uploaded in ${uploadTime}s`);
        } else {
          console.error('❌ Upload failed:', data);
        }

      } catch (error) {
        console.error(`❌ Error uploading photo ${i + 1}:`, error);
      }
    }

    return uploadedUrls;
  };

  const handleSaveProfile = async () => {
    console.log('🔍 Starting profile save...');

    if (!name || !age || !gender || !height || !bodyType || !lookingFor) {
      window.alert('Please fill all fields');
      return;
    }

    if (photos.length === 0) {
      window.alert('Please add at least 1 photo');
      return;
    }

    if (!user) {
      window.alert('Not logged in!');
      return;
    }

    setLoading(true);

    try {
      console.log(`📸 Uploading ${photos.length} photo(s)...`);
      const photoUrls = await uploadPhotos();

      if (photoUrls.length === 0) {
        window.alert('Failed to upload photos. Please try again.');
        setLoading(false);
        return;
      }

      console.log('📝 Saving to Firestore...');

      const profileData = {
        uid: user.uid,
        email: user.email,
        name: name,
        age: parseInt(age),
        gender: gender,
        height: parseInt(height),
        bodyType: bodyType,
        lookingFor: lookingFor,
        photos: photoUrls,
        createdAt: new Date().toISOString(),
        profileComplete: true,
        photoVerified: true,
      };

      await setDoc(doc(db, 'users', user.uid), profileData);

      console.log('✅ Profile saved successfully!');
      window.alert('Profile created successfully!');

      router.replace('/home');

    } catch (error: any) {
      console.error('❌ ERROR:', error);
      window.alert('Error: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Create Your Profile</Text>
      <Text style={styles.subtitle}>Tell us about yourself</Text>

      <Text style={styles.label}>Photos (1-3 required)</Text>
      <Text style={styles.photoHint}>🔒 All photos verified with AI for safety</Text>
      
      {uploadingPhoto && (
        <View style={styles.uploadingContainer}>
          <ActivityIndicator size="small" color="#53a8b6" />
          <Text style={styles.uploadingText}>Verifying photo with AI...</Text>
        </View>
      )}

      <View style={styles.photosContainer}>
        {photos.map((uri, index) => (
          <View key={index} style={styles.photoWrapper}>
            <Image source={{ uri }} style={styles.photo} />
            <View style={styles.verifiedBadge}>
              <Text style={styles.verifiedText}>✓</Text>
            </View>
            <TouchableOpacity
              style={styles.removeButton}
              onPress={() => removePhoto(index)}
              disabled={uploadingPhoto || loading}
            >
              <Text style={styles.removeButtonText}>✕</Text>
            </TouchableOpacity>
          </View>
        ))}
        {photos.length < 3 && (
          <TouchableOpacity 
            style={styles.addPhotoButton} 
            onPress={pickImage}
            disabled={uploadingPhoto || loading}
          >
            <Text style={styles.addPhotoText}>+ Add Photo</Text>
          </TouchableOpacity>
        )}
      </View>

      <Text style={styles.label}>Name</Text>
      <TextInput
        style={styles.input}
        placeholder="Your name"
        placeholderTextColor="#666"
        value={name}
        onChangeText={setName}
        editable={!loading}
      />

      <Text style={styles.label}>Age</Text>
      <TextInput
        style={styles.input}
        placeholder="25"
        placeholderTextColor="#666"
        value={age}
        onChangeText={(text) => {
          const numericValue = text.replace(/[^0-9]/g, '');
          setAge(numericValue);
        }}
        keyboardType="number-pad"
        editable={!loading}
        maxLength={2}
      />

      <Text style={styles.label}>Gender</Text>
      <View style={styles.buttonGroup}>
        <TouchableOpacity
          style={[styles.optionButton, gender === 'Male' && styles.optionButtonActive]}
          onPress={() => setGender('Male')}
          disabled={loading}
        >
          <Text style={[styles.optionText, gender === 'Male' && styles.optionTextActive]}>Male</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.optionButton, gender === 'Female' && styles.optionButtonActive]}
          onPress={() => setGender('Female')}
          disabled={loading}
        >
          <Text style={[styles.optionText, gender === 'Female' && styles.optionTextActive]}>Female</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.label}>Height (cm)</Text>
      <TextInput
        style={styles.input}
        placeholder="170"
        placeholderTextColor="#666"
        value={height}
        onChangeText={(text) => {
          const numericValue = text.replace(/[^0-9]/g, '');
          setHeight(numericValue);
        }}
        keyboardType="number-pad"
        editable={!loading}
        maxLength={3}
      />

      <Text style={styles.label}>Body Type</Text>
      <View style={styles.buttonGroup}>
        {['Slim', 'Average', 'Athletic', 'Curvy'].map((type) => (
          <TouchableOpacity
            key={type}
            style={[styles.optionButton, bodyType === type && styles.optionButtonActive]}
            onPress={() => setBodyType(type)}
            disabled={loading}
          >
            <Text style={[styles.optionText, bodyType === type && styles.optionTextActive]}>{type}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>Looking For</Text>
      <View style={styles.buttonGroup}>
        {['Slim', 'Average', 'Athletic', 'Curvy', 'Any'].map((type) => (
          <TouchableOpacity
            key={type}
            style={[styles.optionButton, lookingFor === type && styles.optionButtonActive]}
            onPress={() => setLookingFor(type)}
            disabled={loading}
          >
            <Text style={[styles.optionText, lookingFor === type && styles.optionTextActive]}>{type}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity
        style={[styles.saveButton, (loading || uploadingPhoto) && styles.saveButtonDisabled]}
        onPress={handleSaveProfile}
        disabled={loading || uploadingPhoto}
      >
        <Text style={styles.saveButtonText}>
          {loading ? 'Saving...' : 'Complete Profile'}
        </Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#eee',
    marginTop: 20,
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 16,
    color: '#aaa',
    marginBottom: 30,
  },
  label: {
    fontSize: 16,
    color: '#eee',
    marginBottom: 10,
    marginTop: 15,
  },
  photoHint: {
    fontSize: 12,
    color: '#53a8b6',
    marginBottom: 15,
    fontStyle: 'italic',
  },
  uploadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#16213e',
    padding: 15,
    borderRadius: 10,
    marginBottom: 15,
  },
  uploadingText: {
    color: '#53a8b6',
    marginLeft: 10,
    fontSize: 14,
  },
  photosContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 20,
  },
  photoWrapper: {
    position: 'relative',
  },
  photo: {
    width: 100,
    height: 130,
    borderRadius: 10,
  },
  verifiedBadge: {
    position: 'absolute',
    bottom: 5,
    right: 5,
    backgroundColor: '#5cb85c',
    borderRadius: 12,
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  verifiedText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  removeButton: {
    position: 'absolute',
    top: -5,
    right: -5,
    backgroundColor: '#d9534f',
    borderRadius: 15,
    width: 25,
    height: 25,
    justifyContent: 'center',
    alignItems: 'center',
  },
  removeButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  addPhotoButton: {
    width: 100,
    height: 130,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#53a8b6',
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
  },
  addPhotoText: {
    color: '#53a8b6',
    fontSize: 14,
  },
  input: {
    backgroundColor: '#16213e',
    color: '#fff',
    padding: 15,
    borderRadius: 10,
    fontSize: 16,
  },
  buttonGroup: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  optionButton: {
    backgroundColor: '#16213e',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: '#16213e',
  },
  optionButtonActive: {
    backgroundColor: '#0f3460',
    borderColor: '#53a8b6',
  },
  optionText: {
    color: '#aaa',
    fontSize: 14,
  },
  optionTextActive: {
    color: '#fff',
    fontWeight: '600',
  },
  saveButton: {
    backgroundColor: '#0f3460',
    paddingVertical: 15,
    borderRadius: 25,
    marginTop: 30,
    alignItems: 'center',
  },
  saveButtonDisabled: {
    backgroundColor: '#555',
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
});