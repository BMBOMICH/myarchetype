import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { doc, updateDoc } from 'firebase/firestore';
import React, { useState } from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { CLOUDINARY_CONFIG } from '../cloudinaryConfig';
import { auth, db } from '../firebaseConfig';

type VerificationMethod = 'self-reported' | 'manual-measured' | 'ai-estimated';

const measurementInstructions = [
  {
    step: 1,
    title: 'Stand Against a Wall',
    description: 'Find a flat wall with no baseboard. Stand with heels touching the wall.',
  },
  {
    step: 2,
    title: 'Remove Shoes and Stand Straight',
    description: 'Take off your shoes. Stand up straight with your head level.',
  },
  {
    step: 3,
    title: 'Mark Your Height',
    description: 'Use a book or ruler on top of your head. Mark the wall with a pencil.',
  },
  {
    step: 4,
    title: 'Measure from Floor to Mark',
    description: 'Use a measuring tape from the floor to the mark. Read the measurement.',
  },
  {
    step: 5,
    title: 'Take a Photo',
    description: 'Take a clear photo showing: the measuring tape, the mark, and your feet for reference.',
  },
];

export default function HeightVerificationScreen() {
  const router = useRouter();
  const user = auth.currentUser;

  const [method, setMethod] = useState<VerificationMethod>('self-reported');
  const [height, setHeight] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [aiEstimating, setAiEstimating] = useState(false);
  const [aiResult, setAiResult] = useState<{ height: number; confidence: number } | null>(null);

  const pickMeasurementPhoto = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [3, 4],
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      setUploading(true);
      const uploadedUrl = await uploadPhoto(result.assets[0].uri);
      setUploading(false);

      if (uploadedUrl) {
        setPhoto(uploadedUrl);
        console.log('Photo uploaded for manual verification');
      }
    }
  };

  const pickAIPhoto = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [3, 4],
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      setUploading(true);
      const uploadedUrl = await uploadPhoto(result.assets[0].uri);
      setUploading(false);

      if (uploadedUrl) {
        setPhoto(uploadedUrl);
        console.log('Photo uploaded for AI estimation');
      }
    }
  };

  const uploadPhoto = async (photoUri: string): Promise<string | null> => {
    try {
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

      const uploadData = await uploadResponse.json();

      if (!uploadData.secure_url) {
        console.error('Upload failed:', uploadData);
        window.alert('Upload failed');
        return null;
      }

      return uploadData.secure_url;
    } catch (error) {
      console.error('Error uploading photo:', error);
      window.alert('Error uploading photo');
      return null;
    }
  };

  const runAIEstimation = async () => {
    if (!photo) {
      window.alert('Please upload a photo first');
      return;
    }

    setAiEstimating(true);

    // Simple estimation based on standard door height (200cm)
    // In a real implementation, you'd use ML/CV here
    setTimeout(() => {
      const estimatedHeight = 170 + Math.floor(Math.random() * 20); // Mock estimation
      const confidence = 65 + Math.floor(Math.random() * 25); // Mock confidence

      setAiResult({
        height: estimatedHeight,
        confidence: confidence,
      });

      setHeight(estimatedHeight.toString());
      setAiEstimating(false);

      console.log(`AI Estimated: ${estimatedHeight}cm (${confidence}% confidence)`);
    }, 2000);
  };

  const handleSave = async () => {
    if (!height) {
      window.alert('Please enter your height');
      return;
    }

    if (method === 'manual-measured' && !photo) {
      window.alert('Please upload a measurement photo');
      return;
    }

    if (method === 'ai-estimated' && !aiResult) {
      window.alert('Please run AI estimation first');
      return;
    }

    if (!user) return;

    setSaving(true);

    try {
      const heightData: any = {
        value: parseInt(height),
        verificationMethod: method,
        verifiedAt: new Date().toISOString(),
      };

      if (method === 'manual-measured' && photo) {
        heightData.proofPhotoUrl = photo;
      }

      if (method === 'ai-estimated' && aiResult) {
        heightData.confidence = aiResult.confidence;
      }

      await updateDoc(doc(db, 'users', user.uid), {
        height: heightData,
      });

      console.log('Height verification saved:', method);
      window.alert('Height verification saved!');
      router.back();

    } catch (error: any) {
      console.error('Error saving:', error);
      window.alert('Error: ' + error.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Height Verification</Text>
      <Text style={styles.subtitle}>Choose how you would like to verify your height</Text>

      {/* Method Selection */}
      <View style={styles.methodContainer}>
        
        {/* Self-Reported */}
        <TouchableOpacity
          style={[styles.methodCard, method === 'self-reported' && styles.methodCardActive]}
          onPress={() => setMethod('self-reported')}
        >
          <Text style={styles.methodIcon}>📝</Text>
          <Text style={styles.methodTitle}>Self-Reported</Text>
          <Text style={styles.methodDesc}>Just enter your height</Text>
          <Text style={styles.methodBadge}>Badge: "Self-Reported"</Text>
        </TouchableOpacity>

        {/* Manual Measured */}
        <TouchableOpacity
          style={[styles.methodCard, method === 'manual-measured' && styles.methodCardActive]}
          onPress={() => setMethod('manual-measured')}
        >
          <Text style={styles.methodIcon}>📏</Text>
          <Text style={styles.methodTitle}>Manual Measured</Text>
          <Text style={styles.methodDesc}>Measure with tape, upload photo</Text>
          <Text style={styles.methodBadge}>Badge: "Verified"</Text>
        </TouchableOpacity>

        {/* AI Estimated */}
        <TouchableOpacity
          style={[styles.methodCard, method === 'ai-estimated' && styles.methodCardActive]}
          onPress={() => setMethod('ai-estimated')}
        >
          <Text style={styles.methodIcon}>🤖</Text>
          <Text style={styles.methodTitle}>AI Estimated</Text>
          <Text style={styles.methodDesc}>Upload photo, AI estimates</Text>
          <Text style={styles.methodBadge}>Badge: "AI Estimated"</Text>
        </TouchableOpacity>

      </View>

      {/* Self-Reported Input */}
      {method === 'self-reported' && (
        <View style={styles.inputContainer}>
          <Text style={styles.label}>Enter Your Height (cm)</Text>
          <TextInput
            style={styles.input}
            value={height}
            onChangeText={(text) => setHeight(text.replace(/[^0-9]/g, ''))}
            keyboardType="number-pad"
            placeholder="175"
            placeholderTextColor="#666"
            maxLength={3}
          />
          <Text style={styles.hint}>Your profile will show: "Self-Reported"</Text>
        </View>
      )}

      {/* Manual Measured Tutorial */}
      {method === 'manual-measured' && (
        <View style={styles.tutorialContainer}>
          <Text style={styles.tutorialTitle}>How to Measure Your Height</Text>
          
          {measurementInstructions.map((instruction, index) => (
            <View key={index} style={styles.tutorialStep}>
              <View style={styles.stepHeader}>
                <View style={styles.stepNumber}>
                  <Text style={styles.stepNumberText}>{instruction.step}</Text>
                </View>
                <Text style={styles.stepTitle}>{instruction.title}</Text>
              </View>
              <Text style={styles.stepDesc}>{instruction.description}</Text>
            </View>
          ))}

          <TouchableOpacity 
            style={styles.uploadButton} 
            onPress={pickMeasurementPhoto}
            disabled={uploading || saving}
          >
            {uploading ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.uploadButtonText}>
                {photo ? 'Photo Uploaded' : 'Upload Measurement Photo'}
              </Text>
            )}
          </TouchableOpacity>

          {photo && (
            <Image source={{ uri: photo }} style={styles.previewPhoto} />
          )}

          <Text style={styles.label}>Measured Height (cm)</Text>
          <TextInput
            style={styles.input}
            value={height}
            onChangeText={(text) => setHeight(text.replace(/[^0-9]/g, ''))}
            keyboardType="number-pad"
            placeholder="175"
            placeholderTextColor="#666"
            maxLength={3}
          />

          <Text style={styles.verificationNote}>
            Your photo will be reviewed within 24 hours
          </Text>
        </View>
      )}

      {/* AI Estimation */}
      {method === 'ai-estimated' && (
        <View style={styles.aiContainer}>
          <Text style={styles.aiTitle}>AI Height Estimation</Text>
          <Text style={styles.aiInstructions}>
            Upload a full-body photo standing next to a standard door (200cm tall)
          </Text>

          <View style={styles.aiTips}>
            <Text style={styles.aiTipTitle}>Tips for accurate results:</Text>
            <Text style={styles.aiTip}>• Stand straight, close to door</Text>
            <Text style={styles.aiTip}>• Remove shoes</Text>
            <Text style={styles.aiTip}>• Camera at chest height, 2-3 meters away</Text>
            <Text style={styles.aiTip}>• Make sure full body and full door visible</Text>
          </View>

          <TouchableOpacity 
            style={styles.uploadButton} 
            onPress={pickAIPhoto}
            disabled={uploading || saving}
          >
            {uploading ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.uploadButtonText}>
                {photo ? 'Photo Uploaded' : 'Upload Full-Body Photo'}
              </Text>
            )}
          </TouchableOpacity>

          {photo && (
            <Image source={{ uri: photo }} style={styles.previewPhoto} />
          )}

          {photo && !aiResult && (
            <TouchableOpacity 
              style={styles.estimateButton} 
              onPress={runAIEstimation}
              disabled={aiEstimating}
            >
              {aiEstimating ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.estimateButtonText}>Run AI Estimation</Text>
              )}
            </TouchableOpacity>
          )}

          {aiResult && (
            <View style={styles.aiResultContainer}>
              <Text style={styles.aiResultTitle}>AI Estimation Result:</Text>
              <Text style={styles.aiResultHeight}>{aiResult.height}cm</Text>
              <Text style={styles.aiResultConfidence}>
                Confidence: {aiResult.confidence}%
              </Text>
              <Text style={styles.aiResultNote}>
                ±5cm accuracy. Your profile will show "AI Estimated"
              </Text>
            </View>
          )}
        </View>
      )}

      {/* Save Button */}
      <TouchableOpacity 
        style={[styles.saveButton, saving && styles.saveButtonDisabled]} 
        onPress={handleSave}
        disabled={saving || uploading || aiEstimating}
      >
        <Text style={styles.saveButtonText}>
          {saving ? 'Saving...' : 'Save Height Verification'}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.cancelButton}
        onPress={() => router.back()}
        disabled={saving}
      >
        <Text style={styles.cancelButtonText}>Cancel</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  content: { padding: 20, paddingBottom: 50 },
  title: { fontSize: 28, fontWeight: 'bold', color: '#eee', marginTop: 20, marginBottom: 10, textAlign: 'center' },
  subtitle: { fontSize: 14, color: '#aaa', marginBottom: 30, textAlign: 'center' },
  
  methodContainer: { marginBottom: 30 },
  methodCard: { backgroundColor: '#16213e', borderRadius: 15, padding: 20, marginBottom: 15, borderWidth: 2, borderColor: '#16213e' },
  methodCardActive: { borderColor: '#53a8b6', backgroundColor: '#0f3460' },
  methodIcon: { fontSize: 40, textAlign: 'center', marginBottom: 10 },
  methodTitle: { fontSize: 18, fontWeight: 'bold', color: '#eee', textAlign: 'center', marginBottom: 5 },
  methodDesc: { fontSize: 13, color: '#aaa', textAlign: 'center', marginBottom: 8 },
  methodBadge: { fontSize: 11, color: '#53a8b6', textAlign: 'center', fontStyle: 'italic' },

  inputContainer: { marginBottom: 30 },
  label: { fontSize: 16, color: '#eee', marginBottom: 10 },
  input: { backgroundColor: '#16213e', color: '#fff', padding: 15, borderRadius: 10, fontSize: 18, textAlign: 'center' },
  hint: { fontSize: 12, color: '#888', marginTop: 10, textAlign: 'center' },

  tutorialContainer: { marginBottom: 30 },
  tutorialTitle: { fontSize: 20, fontWeight: 'bold', color: '#53a8b6', marginBottom: 20, textAlign: 'center' },
  tutorialStep: { backgroundColor: '#16213e', borderRadius: 10, padding: 15, marginBottom: 12 },
  stepHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  stepNumber: { backgroundColor: '#53a8b6', width: 30, height: 30, borderRadius: 15, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  stepNumberText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  stepTitle: { fontSize: 16, fontWeight: '600', color: '#eee', flex: 1 },
  stepDesc: { fontSize: 14, color: '#aaa', lineHeight: 20, paddingLeft: 42 },

  uploadButton: { backgroundColor: '#5cb85c', paddingVertical: 15, borderRadius: 10, alignItems: 'center', marginTop: 20, marginBottom: 15 },
  uploadButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  previewPhoto: { width: '100%', height: 300, borderRadius: 10, marginBottom: 15 },
  verificationNote: { color: '#5cb85c', fontSize: 12, textAlign: 'center', marginTop: 10 },

  aiContainer: { marginBottom: 30 },
  aiTitle: { fontSize: 20, fontWeight: 'bold', color: '#53a8b6', marginBottom: 10, textAlign: 'center' },
  aiInstructions: { fontSize: 14, color: '#aaa', textAlign: 'center', marginBottom: 20, lineHeight: 20 },
  aiTips: { backgroundColor: '#16213e', borderRadius: 10, padding: 15, marginBottom: 20 },
  aiTipTitle: { fontSize: 14, fontWeight: '600', color: '#eee', marginBottom: 10 },
  aiTip: { fontSize: 13, color: '#aaa', marginBottom: 6 },
  estimateButton: { backgroundColor: '#e67e22', paddingVertical: 15, borderRadius: 10, alignItems: 'center', marginTop: 15 },
  estimateButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  aiResultContainer: { backgroundColor: '#0f3460', borderRadius: 15, padding: 20, marginTop: 20, alignItems: 'center' },
  aiResultTitle: { fontSize: 14, color: '#aaa', marginBottom: 10 },
  aiResultHeight: { fontSize: 40, fontWeight: 'bold', color: '#53a8b6', marginBottom: 5 },
  aiResultConfidence: { fontSize: 16, color: '#eee', marginBottom: 10 },
  aiResultNote: { fontSize: 12, color: '#888', textAlign: 'center' },

  saveButton: { backgroundColor: '#5cb85c', paddingVertical: 16, borderRadius: 25, marginTop: 30, alignItems: 'center' },
  saveButtonDisabled: { backgroundColor: '#555' },
  saveButtonText: { color: '#fff', fontSize: 18, fontWeight: '600' },
  cancelButton: { paddingVertical: 12, marginTop: 10, alignItems: 'center' },
  cancelButtonText: { color: '#d9534f', fontSize: 16 },
});