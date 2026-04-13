import {
  checkFirstMessage,
  checkTextSafety,
  detectEmojiSpam,
  detectFinancialRequest,
  detectOffPlatformRedirect,
  detectRTLInjection,
  hasZeroWidthChars, isDisposableEmail,
  preprocessText, scoreMessageRisk,
} from '../utils/moderation';

describe('checkTextSafety', () => {
  it('passes clean text', () => {
    expect(checkTextSafety('Hello, how are you?').safe).toBe(true);
  });
  it('blocks violence threats', () => {
    const r = checkTextSafety("I'll kill you");
    expect(r.safe).toBe(false);
    expect(r.flaggedCategories).toContain('violence_threat');
  });
  it('blocks sexual solicitation', () => {
    const r = checkTextSafety('send me nudes');
    expect(r.safe).toBe(false);
    expect(r.flaggedCategories).toContain('sexual_solicitation');
  });
  it('blocks self-harm encouragement', () => {
    const r = checkTextSafety('kys');
    expect(r.safe).toBe(false);
    expect(r.flaggedCategories).toContain('self_harm');
  });
  it('blocks drug dealing', () => {
    const r = checkTextSafety('selling weed hmu');
    expect(r.safe).toBe(false);
    expect(r.flaggedCategories).toContain('drug_dealing');
  });
  it('blocks underage references', () => {
    const r = checkTextSafety("i'm 15 years old");
    expect(r.safe).toBe(false);
    expect(r.flaggedCategories).toContain('underage');
  });
  it('blocks scam language', () => {
    const r = checkTextSafety('send me bitcoin');
    expect(r.safe).toBe(false);
    expect(r.flaggedCategories).toContain('scam');
  });
  it('blocks grooming language', () => {
    const r = checkTextSafety("you're so mature for your age");
    expect(r.safe).toBe(false);
    expect(r.flaggedCategories).toContain('grooming');
  });
  it('blocks sextortion', () => {
    const r = checkTextSafety('I have your photos, pay me');
    expect(r.safe).toBe(false);
    expect(r.flaggedCategories).toContain('sextortion');
  });
  it('handles empty text', () => {
    expect(checkTextSafety('').safe).toBe(true);
    expect(checkTextSafety('   ').safe).toBe(true);
  });
  it('skips contact info in bug reports', () => {
    expect(checkTextSafety('my email is test@test.com', 'bug_report').safe).toBe(true);
  });
  it('blocks contact info in chat', () => {
    const r = checkTextSafety('my email is test@test.com', 'chat');
    expect(r.safe).toBe(false);
  });
  it.skip('blocks profanity in names', () => {
    expect(checkTextSafety('fuck', 'name').safe).toBe(false);
  });
});

describe('checkFirstMessage', () => {
  it('passes normal first message', () => {
    expect(checkFirstMessage('Hey! Love your profile 😊').safe).toBe(true);
  });
  it('blocks sexual first message', () => {
    expect(checkFirstMessage('dtf?').safe).toBe(false);
  });
  it('blocks photo requests in first message', () => {
    expect(checkFirstMessage('send me a pic').safe).toBe(false);
  });
});

describe('detectRTLInjection', () => {
  it('detects RTL override character', () => {
    expect(detectRTLInjection('\u202Ehello')).toBe(true);
  });
  it('passes clean text', () => {
    expect(detectRTLInjection('hello world')).toBe(false);
  });
});

describe('detectEmojiSpam', () => {
  it('flags emoji spam', () => {
    const r = detectEmojiSpam('😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀');
    expect(r.isSpam).toBe(true);
  });
  it('passes normal emoji use', () => {
    expect(detectEmojiSpam('Hello 😊').isSpam).toBe(false);
  });
  it('handles empty string', () => {
    expect(detectEmojiSpam('').isSpam).toBe(false);
  });
});

describe('hasZeroWidthChars', () => {
  it('detects zero-width chars', () => {
    expect(hasZeroWidthChars('hello\u200Bworld')).toBe(true);
  });
  it('passes clean text', () => {
    expect(hasZeroWidthChars('hello world')).toBe(false);
  });
});

describe('isDisposableEmail', () => {
  it('flags disposable email', () => {
    expect(isDisposableEmail('test@mailinator.com')).toBe(true);
    expect(isDisposableEmail('x@guerrillamail.com')).toBe(true);
  });
  it('passes real email', () => {
    expect(isDisposableEmail('user@gmail.com')).toBe(false);
    expect(isDisposableEmail('user@outlook.com')).toBe(false);
  });
});

describe('preprocessText', () => {
  it('normalizes leet speak', () => {
    const result = preprocessText('h3ll0');
    expect(result).toContain('h');
    expect(result).toContain('o');
  });
  it('strips zero-width chars', () => {
    expect(preprocessText('hel\u200Blo')).toBe('hello');
  });
});

describe('scoreMessageRisk', () => {
  it('scores clean message as 0', () => {
    expect(scoreMessageRisk('Hey, how was your day?').score).toBe(0);
  });
  it('scores financial request higher', () => {
    expect(scoreMessageRisk('please send me money').score).toBeGreaterThan(0);
  });
  it('scores off-platform redirect', () => {
    expect(scoreMessageRisk('lets talk on telegram').score).toBeGreaterThan(0);
  });
  it('caps at 100', () => {
    const r = scoreMessageRisk('send money bitcoin telegram cashapp venmo wire transfer');
    expect(r.score).toBeLessThanOrEqual(100);
  });
});

describe('detectFinancialRequest', () => {
  it('detects venmo request', () => {
    expect(detectFinancialRequest('can you venmo me')).toBe(true);
  });
  it('detects crypto request', () => {
    expect(detectFinancialRequest('send bitcoin please')).toBe(true);
  });
  it('passes clean text', () => {
    expect(detectFinancialRequest('lets grab coffee')).toBe(false);
  });
});

describe('detectOffPlatformRedirect', () => {
  it('detects telegram redirect', () => {
    expect(detectOffPlatformRedirect('dm me on telegram')).toBe(true);
  });
  it('detects whatsapp redirect', () => {
    expect(detectOffPlatformRedirect('text me on whatsapp')).toBe(true);
  });
  it('passes clean text', () => {
    expect(detectOffPlatformRedirect('how are you doing?')).toBe(false);
  });
});