import React from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { MAX_BIO_LENGTH, MAX_JOB_LENGTH, MAX_NAME_LENGTH, MAX_SCHOOL_LENGTH, GENDER_OPTIONS } from './constants';
import { s } from './styles';

interface ProfileFormProps {
  displayName: string;
  nameError: string;
  bio: string;
  bioError: string;
  job: string;
  school: string;
  gender: string;
  showGenderPicker: boolean;
  onNameChange: (text: string) => void;
  onBioChange: (text: string) => void;
  onJobChange: (text: string) => void;
  onSchoolChange: (text: string) => void;
  onOpenGenderPicker: () => void;
  onCloseGenderPicker: () => void;
  onSelectGender: (gender: string) => void;
}

export function ProfileForm({
  displayName,
  nameError,
  bio,
  bioError,
  job,
  school,
  gender,
  showGenderPicker,
  onNameChange,
  onBioChange,
  onJobChange,
  onSchoolChange,
  onOpenGenderPicker,
  onCloseGenderPicker,
  onSelectGender,
}: ProfileFormProps) {
  return (
    <>
      <View style={s.fieldSection}>
        <Text style={s.sectionTitle}>Display Name</Text>
        <View style={[s.inputWrap, nameError ? s.inputWrapError : undefined]}>
          <Ionicons name="person-outline" size={18} color="#64648a" style={s.inputIcon} />
          <TextInput
            style={s.input}
            value={displayName}
            onChangeText={onNameChange}
            placeholder="Your name"
            placeholderTextColor="#64648a"
            maxLength={MAX_NAME_LENGTH}
            autoCapitalize="words"
            autoCorrect={false}
            accessibilityLabel="Display name"
          />
        </View>
        {!!nameError && <Text style={s.fieldError}>{nameError}</Text>}
        <Text style={s.fieldHint}>{displayName.length}/{MAX_NAME_LENGTH}</Text>
      </View>

      <View style={s.fieldSection}>
        <Text style={s.sectionTitle}>Bio</Text>
        <View style={[s.inputWrap, s.inputWrapMultiline, bioError ? s.inputWrapError : undefined]}>
          <TextInput
            style={[s.input, s.inputMultiline]}
            value={bio}
            onChangeText={onBioChange}
            placeholder="Tell people about yourself…"
            placeholderTextColor="#64648a"
            maxLength={MAX_BIO_LENGTH}
            multiline
            textAlignVertical="top"
            accessibilityLabel="Bio"
          />
        </View>
        {!!bioError && <Text style={s.fieldError}>{bioError}</Text>}
        <Text style={s.fieldHint}>{bio.length}/{MAX_BIO_LENGTH}</Text>
      </View>

      <View style={s.fieldSection}>
        <Text style={s.sectionTitle}>Job Title</Text>
        <View style={s.inputWrap}>
          <Ionicons name="briefcase-outline" size={18} color="#64648a" style={s.inputIcon} />
          <TextInput
            style={s.input}
            value={job}
            onChangeText={onJobChange}
            placeholder="Your job title"
            placeholderTextColor="#64648a"
            maxLength={MAX_JOB_LENGTH}
            autoCapitalize="words"
            accessibilityLabel="Job title"
          />
        </View>
      </View>

      <View style={s.fieldSection}>
        <Text style={s.sectionTitle}>School</Text>
        <View style={s.inputWrap}>
          <Ionicons name="school-outline" size={18} color="#64648a" style={s.inputIcon} />
          <TextInput
            style={s.input}
            value={school}
            onChangeText={onSchoolChange}
            placeholder="Your school"
            placeholderTextColor="#64648a"
            maxLength={MAX_SCHOOL_LENGTH}
            autoCapitalize="words"
            accessibilityLabel="School"
          />
        </View>
      </View>

      <View style={s.fieldSection}>
        <Text style={s.sectionTitle}>Gender</Text>
        <Pressable
          style={s.inputWrap}
          onPress={onOpenGenderPicker}
          accessibilityLabel="Select gender"
          accessibilityRole="button"
        >
          <Ionicons name="transgender-outline" size={18} color="#64648a" style={s.inputIcon} />
          <Text style={[s.input, !gender && s.inputPlaceholder]}>
            {gender || 'Select gender'}
          </Text>
          <Ionicons name="chevron-forward" size={16} color="#64648a" />
        </Pressable>
      </View>

      {showGenderPicker && (
        <View style={s.genderOverlay}>
          <View style={s.genderCard}>
            <Text style={s.genderTitle}>Gender</Text>
            {GENDER_OPTIONS.map(g => (
              <Pressable
                key={g}
                style={[s.genderOption, gender === g && s.genderOptionSelected]}
                onPress={() => onSelectGender(g)}
                accessibilityLabel={`Select gender: ${g}`}
                accessibilityRole="radio"
                accessibilityState={{ selected: gender === g }}
              >
                <Text style={[s.genderOptionText, gender === g && s.genderOptionTextSelected]}>{g}</Text>
                {gender === g && <Ionicons name="checkmark" size={18} color="#6C63FF" />}
              </Pressable>
            ))}
            <Pressable
              style={s.genderCancel}
              onPress={onCloseGenderPicker}
              accessibilityLabel="Cancel gender selection"
              accessibilityRole="button"
            >
              <Text style={s.genderCancelText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      )}
    </>
  );
}