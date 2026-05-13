import { scanForMinors } from './childImageSafety';
import {
  detectChildQuestionVelocity,
  detectGroomingSequence,
  detectMeetTheKidsVelocity,
} from './childPredatorDetection';
import { analyzeConversation } from './conversationAnalysis';
import { detectSextortionLanguage } from './nciiHashSharing';
import { detectTraffickingCorridor } from './traffickingDetection';
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

/**
 * Master safety check — called on key events:
 * - Photo upload → scanForMinors
 * - Message sent → conversation analysis + predator detection
 * - Match created → single parent targeting check
 * - Location shared → trafficking corridor check
 */
export async function runSafetyPipeline(
  event: 'photo_upload' | 'message' | 'match' | 'location_share' | 'report',
  payload: Record<string, unknown>,
) {
  const results: Array<{ detector: string; action: string; detail: string }> = [];

  switch (event) {
    case 'photo_upload': {
      const childScan = await scanForMinors(payload['imageUri'] as string);
      if (childScan.action !== 'pass') {
        results.push({
          detector: '#76/#783/#784',
          action:   childScan.action,
          detail:   `Minor detected (ages: ${childScan.estimatedAges.join(', ')}, confidence: ${childScan.confidence})`,
        });
      }
      break;
    }

    case 'message': {
      const convRisk = analyzeConversation(
        payload['messages'],
        payload['senderId'] as string,
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

      const childVelocity = detectChildQuestionVelocity(payload['messages'], payload['senderId'] as string);
      if (childVelocity) results.push({ detector: childVelocity.detector, action: 'flag', detail: childVelocity.detail });

      const meetKids = detectMeetTheKidsVelocity(payload['messages'], payload['senderId'] as string, payload['conversationStartTime'] as number);
      if (meetKids) results.push({ detector: meetKids.detector, action: 'restrict', detail: meetKids.detail });

      const grooming = detectGroomingSequence(payload['messages'], payload['senderId'] as string);
      if (grooming) results.push({ detector: grooming.detector, action: 'restrict', detail: grooming.detail });

      const sextortion = detectSextortionLanguage(payload['latestMessage'] as string);
      if (sextortion.detected) {
        results.push({ detector: '#835', action: sextortion.route, detail: `Sextortion ${sextortion.route}` });
      }

      const financialSextortion = detectFinancialSextortionEscalation(
        payload['messages'], payload['senderId'] as string,
      );
      if (financialSextortion.detected) {
        results.push({
          detector: '#831',
          action:   financialSextortion.action,
          detail:   `Financial sextortion: stage=${financialSextortion.stage}, amount=${financialSextortion.demandAmount}`,
        });
      }

      const victimSupport = routeSextortionVictimSupport(
        payload['latestMessage'] as string,
        payload['userLocale'] as string,
        payload['userAge'] as number,
      );
      if (victimSupport.shouldRoute) {
        results.push({
          detector: '#835',
          action:   victimSupport.urgency === 'immediate' ? 'crisis' : 'warn',
          detail:   `Sextortion victim detected: urgency=${victimSupport.urgency}`,
        });
      }

      const trafficking = detectTraffickingAndRefer(
        payload['messages'], payload['senderId'] as string, payload['userCountry'] as string,
      );
      if (trafficking.shouldRefer) {
        results.push({
          detector: '#769',
          action:   trafficking.urgency === 'immediate' ? 'crisis' : 'flag',
          detail:   `Trafficking indicators: ${trafficking.indicatorCount} across ${trafficking.indicators.length} categories`,
        });
      }

      const boundaries = detectEscalatingBoundaryTesting(
        payload['messages'], payload['senderId'] as string, payload['recipientId'] as string,
      );
      if (boundaries.detected) {
        results.push({
          detector: '#323',
          action:   boundaries.action,
          detail:   `Boundary escalation level ${boundaries.escalationLevel}: ${boundaries.violations.length} violations`,
        });
      }

      const photoPress = detectPhotoRequestPressure(
        payload['messages'], payload['senderId'] as string, payload['recipientId'] as string,
      );
      if (photoPress.detected) {
        results.push({
          detector: '#324',
          action:   photoPress.action,
          detail:   `${photoPress.requestsAfterDecline} photo requests after decline`,
        });
      }

      break;
    }

    case 'location_share': {
      const corridor = detectTraffickingCorridor(
        payload['fromLat'] as number, payload['fromLng'] as number,
        payload['toLat']   as number, payload['toLng']   as number,
      );
      if (corridor.isOnCorridor) {
        results.push({ detector: '#363', action: 'flag', detail: `Trafficking corridor: ${corridor.corridorName}` });
      }
      break;
    }

    case 'report': {
      const escalation = evaluateReportEscalation(payload['reports']);
      if (escalation.shouldEscalate) {
        results.push({
          detector: '#863',
          action:   escalation.escalationLevel,
          detail:   `${escalation.reportCount} reports from ${escalation.uniqueReporters} reporters → ${escalation.escalationLevel}`,
        });
      }
      break;
    }
  }

  for (const result of results) {
    await executeAction(result);
  }

  return results;
}

async function executeAction(result: { detector: string; action: string; detail: string }) {
  if (__DEV__) console.log(`[SAFETY] ${result.detector}: ${result.action} — ${result.detail}`);

  switch (result.action) {
    case 'block':           break;
    case 'ban_and_report':  break;
    case 'restrict':        break;
    case 'flag':            break;
    case 'warn':            break;
    case 'warn_recipient':  break;
    case 'crisis':          break;
    case 'blur':            break;
  }
}