/**
 * Privacy Policy screen — pure content definition.
 * All layout, styling, and navigation are handled by LegalDocument.
 */

import React from 'react';

import LegalDocument, {
  type LegalSection,
} from '../components/LegalDocument';

const SECTIONS: readonly LegalSection[] = [
  {
    title: '1. Introduction',
    paragraphs: [
      'Welcome to MyArchetype ("we," "our," or "us"). We are committed to protecting your privacy and personal information. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our mobile application.',
    ],
  },
  {
    title: '2. Information We Collect',
    paragraphs: [
      {
        heading: 'Personal Information:',
        items: [
          'Name and age',
          'Email address',
          'Photos (taken via camera only)',
          'Location (city/country)',
          'Physical attributes (height, body type)',
          'Personality quiz responses',
          'Religious views and lifestyle preferences',
        ],
      },
      {
        heading: 'Usage Information:',
        items: [
          'App interactions (likes, matches, messages)',
          'Device information',
          'Online status and last active time',
        ],
      },
    ],
  },
  {
    title: '3. How We Use Your Information',
    paragraphs: [
      {
        items: [
          'To create and manage your account',
          'To match you with compatible users',
          'To facilitate communication between matches',
          'To verify your identity and prevent fraud',
          'To improve our services and user experience',
          'To send notifications about matches and messages',
          'To enforce our Terms of Service',
        ],
      },
    ],
  },
  {
    title: '4. Photo Verification',
    paragraphs: [
      'We use AI-powered verification to:',
      {
        items: [
          'Detect inappropriate content',
          'Estimate age for verification purposes',
          'Verify identity through selfie matching',
        ],
        footer: 'Photos are processed securely and stored encrypted.',
      },
    ],
  },
  {
    title: '5. Data Security',
    paragraphs: [
      {
        items: [
          'All messages are encrypted end-to-end',
          'Photos are stored on secure cloud servers',
          'We use Firebase Authentication for secure login',
          'We never sell your personal data to third parties',
        ],
      },
    ],
  },
  {
    title: '6. Data Retention',
    paragraphs: [
      'We retain your data while your account is active. You can delete your account at any time, which will permanently remove all your data including:',
      {
        items: [
          'Profile information and photos',
          'Match history and conversations',
          'Ratings and verification status',
        ],
      },
    ],
  },
  {
    title: '7. Your Rights',
    paragraphs: [
      'You have the right to:',
      {
        items: [
          'Access your personal data',
          'Correct inaccurate data',
          'Delete your account and data',
          'Object to data processing',
          'Export your data',
        ],
        footer:
          'To exercise these rights, contact us or use the in-app settings.',
      },
    ],
  },
  {
    title: '8. Third-Party Services',
    paragraphs: [
      'We use the following third-party services:',
      {
        items: [
          'Firebase (authentication, database)',
          'Cloudinary (photo storage)',
          'DeepAI (content moderation)',
          'Expo (push notifications)',
        ],
        footer: 'Each service has its own privacy policy.',
      },
    ],
  },
  {
    title: '9. Children\'s Privacy',
    paragraphs: [
      'MyArchetype is intended for users 18 years and older. We do not knowingly collect information from anyone under 18. If we discover a user is under 18, their account will be immediately terminated.',
    ],
  },
  {
    title: '10. Contact Us',
    paragraphs: [
      'If you have questions about this Privacy Policy, contact us at:\n\nEmail: privacy@myarchetype.app\n\nWe will respond within 30 days.',
    ],
  },
  {
    title: '11. Changes to This Policy',
    paragraphs: [
      'We may update this Privacy Policy from time to time. We will notify you of any changes by posting the new Privacy Policy on this page and updating the "Last Updated" date.',
    ],
  },
];

export default function PrivacyPolicyScreen() {
  return (
    <LegalDocument
      title="Privacy Policy"
      lastUpdated="January 2025"
      sections={SECTIONS}
      footerText="By using MyArchetype, you agree to this Privacy Policy."
    />
  );
}