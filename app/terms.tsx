/**
 * Terms of Service screen — pure content definition.
 * All layout, styling, and navigation are handled by LegalDocument.
 */

import React from 'react';

import LegalDocument, {
  type LegalSection,
} from '../components/LegalDocument';

const SECTIONS: readonly LegalSection[] = [
  {
    title: '1. Acceptance of Terms',
    paragraphs: [
      'By creating an account or using MyArchetype, you agree to be bound by these Terms of Service. If you do not agree to these terms, do not use our service.',
    ],
  },
  {
    title: '2. Eligibility',
    paragraphs: [
      'You must be at least 18 years old to use MyArchetype. By using our service, you represent and warrant that:',
      {
        items: [
          'You are at least 18 years old',
          'You have the legal capacity to enter into these terms',
          'You are not prohibited from using the service under any applicable law',
          'You are not a convicted sex offender',
        ],
      },
    ],
  },
  {
    title: '3. Account Registration',
    paragraphs: [
      'When creating an account, you agree to:',
      {
        items: [
          'Provide accurate and truthful information',
          'Use only your real first name',
          'Take real photos using only the camera (no uploads)',
          'Keep your login credentials secure',
          'Not create multiple accounts',
          'Notify us immediately of any unauthorized access',
        ],
      },
    ],
  },
  {
    title: '4. User Conduct',
    paragraphs: [
      'You agree NOT to:',
      {
        items: [
          'Harass, bully, or intimidate other users',
          'Send spam, solicitations, or advertisements',
          'Share sexually explicit or pornographic content',
          'Impersonate another person or create a fake identity',
          'Use the app for illegal purposes',
          'Attempt to hack or exploit vulnerabilities',
          'Collect personal information from other users',
          'Share your account with others',
          'Use automated systems or bots',
          'Post false or misleading information',
        ],
      },
    ],
  },
  {
    title: '5. Photos and Content',
    paragraphs: [
      'All photos must be:',
      {
        items: [
          'Taken using your device camera (no uploads)',
          'Of yourself (no photos of others)',
          'Appropriate and non-explicit',
          'Recent and accurately represent your appearance',
        ],
        footer:
          'We use AI to detect inappropriate content and verify identities. Violations may result in immediate account termination.',
      },
    ],
  },
  {
    title: '6. Verification System',
    paragraphs: [
      'MyArchetype offers optional verification to build trust:',
      {
        items: [
          'Selfie verification (identity confirmation)',
          'Height verification',
          'Age verification via AI',
        ],
        footer:
          'Falsifying verification information is grounds for permanent ban.',
      },
    ],
  },
  {
    title: '7. Matching and Communication',
    paragraphs: [
      {
        items: [
          'You can only message users who have mutually matched with you',
          'Messages are encrypted for your privacy',
          'We are not responsible for the behavior of other users',
          'We do not guarantee any matches or dating outcomes',
        ],
      },
    ],
  },
  {
    title: '8. Rating System',
    paragraphs: [
      'After meeting matches in person, you may rate your experience. Ratings are:',
      {
        items: [
          'Anonymous to the person being rated',
          'Used to calculate trust scores',
          'Subject to review for abuse',
        ],
        footer: 'Fake or malicious ratings are prohibited.',
      },
    ],
  },
  {
    title: '9. Safety and Reporting',
    paragraphs: [
      'Your safety is important. You can:',
      {
        items: [
          'Block users at any time',
          'Report inappropriate behavior',
          'Unmatch and delete conversations',
        ],
        footer:
          'We review all reports and take appropriate action, including banning users who violate our terms.',
      },
    ],
  },
  {
    title: '10. Free Service',
    paragraphs: [
      'MyArchetype is 100% free. There are no premium features, subscriptions, or in-app purchases. All features are available to all users equally.',
    ],
  },
  {
    title: '11. Termination',
    paragraphs: [
      'We reserve the right to terminate or suspend your account at any time for violations of these terms, without prior notice. You may also delete your account at any time through the app settings.',
    ],
  },
  {
    title: '12. Disclaimer of Warranties',
    paragraphs: [
      'MyArchetype is provided "as is" without warranties of any kind. We do not guarantee:',
      {
        items: [
          'The accuracy of user information',
          'The behavior of other users',
          'Successful matches or relationships',
          'Uninterrupted service availability',
        ],
      },
    ],
  },
  {
    title: '13. Limitation of Liability',
    paragraphs: [
      'To the maximum extent permitted by law, MyArchetype shall not be liable for any indirect, incidental, special, consequential, or punitive damages arising from your use of the service.',
    ],
  },
  {
    title: '14. Changes to Terms',
    paragraphs: [
      'We may modify these terms at any time. Continued use of the service after changes constitutes acceptance of the new terms. We will notify you of significant changes.',
    ],
  },
  {
    title: '15. Contact Us',
    paragraphs: [
      'For questions about these Terms of Service:\n\nEmail: support@myarchetype.app',
    ],
  },
];

export default function TermsOfServiceScreen() {
  return (
    <LegalDocument
      title="Terms of Service"
      lastUpdated="January 2025"
      sections={SECTIONS}
      footerText="By using MyArchetype, you agree to these Terms of Service."
    />
  );
}