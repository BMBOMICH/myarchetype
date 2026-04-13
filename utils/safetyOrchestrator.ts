import { scanForMinors } from './childImageSafety';
import {
    detectChildQuestionVelocity,
    detectGroomingSequence,
    detectMeetTheKidsVelocity
} from './childPredatorDetection';
import { analyzeConversation } from './conversationAnalysis';
import { detectSextortionLanguage } from './nciiHashSharing';
import { detectTraffickingCorridor } from './traffickingDetection';

/**
 * Master safety check — called on key events:
 * - Photo upload → scanForMinors
 * - Message sent → conversation analysis + predator detection
 * - Match created → single parent targeting check
 * - Location shared → trafficking corridor check
 */
export async function runSafetyPipeline(
  event: 'photo_upload' | 'message' | 'match' | 'location_share',
  payload: Record<string, any>
) {
  const results: Array<{ detector: string; action: string; detail: string }> = [];

  switch (event) {
    case 'photo_upload': {
      const childScan = await scanForMinors(payload.imageUri);
      if (childScan.action !== 'pass') {
        results.push({
          detector: '#76/#783/#784',
          action: childScan.action,
          detail: `Minor detected (ages: ${childScan.estimatedAges.join(', ')}, confidence: ${childScan.confidence})`,
        });
      }
      break;
    }

    case 'message': {
      // Run all conversation detectors
      const convRisk = analyzeConversation(
        payload.messages,
        payload.senderId
      );

      if (convRisk.offPlatformRedirect.detected) {
        results.push({ detector: '#347', action: 'warn', detail: `Apps mentioned: ${convRisk.offPlatformRedirect.apps.join(', ')}` });
      }

      if (convRisk.financialRequest.detected) {
        results.push({ detector: '#349', action: 'flag', detail: 'Financial request detected' });
      }

      if (convRisk.cryptoScam.detected) {
        results.push({ detector: '#350', action: 'flag', detail: 'Crypto scam pattern detected' });
      }

      if (convRisk.loveBombing.score > 60) {
        results.push({ detector: '#351', action: 'warn_recipient', detail: `Love bombing score: ${convRisk.loveBombing.score}` });
      }

      // Child predator checks
      const childVelocity = detectChildQuestionVelocity(
        payload.messages, payload.senderId
      );
      if (childVelocity) results.push({ detector: childVelocity.detector, action: 'flag', detail: childVelocity.detail });

      const meetKids = detectMeetTheKidsVelocity(
        payload.messages, payload.senderId, payload.conversationStartTime
      );
      if (meetKids) results.push({ detector: meetKids.detector, action: 'restrict', detail: meetKids.detail });

      const grooming = detectGroomingSequence(
        payload.messages, payload.senderId
      );
      if (grooming) results.push({ detector: grooming.detector, action: 'restrict', detail: grooming.detail });

      // Sextortion
      const sextortion = detectSextortionLanguage(payload.latestMessage);
      if (sextortion.detected) {
        results.push({ detector: '#835', action: sextortion.route, detail: `Sextortion ${sextortion.route}` });
      }

      break;
    }

    case 'location_share': {
      const corridor = detectTraffickingCorridor(
        payload.fromLat, payload.fromLng,
        payload.toLat, payload.toLng
      );
      if (corridor.isOnCorridor) {
        results.push({ detector: '#363', action: 'flag', detail: `Trafficking corridor: ${corridor.corridorName}` });
      }
      break;
    }
  }

  // Execute actions
  for (const result of results) {
    await executeAction(result);
  }

  return results;
}

async function executeAction(result: { detector: string; action: string; detail: string }) {
  switch (result.action) {
    case 'block':
      // Prevent upload/action entirely
      break;
    case 'ban_and_report':
      // Ban user + file NCMEC/law enforcement report
      break;
    case 'restrict':
      // Shadow restrict + queue for human review
      break;
    case 'flag':
      // Queue for human moderator
      break;
    case 'warn':
      // Show warning to sender
      break;
    case 'warn_recipient':
      // Show safety warning to recipient
      break;
    case 'crisis':
      // Show crisis resources immediately
      break;
    case 'blur':
      // Auto-blur content pending review
      break;
  }

  // Add to imports in safetyOrchestrator.ts
import { enforceChildPhotoPolicy, scorePredatorAttractionRisk } from './childImageSafety';
import { generateAndShareNciiHash, checkNciiBlocklist } from './nciiProtection';
import { detectFinancialSextortionEscalation } from './financialSextortion';
import { routeSextortionVictimSupport } from './sextortionDetection';
import { detectTraffickingAndRefer } from './traffickingDetection';
import { detectEscalatingBoundaryTesting, detectPhotoRequestPressure } from './predatoryPatterns';
import {
  detectLocationSharingRevoked,
  detectIsolatedLocation,
  detectGeofenceEscape,
  detectReportCluster,
  snapToPrivacyGrid,
  fuzzyDistance,
} from './locationSafety';
import { detectExPartnerMonitoring, detectCoordinatedHarassment } from './postRelationshipAbuse';
import { evaluateReportEscalation } from './infrastructureSecurity';
import { assessLgbtqTargetedRisk, detectBurglaryPattern } from './robberyDetection';

// Add to the runSafetyPipeline switch statement:

case 'message': {
  // ... existing detectors ...

  // #831 Financial sextortion
  const sextortion = detectFinancialSextortionEscalation(
    payload.messages, payload.senderId
  );
  if (sextortion.detected) {
    results.push({
      detector: '#831',
      action: sextortion.action,
      detail: `Financial sextortion: stage=${sextortion.stage}, amount=${sextortion.demandAmount}`,
    });
  }

  // #835 Victim support routing
  const victimSupport = routeSextortionVictimSupport(
    payload.latestMessage, payload.userLocale, payload.userAge
  );
  if (victimSupport.shouldRoute) {
    results.push({
      detector: '#835',
      action: victimSupport.urgency === 'immediate' ? 'crisis' : 'warn',
      detail: `Sextortion victim detected: urgency=${victimSupport.urgency}`,
    });
  }

  // #769 Trafficking referral
  const trafficking = detectTraffickingAndRefer(
    payload.messages, payload.senderId, payload.userCountry
  );
  if (trafficking.shouldRefer) {
    results.push({
      detector: '#769',
      action: trafficking.urgency === 'immediate' ? 'crisis' : 'flag',
      detail: `Trafficking indicators: ${trafficking.indicatorCount} across ${trafficking.indicators.length} categories`,
    });
  }

  // #323 Boundary testing
  const boundaries = detectEscalatingBoundaryTesting(
    payload.messages, payload.senderId, payload.recipientId
  );
  if (boundaries.detected) {
    results.push({
      detector: '#323',
      action: boundaries.action,
      detail: `Boundary escalation level ${boundaries.escalationLevel}: ${boundaries.violations.length} violations`,
    });
  }

  // #324 Photo pressure
  const photoPress = detectPhotoRequestPressure(
    payload.messages, payload.senderId, payload.recipientId
  );
  if (photoPress.detected) {
    results.push({
      detector: '#324',
      action: photoPress.action,
      detail: `${photoPress.requestsAfterDecline} photo requests after decline`,
    });
  }

  break;
}

case 'report': {
  // #863 Report escalation
  const escalation = evaluateReportEscalation(payload.reports);
  if (escalation.shouldEscalate) {
    results.push({
      detector: '#863',
      action: escalation.escalationLevel,
      detail: `${escalation.reportCount} reports from ${escalation.uniqueReporters} reporters → ${escalation.escalationLevel}`,
    });
  }
  break;
}

  // Always log
  console.log(`[SAFETY] ${result.detector}: ${result.action} — ${result.detail}`);
}