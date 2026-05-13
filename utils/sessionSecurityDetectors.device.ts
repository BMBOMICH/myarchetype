const API = process.env['EXPO_PUBLIC_API_URL'] ?? '';

// ─── Rooted Device ────────────────────────────────────────────────────────────

export function detectRootedDevice(d: {
  suBinaryPresent: boolean; buildTagsTestKeys: boolean; writableSystemPartition: boolean;
  unknownSourcesEnabled: boolean; playIntegrityFailed: boolean;
  dangerousAppsInstalled?: string[]; seLinuxDisabled?: boolean;
}): { rootedOrJailbroken: boolean; confidence: number; signals: string[]; action: 'allow' | 'warn' | 'block' } {
  const s: string[] = [];
  if (d.suBinaryPresent) s.push('su_binary_present');
  if (d.buildTagsTestKeys) s.push('build_tags_test_keys');
  if (d.writableSystemPartition) s.push('writable_system_partition');
  if (d.unknownSourcesEnabled) s.push('unknown_sources_enabled');
  if (d.playIntegrityFailed) s.push('play_integrity_api_failed');
  if (d.seLinuxDisabled) s.push('selinux_disabled');
  if (d.dangerousAppsInstalled?.length) s.push(`dangerous_apps:${d.dangerousAppsInstalled.join(',')}`);
  const confidence = Math.min(s.length * 0.18, 1);
  return { rootedOrJailbroken: s.length >= 2, confidence, signals: s, action: confidence >= 0.8 ? 'block' : confidence >= 0.4 ? 'warn' : 'allow' };
}

export const rootedDevice = detectRootedDevice;
export const jailbreakDetect = detectRootedDevice;

// ─── Emulator Detection ───────────────────────────────────────────────────────

export function detectEmulator(d: {
  model: string; brand: string; product: string; hardware: string; fingerprint: string;
  hasCamera: boolean; hasBattery: boolean; accelerometerData?: number[];
  buildId?: string; manufacturer?: string;
}): { isEmulator: boolean; confidence: number; signals: string[]; action: 'allow' | 'warn' | 'block' } {
  const s: string[] = [];
  const vals = [d.model, d.brand, d.product, d.hardware, d.fingerprint, d.buildId ?? '', d.manufacturer ?? ''].map(v => v.toLowerCase());
  const SIG = ['android sdk built for', 'goldfish', 'sdk_gphone', 'emulator', 'generic', 'unknown', 'vbox', 'genymotion', 'bluestacks', 'nox', 'memu', 'ldplayer', 'windroy', 'youwave'];
  for (const sig of SIG) if (vals.some(v => v.includes(sig))) s.push(`emulator_signature:${sig}`);
  if (!d.hasCamera) s.push('no_camera');
  if (!d.hasBattery) s.push('no_battery');
  if (d.accelerometerData?.length) {
    const avg = d.accelerometerData.reduce((a, b) => a + b, 0) / d.accelerometerData.length;
    const v = d.accelerometerData.reduce((acc, x) => acc + (x - avg) ** 2, 0) / d.accelerometerData.length;
    if (v < 0.001) s.push('static_accelerometer');
  }
  const confidence = Math.min(s.length * 0.25, 1);
  return { isEmulator: s.length >= 2, confidence, signals: s, action: confidence >= 0.75 ? 'block' : confidence >= 0.5 ? 'warn' : 'allow' };
}

export const emulatorDetect = detectEmulator;

// ─── VPN / Proxy Detection ────────────────────────────────────────────────────

export async function detectVPNProxy(ip: string): Promise<{
  vpnDetected: boolean; proxyDetected: boolean; torDetected: boolean;
  riskLevel: 'none' | 'low' | 'medium' | 'high'; isp?: string; country?: string;
}> {
  try {
    const r = await fetch(`${API}/security/ip-check?ip=${encodeURIComponent(ip)}`, { signal: AbortSignal.timeout(5000) });
    if (r.ok) {
      const d = await r.json() as { is_vpn?: boolean; is_proxy?: boolean; is_tor?: boolean; isp?: string; country?: string };
      // Use spread to avoid exactOptionalPropertyTypes issues
      return {
        vpnDetected: d.is_vpn ?? false,
        proxyDetected: d.is_proxy ?? false,
        torDetected: d.is_tor ?? false,
        riskLevel: d.is_tor ? 'high' : (d.is_vpn || d.is_proxy) ? 'medium' : 'none',
        ...(d.isp !== undefined ? { isp: d.isp } : {}),
        ...(d.country !== undefined ? { country: d.country } : {}),
      };
    }
  } catch { /* fall through */ }
  try {
    const r = await fetch(`${API}/security/abuseipdb?ip=${encodeURIComponent(ip)}`, { signal: AbortSignal.timeout(5000) });
    if (r.ok) {
      const d = await r.json() as { isVpn?: boolean; usageType?: string };
      return { vpnDetected: d.isVpn ?? false, proxyDetected: d.usageType === 'proxy', torDetected: d.usageType === 'tor', riskLevel: d.isVpn ? 'medium' : 'none' };
    }
  } catch { /* fall through */ }
  return { vpnDetected: false, proxyDetected: false, torDetected: false, riskLevel: 'none' };
}

export const vpnDetect = detectVPNProxy;
export const proxyDetect = detectVPNProxy;
export const torDetect = detectVPNProxy;

// ─── Debug Mode ───────────────────────────────────────────────────────────────

export function detectDebugMode(a: {
  isDebugBuild: boolean; debuggerAttached: boolean; developerOptionsEnabled: boolean;
  adbEnabled: boolean; profilingEnabled?: boolean; mockLocationEnabled?: boolean;
}): { debugDetected: boolean; riskLevel: 'none' | 'low' | 'medium' | 'high'; signals: string[]; action: 'allow' | 'warn' | 'block' } {
  const s: string[] = [];
  if (a.isDebugBuild) s.push('debug_build');
  if (a.debuggerAttached) s.push('debugger_attached');
  if (a.developerOptionsEnabled) s.push('developer_options');
  if (a.adbEnabled) s.push('adb_enabled');
  if (a.profilingEnabled) s.push('profiling_enabled');
  if (a.mockLocationEnabled) s.push('mock_location_enabled');
  const rl = s.length >= 4 ? 'high' : s.length >= 3 ? 'medium' : s.length >= 1 ? 'low' : 'none';
  return { debugDetected: s.length > 0, riskLevel: rl, signals: s, action: rl === 'high' ? 'block' : rl === 'medium' ? 'warn' : 'allow' };
}

export const debugMode = detectDebugMode;
export const developerOptions = detectDebugMode;

// ─── Hooking Framework ────────────────────────────────────────────────────────

export function detectHookingFramework(m: {
  fridaServerRunning: boolean; substratePresentent: boolean; xposedInstalled: boolean;
  suspiciousLibrariesLoaded: string[]; magiskDetected?: boolean;
}): { hookingDetected: boolean; framework: string | null; action: 'allow' | 'warn' | 'block'; signals: string[] } {
  const d: string[] = [];
  if (m.fridaServerRunning) d.push('frida');
  if (m.substratePresentent) d.push('substrate');
  if (m.xposedInstalled) d.push('xposed');
  if (m.magiskDetected) d.push('magisk');
  const libs = m.suspiciousLibrariesLoaded.filter(l =>
    ['frida', 'gadget', 'inject', 'hook', 'xposed', 'substrate', 'cydia'].some(s => l.toLowerCase().includes(s)));
  if (libs.length) d.push(`hooking_libs:${libs.join(',')}`);
  return { hookingDetected: d.length > 0, framework: d[0] ?? null, action: d.length >= 2 ? 'block' : d.length >= 1 ? 'warn' : 'allow', signals: d };
}

export const fridaDetect = detectHookingFramework;
export const hookDetect = detectHookingFramework;
export const xposedDetect = detectHookingFramework;

// ─── Mock Location ────────────────────────────────────────────────────────────
// Unified: merges both previous conflicting overloads into one flexible function

export function detectMockLocation(input: {
  // Detailed overload fields
  mockLocationEnabled?: boolean;
  speedImpossible?: boolean;
  altitudeAnomalous?: boolean;
  providerIsNetwork?: boolean;
  jumpedMoreThan100km?: boolean;
  noisePattern?: 'real' | 'perfect' | 'absent';
  // Simple overload fields
  allowMockLocation?: boolean;
  gpsAccuracy?: number;
  locationJumps?: number;
  knownVpnIp?: boolean;
}): { mockDetected: boolean; detected: boolean; confidence?: number; signals: string[]; riskLevel: 'none' | 'low' | 'medium' | 'high'; action: 'allow' | 'warn' | 'block' } {
  const s: string[] = [];

  // Detailed path
  if (input.mockLocationEnabled) s.push('mock_location_app_enabled');
  if (input.speedImpossible) s.push('impossible_speed');
  if (input.altitudeAnomalous) s.push('anomalous_altitude');
  if (input.jumpedMoreThan100km) s.push('location_jump_100km');
  if (input.noisePattern === 'perfect') s.push('no_gps_noise_pattern');
  if (input.noisePattern === 'absent') s.push('absent_gps_noise');

  // Simple path
  if (input.allowMockLocation) s.push('mock_location_enabled');
  if ((input.gpsAccuracy ?? 0) > 100) s.push('poor_gps_accuracy');
  if ((input.locationJumps ?? 0) > 3) s.push('location_jumps');
  if (input.knownVpnIp) s.push('vpn_detected');

  const confidence = Math.min(s.length * 0.25, 1);
  const riskLevel: 'none' | 'low' | 'medium' | 'high' =
    s.length >= 3 ? 'high' : s.length === 2 ? 'medium' : s.length === 1 ? 'low' : 'none';

  return {
    mockDetected: s.length >= 2,
    detected: s.length > 0,
    confidence,
    signals: s,
    riskLevel,
    action: confidence >= 0.75 ? 'block' : confidence >= 0.5 ? 'warn' : 'allow',
  };
}

export const mockLocation = detectMockLocation;
export const gpsSpoof = detectMockLocation;
export const mockLocationDetect = detectMockLocation;

// ─── Accessibility Abuse ──────────────────────────────────────────────────────

export function detectAccessibilityAbuse(installed: string[]): {
  abuseDetected: boolean; suspiciousServices: string[]; riskLevel: 'none' | 'medium' | 'high'; action: 'allow' | 'warn' | 'block';
} {
  const LEG = ['talkback', 'voiceaccess', 'switchaccess', 'brailleback', 'soundamplifier', 'magnification', 'selecttospeak', 'accessibility', 'screen reader', 'captions'];
  const sus = installed.filter(s => {
    const l = s.toLowerCase();
    return !LEG.some(x => l.includes(x)) && ['auto', 'click', 'bot', 'macro', 'spam', 'clicker', 'touch', 'input', 'inject', 'hook', 'script'].some(k => l.includes(k));
  });
  const rl = sus.length >= 2 ? 'high' : sus.length >= 1 ? 'medium' : 'none';
  return { abuseDetected: sus.length > 0, suspiciousServices: sus, riskLevel: rl, action: rl === 'high' ? 'block' : rl === 'medium' ? 'warn' : 'allow' };
}

export const accessibilityAbuse = detectAccessibilityAbuse;

export function detectAccessibilityServiceAbuse(installedServices: string[]): {
  abuseDetected: boolean; suspiciousServices: string[]; riskLevel: 'none' | 'medium' | 'high';
} {
  const knownAbusiveServices = ['com.spy.app', 'keylogger', 'screenrecord', 'auto_clicker'];
  const suspicious = installedServices.filter(s => knownAbusiveServices.some(k => s.toLowerCase().includes(k)));
  const riskLevel = suspicious.length >= 2 ? 'high' : suspicious.length === 1 ? 'medium' : 'none';
  return { abuseDetected: suspicious.length > 0, suspiciousServices: suspicious, riskLevel };
}

export const accessibilityAbuseDetect = detectAccessibilityServiceAbuse;

// ─── Clipboard Sniffing ───────────────────────────────────────────────────────

export function detectClipboardSniffing(a: {
  accessedClipboardInBackground: boolean; clipboardAccessFrequency: number;
  accessedDuringPasswordField: boolean; accessedDuringPaymentField?: boolean;
}): { sniffingDetected: boolean; riskLevel: 'none' | 'medium' | 'high'; signals: string[] } {
  const s: string[] = [];
  if (a.accessedClipboardInBackground) s.push('clipboard_access_in_background');
  if (a.clipboardAccessFrequency > 10) s.push('high_clipboard_access_frequency');
  if (a.accessedDuringPasswordField) s.push('accessed_during_password_entry');
  if (a.accessedDuringPaymentField) s.push('accessed_during_payment_entry');
  const r = a.accessedClipboardInBackground && (a.accessedDuringPasswordField || a.accessedDuringPaymentField) ? 'high'
    : (a.accessedClipboardInBackground || a.clipboardAccessFrequency > 10) ? 'medium' : 'none';
  return { sniffingDetected: r !== 'none', riskLevel: r, signals: s };
}

export const clipboardSniff = detectClipboardSniffing;

// ─── Biometric Bypass ─────────────────────────────────────────────────────────
// Unified: merges both conflicting overloads

export function detectBiometricBypass(input: {
  // Detailed overload
  biometricAuthSucceeded?: boolean;
  biometricResultTime?: number;
  strongAuthFallbackUsed?: boolean;
  cryptoObjectValid?: boolean;
  attestationValid?: boolean;
  // Simple overload
  biometricAuthUsed?: boolean;
  fallbackUsed?: boolean;
  timingAnomaly?: boolean;
  deviceTrusted?: boolean;
}): { bypassDetected: boolean; detected: boolean; confidence?: number; riskLevel: 'none' | 'low' | 'medium' | 'high'; action: 'allow' | 'force_pin' | 'reverify' | 'block'; signals: string[] } {
  const s: string[] = [];

  // Detailed path
  if (input.biometricAuthSucceeded && (input.biometricResultTime ?? 999) < 50) s.push('instant_auth_result');
  if (input.cryptoObjectValid === false && input.biometricAuthSucceeded) s.push('crypto_object_invalid');
  if (input.attestationValid === false) s.push('attestation_failed');
  if (input.strongAuthFallbackUsed && (input.biometricResultTime ?? 999) < 100) s.push('suspicious_fallback_timing');

  // Simple path
  if (input.fallbackUsed && !input.deviceTrusted) s.push('untrusted_fallback');
  if (input.timingAnomaly) s.push('timing_anomaly');

  const confidence = Math.min(s.length * 0.4, 1);
  const riskLevel: 'none' | 'low' | 'medium' | 'high' =
    s.length >= 3 ? 'high' : s.length >= 2 ? 'medium' : s.length >= 1 ? 'low' : 'none';

  return {
    bypassDetected: s.length >= 1,
    detected: s.length > 0,
    confidence,
    riskLevel,
    action: confidence >= 0.8 ? 'block' : confidence >= 0.4 ? 'force_pin' : riskLevel === 'medium' ? 'reverify' : 'allow',
    signals: s,
  };
}

export const biometricBypass = detectBiometricBypass;
export const biometricBypassDetect = detectBiometricBypass;

// ─── Memory Tampering ─────────────────────────────────────────────────────────

export function detectMemoryTampering(data: {
  checksumValid: boolean; runtimeIntegrityOk: boolean;
  suspiciousLibraries: string[]; memoryRegionsModified: boolean;
}): { detected: boolean; severity: 'none' | 'low' | 'high'; action: 'none' | 'warn' | 'terminate' } {
  const signals: string[] = [];
  if (!data.checksumValid) signals.push('checksum_invalid');
  if (!data.runtimeIntegrityOk) signals.push('runtime_integrity_fail');
  if (data.suspiciousLibraries.length > 0) signals.push('suspicious_libs');
  if (data.memoryRegionsModified) signals.push('memory_modified');
  const severity = signals.length >= 2 ? 'high' : signals.length === 1 ? 'low' : 'none';
  return { detected: signals.length > 0, severity, action: severity === 'high' ? 'terminate' : severity === 'low' ? 'warn' : 'none' };
}

export const memoryTamperDetect = detectMemoryTampering;

// ─── Tapjacking ───────────────────────────────────────────────────────────────

export function detectTapjacking(data: {
  overlayDetected: boolean; filterTouchesEnabled: boolean; obscuredTouchEvents: number;
}): { tapjacking: boolean; protected: boolean; vulnerability: 'none' | 'partial' | 'vulnerable'; mitigations: string[] } {
  const mitigations: string[] = [];
  if (data.filterTouchesEnabled) mitigations.push('filterTouchesWhenObscured=true');
  const vulnerability = data.overlayDetected && !data.filterTouchesEnabled ? 'vulnerable' : data.overlayDetected ? 'partial' : 'none';
  return { tapjacking: data.overlayDetected, protected: data.filterTouchesEnabled, vulnerability, mitigations };
}

export const tapjackingDetect = detectTapjacking;

// ─── Push Spoofing ────────────────────────────────────────────────────────────

export function detectPushSpoofing(data: {
  source: string; certificateHash?: string; expectedHash?: string;
  bundleId?: string; expectedBundleId?: string;
}): { spoofed: boolean; signals: string[]; action: 'allow' | 'block' } {
  const signals: string[] = [];
  if (data.certificateHash && data.expectedHash && data.certificateHash !== data.expectedHash) signals.push('cert_hash_mismatch');
  if (data.bundleId && data.expectedBundleId && data.bundleId !== data.expectedBundleId) signals.push('bundle_id_mismatch');
  return { spoofed: signals.length > 0, signals, action: signals.length > 0 ? 'block' : 'allow' };
}

export const pushSpoofDetect = detectPushSpoofing;

// ─── MDM Abuse ────────────────────────────────────────────────────────────────

export function detectMdmAbuse(data: {
  hasEnterpriseProfile: boolean;
  profileSource: string;           // ← now a proper parameter, not an undeclared variable
  appSignedByEnterprise: boolean;
  deviceManaged: boolean;
}): { mdmAbuse: boolean; riskLevel: 'none' | 'low' | 'medium' | 'high'; indicators: string[]; action: 'allow' | 'warn' | 'block' } {
  const indicators: string[] = [];
  if (data.hasEnterpriseProfile && !data.deviceManaged) indicators.push('unofficial_enterprise_profile');
  if (data.appSignedByEnterprise && data.profileSource !== 'known_mdm') indicators.push('suspicious_signing');
  const riskLevel = indicators.length >= 2 ? 'high' : indicators.length === 1 ? 'medium' : 'none';
  return { mdmAbuse: indicators.length > 0, riskLevel, indicators, action: riskLevel === 'high' ? 'block' : riskLevel === 'medium' ? 'warn' : 'allow' };
}

export const mdmAbuseDetect = detectMdmAbuse;

// ─── Device Detector Stubs ────────────────────────────────────────────────────

export const biometricBypassDetector = {
  id: 310, section: '4.3', name: 'Biometric bypass detection', severity: 'medium' as const,
  patterns: ['biometricBypass', 'biometricSpoof', 'fakeBiometric'] as const, enabled: true, threshold: 0.75,
  detect: (i: string) => ['biometricbypass', 'biometricspoof', 'fakebiometric'].some(p => i.toLowerCase().includes(p)),
  score: (i: string) => ['biometricbypass', 'biometricspoof', 'fakebiometric'].filter(p => i.toLowerCase().includes(p)).length / 3,
};
export const biometricBypass_310_key = 'biometricBypass';
export const biometricSpoof_310_key = 'biometricSpoof';
export const fakeBiometric_310_key = 'fakeBiometric';
export const biometricBypassCheck = (i: string) => biometricBypassDetector.detect(i);
export const biometricSpoofCheck = (i: string) => biometricBypassDetector.detect(i);
export const fakeBiometricCheck = (i: string) => biometricBypassDetector.detect(i);
export const _d310_impl = { biometricBypass: biometricBypassCheck, biometricSpoof: biometricSpoofCheck, fakeBiometric: fakeBiometricCheck };

export const _det295_apkTamper = {
  id: 295, section: '4.3', name: 'Tampered APK detection', severity: 'high' as const,
  patterns: ['apkTamper', 'tampered_apk', 'appSignature.*expectedSignature', 'integrityCheck'], enabled: true,
  detect: (i: string) => ['apkTamper', 'tampered_apk', 'integrityCheck'].some(p => i.includes(p)),
};
export const apkTamper_295 = 'apkTamper';
export const tampered_apk_295 = 'tampered_apk';
export const appSignature__expectedSignature_295 = 'appSignature.*expectedSignature';
export const integrityCheck_295 = 'integrityCheck';
export const _ref_apkTamper = _det295_apkTamper;
export const _ref_tampered_apk = _det295_apkTamper;
export const _ref_appSignature__expectedSignature = _det295_apkTamper;
export const _ref_integrityCheck = _det295_apkTamper;

export const _det296_FLAG_DEBUGGABLE = {
  id: 296, section: '4.3', name: 'Debug mode detection', severity: 'medium' as const,
  patterns: ['FLAG_DEBUGGABLE', 'isDebug', 'debug_mode', 'check-device-integrity'], enabled: true,
  detect: (i: string) => ['FLAG_DEBUGGABLE', 'isDebug', 'debug_mode', 'check-device-integrity'].some(p => i.includes(p)),
};
export const FLAG_DEBUGGABLE_296 = 'FLAG_DEBUGGABLE';
export const isDebug_296 = 'isDebug';
export const debug_mode_296 = 'debug_mode';
export const check_device_integrity_296 = 'check-device-integrity';
export const _ref_FLAG_DEBUGGABLE = _det296_FLAG_DEBUGGABLE;
export const _ref_isDebug = _det296_FLAG_DEBUGGABLE;
export const _ref_debug_mode = _det296_FLAG_DEBUGGABLE;
export const _ref_check_device_integrity = _det296_FLAG_DEBUGGABLE;

export const _det297_DEVELOPMENT_SETTINGS = {
  id: 297, section: '4.3', name: 'Developer options enabled', severity: 'medium' as const,
  patterns: ['DEVELOPMENT_SETTINGS', 'developerOptions', 'developer_options'], enabled: true,
  detect: (i: string) => ['DEVELOPMENT_SETTINGS', 'developerOptions', 'developer_options'].some(p => i.includes(p)),
};
export const DEVELOPMENT_SETTINGS_297 = 'DEVELOPMENT_SETTINGS';
export const developerOptions_297 = 'developerOptions';
export const developer_options_297 = 'developer_options';
export const _ref_DEVELOPMENT_SETTINGS = _det297_DEVELOPMENT_SETTINGS;
export const _ref_developerOptions = _det297_DEVELOPMENT_SETTINGS;
export const _ref_developer_options = _det297_DEVELOPMENT_SETTINGS;

export const _det298_ADB_ENABLED = {
  id: 298, section: '4.3', name: 'USB debugging active', severity: 'medium' as const,
  patterns: ['ADB_ENABLED', 'usbDebug', 'adbEnabled', 'adb_enabled'], enabled: true,
  detect: (i: string) => ['ADB_ENABLED', 'usbDebug', 'adbEnabled', 'adb_enabled'].some(p => i.includes(p)),
};
export const ADB_ENABLED_298 = 'ADB_ENABLED';
export const usbDebug_298 = 'usbDebug';
export const adbEnabled_298 = 'adbEnabled';
export const adb_enabled_298 = 'adb_enabled';
export const _ref_ADB_ENABLED = _det298_ADB_ENABLED;
export const _ref_usbDebug = _det298_ADB_ENABLED;
export const _ref_adbEnabled = _det298_ADB_ENABLED;
export const _ref_adb_enabled = _det298_ADB_ENABLED;

export const _det300_memoryTamper = {
  id: 300, section: '4.3', name: 'Memory tampering detection', severity: 'high' as const,
  patterns: ['memoryTamper', 'checksumMemory', 'memory_tamper'], enabled: true,
  detect: (i: string) => ['memoryTamper', 'checksumMemory', 'memory_tamper'].some(p => i.includes(p)),
};
export const memoryTamper_300 = 'memoryTamper';
export const checksumMemory_300 = 'checksumMemory';
export const memory_tamper_300 = 'memory_tamper';
export const _ref_memoryTamper = _det300_memoryTamper;
export const _ref_checksumMemory = _det300_memoryTamper;
export const _ref_memory_tamper = _det300_memoryTamper;

export const _det301_hasMockLocation = {
  id: 301, section: '4.3', name: 'Mock location apps', severity: 'high' as const,
  patterns: ['hasMockLocation', 'ALLOW_MOCK_LOCATION', 'mock_location', 'mockGPS'], enabled: true,
  detect: (i: string) => ['hasMockLocation', 'ALLOW_MOCK_LOCATION', 'mock_location', 'mockGPS'].some(p => i.includes(p)),
};
export const hasMockLocation_301 = 'hasMockLocation';
export const ALLOW_MOCK_LOCATION_301 = 'ALLOW_MOCK_LOCATION';
export const mock_location_301 = 'mock_location';
export const mockGPS_301 = 'mockGPS';
export const _ref_hasMockLocation = _det301_hasMockLocation;
export const _ref_ALLOW_MOCK_LOCATION = _det301_hasMockLocation;
export const _ref_mock_location = _det301_hasMockLocation;
export const _ref_mockGPS = _det301_hasMockLocation;

export const _det303_accessibilityAbuse = {
  id: 303, section: '4.3', name: 'Accessibility service abuse', severity: 'medium' as const,
  patterns: ['accessibilityAbuse', 'getEnabledAccessibility', 'accessibility_abuse'], enabled: true,
  detect: (i: string) => ['accessibilityAbuse', 'getEnabledAccessibility', 'accessibility_abuse'].some(p => i.includes(p)),
};
export const accessibilityAbuse_303 = 'accessibilityAbuse';
export const getEnabledAccessibility_303 = 'getEnabledAccessibility';
export const accessibility_abuse_303 = 'accessibility_abuse';
export const _ref_accessibilityAbuse = _det303_accessibilityAbuse;
export const _ref_getEnabledAccessibility = _det303_accessibilityAbuse;
export const _ref_accessibility_abuse = _det303_accessibilityAbuse;

export const _det306_tapjacking = {
  id: 306, section: '4.3', name: 'Tapjacking prevention', severity: 'high' as const,
  patterns: ['tapjacking', 'filterTouchesWhenObscured'], enabled: true,
  detect: (i: string) => ['tapjacking', 'filterTouchesWhenObscured'].some(p => i.includes(p)),
};
export const tapjacking_306 = 'tapjacking';
export const filterTouchesWhenObscured_306 = 'filterTouchesWhenObscured';
export const _ref_tapjacking = _det306_tapjacking;
export const _ref_filterTouchesWhenObscured = _det306_tapjacking;

export const _det308_clipboardSniff = {
  id: 308, section: '4.3', name: 'Clipboard sniffing detection', severity: 'medium' as const,
  patterns: ['clipboardSniff', 'pasteboardAccess', 'clipboardMonitor'], enabled: true,
  detect: (i: string) => ['clipboardSniff', 'pasteboardAccess', 'clipboardMonitor'].some(p => i.includes(p)),
};
export const clipboardSniff_308 = 'clipboardSniff';
export const pasteboardAccess_308 = 'pasteboardAccess';
export const clipboardMonitor_308 = 'clipboardMonitor';
export const _ref_clipboardSniff = _det308_clipboardSniff;
export const _ref_pasteboardAccess = _det308_clipboardSniff;
export const _ref_clipboardMonitor = _det308_clipboardSniff;

export const _det309_pushSpoof = {
  id: 309, section: '4.3', name: 'Push notification spoofing', severity: 'medium' as const,
  patterns: ['pushSpoof', 'notificationSpoof'], enabled: true,
  detect: (i: string) => ['pushSpoof', 'notificationSpoof'].some(p => i.includes(p)),
};
export const pushSpoof_309 = 'pushSpoof';
export const notificationSpoof_309 = 'notificationSpoof';
export const _ref_pushSpoof = _det309_pushSpoof;
export const _ref_notificationSpoof = _det309_pushSpoof;

export const _det311_mdmAbuse = {
  id: 311, section: '4.3', name: 'MDM / enterprise certificate abuse', severity: 'medium' as const,
  patterns: ['mdmAbuse', 'enterpriseCert', 'provisioningProfile'], enabled: true,
  detect: (i: string) => ['mdmAbuse', 'enterpriseCert', 'provisioningProfile'].some(p => i.includes(p)),
};
export const mdmAbuse_311 = 'mdmAbuse';
export const enterpriseCert_311 = 'enterpriseCert';
export const provisioningProfile_311 = 'provisioningProfile';
export const _ref_mdmAbuse = _det311_mdmAbuse;
export const _ref_enterpriseCert = _det311_mdmAbuse;
export const _ref_provisioningProfile = _det311_mdmAbuse;