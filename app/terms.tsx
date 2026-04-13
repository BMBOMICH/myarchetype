/**
 * Terms of Service screen — pure content definition.
 * All layout, styling, and navigation are handled by LegalDocument.
 */

import React from 'react';

import LegalDocument, {
  type LegalSection,
} from '../components/LegalDocument';

const LAST_UPDATED = 'April 2026';

const SECTIONS: readonly LegalSection[] = [
  {
    title: '1. Acceptance of Terms',
    paragraphs: [
      'By creating an account or using MyArchetype ("Service"), operated by Elxan Huseynov ("Operator"), you agree to be bound by these Terms of Service ("Terms"). These Terms incorporate our Privacy Policy, which explains how we collect, use, and disclose your data.',
      'If you do not agree to these Terms, you must not use the Service.',
    ],
  },
  {
    title: '2. Eligibility',
    paragraphs: [
      'You must be at least 18 years old to use MyArchetype. By using our Service, you represent and warrant that:',
      {
        items: [
          'You are at least 18 years old',
          'You have the legal capacity to enter into a binding agreement',
          'You are not prohibited from using the Service under any applicable law',
          'You are not a registered sex offender',
          'You have not been previously permanently banned from the Service',
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
          'Provide accurate, current, and truthful information',
          'Use only your real first name',
          'Take real photos using only your device camera (no uploads allowed)',
          'Keep your login credentials secure and confidential',
          'Not create multiple accounts or fake profiles',
          'Notify us immediately of any unauthorized access to your account',
        ],
      },
    ],
  },
  {
    title: '4. User Conduct',
    paragraphs: [
      'You agree NOT to use the Service to:',
      {
        items: [
          'Harass, bully, stalk, or intimidate other users',
          'Send spam, solicitations, advertisements, or promotional content',
          'Share sexually explicit, pornographic, or violent content',
          'Impersonate another person or entity (catfishing)',
          'Use the app for illegal purposes or to promote illegal activities',
          'Attempt to hack, exploit vulnerabilities, or compromise the app’s security',
          'Collect or scrape personal information from other users',
          'Share your account credentials with others',
          'Use automated systems, scripts, or bots to interact with the app',
          'Post false, misleading, or deceptive information',
          'Engage in hate speech or discrimination based on race, religion, gender, sexual orientation, etc.',
          'Screenshot, record, or distribute other users’ content without their explicit consent (doxxing)',
          'Solicit money, gifts, or financial assistance from other users',
        ],
      },
    ],
  },
  {
    title: '5. Content Ownership and License',
    paragraphs: [
      'You retain all ownership rights to the content you submit to MyArchetype (such as photos, bio text, and quiz responses). By submitting content, you grant us a worldwide, non-exclusive, royalty-free license to use, host, store, reproduce, modify, and distribute your content solely for the purpose of operating, improving, and providing the Service to you and other users.',
      'This license continues as long as your content remains on the Service, and will terminate when you delete your account and associated content, except where residual copies remain in backup systems.',
    ],
  },
  {
    title: '6. Intellectual Property & DMCA',
    paragraphs: [
      'The MyArchetype application, including its original content, features, and functionality, is owned by Elxan Huseynov and is protected by international copyright, trademark, and other intellectual property laws.',
      'If you believe that your copyrighted work has been copied in a way that constitutes copyright infringement, please contact us at support@myarchetype.app with a detailed description of the alleged infringement.',
    ],
  },
  {
    title: '7. Photos and Verification',
    paragraphs: [
      'All photos submitted must be:',
      {
        items: [
          'Taken using your device camera directly within the app (no uploads)',
          'Of yourself only (no photos of other people)',
          'Appropriate, non-explicit, and compliant with our community guidelines',
          'Recent and accurately representative of your current appearance',
        ],
      },
      'We use AI to detect inappropriate content, estimate age, and verify identities. Falsifying verification information, uploading photos of others, or attempting to bypass AI moderation is grounds for immediate account termination.',
    ],
  },
  {
    title: '8. Matching and Communication',
    paragraphs: [
      {
        items: [
          'You can only message users who have mutually matched with you',
          'Messages are encrypted in transit and at rest for your privacy',
          'We are not responsible for the conduct, behavior, or statements of other users',
          'We do not guarantee any matches, dating outcomes, or responses from other users',
        ],
      },
    ],
  },
  {
    title: '9. Rating System',
    paragraphs: [
      'After meeting matches in person, you may be asked to rate your experience to help maintain a safe community. Ratings are:',
      {
        items: [
          'Anonymous to the person being rated',
          'Used to calculate trust scores and identify potentially unsafe users',
          'Subject to review and removal if determined to be abusive or fraudulent',
        ],
      },
      'Submitting fake, retaliatory, or malicious ratings is strictly prohibited and may result in your own account being restricted or banned.',
    ],
  },
  {
    title: '10. Safety and Reporting',
    paragraphs: [
      'Your safety is our priority. You can:',
      {
        items: [
          'Block users at any time from contacting you',
          'Report inappropriate behavior, harassment, or safety concerns',
          'Unmatch and delete conversations permanently',
        ],
      },
      'We review all reports and take appropriate action, which may include warning users, suspending accounts, or permanently banning users who violate these Terms. Always exercise caution when interacting with people online. Meet in public places and inform a friend or family member of your plans.',
    ],
  },
  {
    title: '11. Free Service',
    paragraphs: [
      'MyArchetype is currently 100% free. There are no premium features, subscriptions, or in-app purchases. All features are available to all users equally. We reserve the right to introduce paid features, subscriptions, or in-app purchases in the future. If we do, we will provide clear notice and these Terms will be updated accordingly.',
    ],
  },
  {
    title: '12. Termination',
    paragraphs: [
      'We reserve the right to suspend or terminate your account at any time, without prior notice, for conduct that we determine, in our sole discretion, violates these Terms, is harmful to other users, or compromises the integrity of the Service.',
      'You may delete your account at any time through the app settings. Upon deletion, your profile, matches, and messages will be removed in accordance with our Privacy Policy. If your account is terminated for a violation, you may not re-register for the Service. If you wish to appeal a termination, you may contact us at support@myarchetype.app.',
    ],
  },
  {
    title: '13. Disclaimer of Warranties',
    paragraphs: [
      'MyArchetype is provided on an "AS IS" and "AS AVAILABLE" basis without warranties of any kind, either express or implied. To the fullest extent permitted by law, we disclaim all warranties, express or implied, including but not limited to implied warranties of merchantability, fitness for a particular purpose, and non-infringement.',
      'We do not guarantee:',
      {
        items: [
          'The accuracy, completeness, or truthfulness of user-provided information',
          'The behavior, character, or intent of other users',
          'Successful matches, dates, or relationship outcomes',
          'Uninterrupted, secure, or error-free service availability',
        ],
      },
    ],
  },
  {
    title: '14. Limitation of Liability',
    paragraphs: [
      'To the maximum extent permitted by applicable law, Elxan Huseynov shall not be liable for any indirect, incidental, special, consequential, or punitive damages, including without limitation, loss of profits, data, use, goodwill, or other intangible losses, resulting from:',
      {
        items: [
          'Your access to or use of (or inability to access or use) the Service',
          'Any conduct or content of any third party on the Service',
          'Any content obtained from the Service',
          'Unauthorized access, use, or alteration of your transmissions or content',
        ],
      },
    ],
  },
  {
    title: '15. Indemnification',
    paragraphs: [
      'You agree to defend, indemnify, and hold harmless Elxan Huseynov from and against any claims, liabilities, damages, losses, and expenses, including reasonable legal fees, arising out of or in any way connected with your access to or use of the Service, your violation of these Terms, or your violation of any rights of another party.',
    ],
  },
  {
    title: '16. Govering Law and Jurisdiction',
    paragraphs: [
      'These Terms shall be governed by and construed in accordance with the laws of Azerbaijan, without regard to its conflict of law provisions.',
      'Any disputes arising out of or relating to these Terms or the Service shall be resolved exclusively in the state or federal courts located in Baku, Azerbaijan, and you consent to the personal jurisdiction of such courts.',
    ],
  },
  {
    title: '17. Changes to Terms',
    paragraphs: [
      'We may modify these Terms at any time. If we make material changes, we will notify you via in-app notification or email prior to the new Terms taking effect. Your continued use of the Service after the updated Terms become effective constitutes your acceptance of the changes. If you do not agree to the updated Terms, you must stop using the Service and delete your account.',
    ],
  },
  {
    title: '18. Severability',
    paragraphs: [
      'If any provision of these Terms is held to be unenforceable or invalid, such provision will be changed and interpreted to accomplish its objectives to the greatest extent possible under applicable law, and the remaining provisions will continue in full force and effect.',
    ],
  },
  {
    title: '19. Entire Agreement',
    paragraphs: [
      'These Terms, together with our Privacy Policy, constitute the entire agreement between you and Elxan Huseynov regarding the use of the Service, superseding any prior agreements or understandings.',
    ],
  },
  {
    title: '20. Contact Us',
    paragraphs: [
      'For questions about these Terms of Service, please contact us:',
      'Elxan Huseynov',
      'Yeni Guneshli, Surakhani District',
      'Email: support@myarchetype.app',
    ],
  },
];

export default function TermsOfServiceScreen() {
  return (
    <LegalDocument
      title="Terms of Service"
      lastUpdated={LAST_UPDATED}
      sections={SECTIONS}
      footerText="By using MyArchetype, you agree to these Terms of Service."
    />
  );
}