// Multi-language support for MyArchetype
// Priority: Azerbaijani, Turkish, English

export type Language = 'az' | 'tr' | 'en' | 'ru' | 'es' | 'fr' | 'de' | 'ar' | 'pt' | 'zh';

export interface Translations {
  // Common
  appName: string;
  loading: string;
  save: string;
  cancel: string;
  confirm: string;
  delete: string;
  edit: string;
  back: string;
  next: string;
  done: string;
  error: string;
  success: string;
  yes: string;
  no: string;
  ok: string;
  
  // Auth
  login: string;
  signup: string;
  logout: string;
  email: string;
  password: string;
  confirmPassword: string;
  forgotPassword: string;
  createAccount: string;
  alreadyHaveAccount: string;
  noAccount: string;
  passwordRequirements: string;
  passwordTooWeak: string;
  passwordsDoNotMatch: string;
  emailAlreadyInUse: string;
  invalidEmail: string;
  verifyEmail: string;
  verificationSent: string;
  
  // Onboarding
  onboardingTitle1: string;
  onboardingDesc1: string;
  onboardingTitle2: string;
  onboardingDesc2: string;
  onboardingTitle3: string;
  onboardingDesc3: string;
  getStarted: string;
  skip: string;
  
  // Home
  welcome: string;
  welcomeBack: string;
  findMatches: string;
  myMatches: string;
  editProfile: string;
  personalityQuiz: string;
  blockedUsers: string;
  settings: string;
  adminPanel: string;
  
  // Profile
  createProfile: string;
  photos: string;
  cameraOnly: string;
  firstName: string;
  age: string;
  gender: string;
  male: string;
  female: string;
  height: string;
  bodyType: string;
  lookingFor: string;
  religiousViews: string;
  lifestyle: string;
  relationshipGoal: string;
  aboutMe: string;
  location: string;
  updateLocation: string;
  
  // Matches
  noMatches: string;
  noMoreMatches: string;
  itsAMatch: string;
  youAndLikedEachOther: string;
  compatibility: string;
  like: string;
  pass: string;
  undo: string;
  
  // Chat
  typeMessage: string;
  sendPhoto: string;
  recording: string;
  voiceMessage: string;
  unmatch: string;
  report: string;
  block: string;
  
  // Settings
  language: string;
  notifications: string;
  privacy: string;
  support: string;
  reportBug: string;
  donate: string;
  termsOfService: string;
  privacyPolicy: string;
  deleteAccount: string;
  referralProgram: string;
  inviteFriends: string;
  yourReferralCode: string;
  
  // Referral
  referralTitle: string;
  referralDescription: string;
  referralsCount: string;
  leaderboard: string;
  communityChampion: string;
  copyCode: string;
  shareCode: string;
  
  // Donation
  supportUs: string;
  donationMessage: string;
  buyMeACoffee: string;
  oneTimeDonation: string;
  
  // Profile Views
  profileViews: string;
  peopleViewedYou: string;
  viewedYourProfile: string;
  
  // Verification
  verified: string;
  unverified: string;
  verifyIdentity: string;
  verifyHeight: string;
  
  // Errors
  somethingWentWrong: string;
  tryAgain: string;
  noInternet: string;
}

const translations: Record<Language, Translations> = {
  // 🇦🇿 AZERBAIJANI (Primary)
  az: {
    appName: 'MyArchetype',
    loading: 'Yüklənir...',
    save: 'Saxla',
    cancel: 'Ləğv et',
    confirm: 'Təsdiq et',
    delete: 'Sil',
    edit: 'Redaktə et',
    back: 'Geri',
    next: 'Növbəti',
    done: 'Hazır',
    error: 'Xəta',
    success: 'Uğurlu',
    yes: 'Bəli',
    no: 'Xeyr',
    ok: 'OK',
    
    login: 'Daxil ol',
    signup: 'Qeydiyyat',
    logout: 'Çıxış',
    email: 'E-poçt',
    password: 'Şifrə',
    confirmPassword: 'Şifrəni təsdiqlə',
    forgotPassword: 'Şifrəni unutdun?',
    createAccount: 'Hesab yarat',
    alreadyHaveAccount: 'Artıq hesabınız var? Daxil olun',
    noAccount: 'Hesabınız yoxdur? Qeydiyyatdan keçin',
    passwordRequirements: 'Şifrə: 8+ simvol, 1 böyük hərf, 1 rəqəm, 1 xüsusi simvol',
    passwordTooWeak: 'Şifrə çox zəifdir',
    passwordsDoNotMatch: 'Şifrələr uyğun gəlmir',
    emailAlreadyInUse: 'Bu e-poçt artıq istifadə olunur',
    invalidEmail: 'Yanlış e-poçt ünvanı',
    verifyEmail: 'E-poçtunuzu təsdiqləyin',
    verificationSent: 'Təsdiq e-poçtu göndərildi',
    
    onboardingTitle1: 'MyArchetype-a xoş gəlmisiniz',
    onboardingDesc1: 'Həqiqi əlaqələr üçün yaradılmış tanışlıq tətbiqi',
    onboardingTitle2: 'Necə işləyir',
    onboardingDesc2: 'Şəxsiyyət testi, doğrulama və dərin uyğunluq sistemi',
    onboardingTitle3: '100% Pulsuz, Həmişə',
    onboardingDesc3: 'Heç bir məhdudiyyət yoxdur. Premium yoxdur. Sadəcə həqiqi insanlar.',
    getStarted: 'Başla',
    skip: 'Keç',
    
    welcome: 'Xoş gəlmisiniz',
    welcomeBack: 'Yenidən xoş gəlmisiniz',
    findMatches: '🔍 Uyğunluq tap',
    myMatches: '💕 Uyğunluqlarım',
    editProfile: '✏️ Profili redaktə et',
    personalityQuiz: '🧠 Şəxsiyyət testi',
    blockedUsers: '🚫 Blok edilmiş istifadəçilər',
    settings: '⚙️ Parametrlər',
    adminPanel: '👮 Admin paneli',
    
    createProfile: 'Profil yarat',
    photos: 'Şəkillər',
    cameraOnly: 'Yalnız KAMERA - yükləmə yoxdur',
    firstName: 'Ad',
    age: 'Yaş',
    gender: 'Cins',
    male: 'Kişi',
    female: 'Qadın',
    height: 'Boy (sm)',
    bodyType: 'Bədən quruluşu',
    lookingFor: 'Axtardığım',
    religiousViews: 'Dini baxışlar',
    lifestyle: 'Həyat tərzi',
    relationshipGoal: 'Münasibət məqsədi',
    aboutMe: 'Haqqımda',
    location: 'Məkan',
    updateLocation: '📍 Məkanı yenilə',
    
    noMatches: 'Hələ uyğunluq yoxdur',
    noMoreMatches: 'Daha çox uyğunluq yoxdur',
    itsAMatch: 'Uyğunluq! 💕',
    youAndLikedEachOther: 'Siz və bir-birinizi bəyəndiniz!',
    compatibility: 'Uyğunluq',
    like: '♥ Bəyən',
    pass: '✗ Keç',
    undo: '↩️ Geri al',
    
    typeMessage: 'Mesaj yazın...',
    sendPhoto: 'Şəkil göndər',
    recording: 'Səs yazılır...',
    voiceMessage: 'Səs mesajı',
    unmatch: 'Uyğunluğu sil',
    report: 'Şikayət et',
    block: 'Blokla',
    
    language: 'Dil',
    notifications: 'Bildirişlər',
    privacy: 'Məxfilik',
    support: 'Dəstək',
    reportBug: '🐛 Xəta bildir',
    donate: '☕ Dəstəklə',
    termsOfService: 'İstifadə şərtləri',
    privacyPolicy: 'Məxfilik siyasəti',
    deleteAccount: 'Hesabı sil',
    referralProgram: 'Dostlarını dəvət et',
    inviteFriends: 'Dostlarını dəvət et',
    yourReferralCode: 'Sizin dəvət kodunuz',
    
    referralTitle: 'Dostlarını dəvət et',
    referralDescription: 'Dostlarınızı dəvət edin və Community Champion olun!',
    referralsCount: 'Dəvət etdiyiniz',
    leaderboard: 'Liderlik cədvəli',
    communityChampion: '🌟 Community Champion',
    copyCode: 'Kodu kopyala',
    shareCode: 'Kodu paylaş',
    
    supportUs: 'Bizi dəstəkləyin',
    donationMessage: 'MyArchetype 100% pulsuzdur. Könüllü ianələr bizə kömək edir.',
    buyMeACoffee: '☕ Mənə bir qəhvə al',
    oneTimeDonation: 'Birdəfəlik ianə',
    
    profileViews: 'Profil baxışları',
    peopleViewedYou: 'nəfər profilinizə baxıb',
    viewedYourProfile: 'profilinizə baxdı',
    
    verified: 'Təsdiqlənmiş',
    unverified: 'Təsdiqlənməmiş',
    verifyIdentity: 'Şəxsiyyəti təsdiqlə',
    verifyHeight: 'Boyu təsdiqlə',
    
    somethingWentWrong: 'Nəsə səhv getdi',
    tryAgain: 'Yenidən cəhd edin',
    noInternet: 'İnternet bağlantısı yoxdur',
  },

  // 🇹🇷 TURKISH
  tr: {
    appName: 'MyArchetype',
    loading: 'Yükleniyor...',
    save: 'Kaydet',
    cancel: 'İptal',
    confirm: 'Onayla',
    delete: 'Sil',
    edit: 'Düzenle',
    back: 'Geri',
    next: 'İleri',
    done: 'Tamam',
    error: 'Hata',
    success: 'Başarılı',
    yes: 'Evet',
    no: 'Hayır',
    ok: 'Tamam',
    
    login: 'Giriş yap',
    signup: 'Kayıt ol',
    logout: 'Çıkış yap',
    email: 'E-posta',
    password: 'Şifre',
    confirmPassword: 'Şifreyi onayla',
    forgotPassword: 'Şifremi unuttum',
    createAccount: 'Hesap oluştur',
    alreadyHaveAccount: 'Zaten hesabınız var mı? Giriş yapın',
    noAccount: 'Hesabınız yok mu? Kayıt olun',
    passwordRequirements: 'Şifre: 8+ karakter, 1 büyük harf, 1 rakam, 1 özel karakter',
    passwordTooWeak: 'Şifre çok zayıf',
    passwordsDoNotMatch: 'Şifreler eşleşmiyor',
    emailAlreadyInUse: 'Bu e-posta zaten kullanılıyor',
    invalidEmail: 'Geçersiz e-posta adresi',
    verifyEmail: 'E-postanızı doğrulayın',
    verificationSent: 'Doğrulama e-postası gönderildi',
    
    onboardingTitle1: 'MyArchetype\'a hoş geldiniz',
    onboardingDesc1: 'Gerçek bağlantılar için tasarlanmış arkadaşlık uygulaması',
    onboardingTitle2: 'Nasıl çalışır',
    onboardingDesc2: 'Kişilik testi, doğrulama ve derin uyumluluk sistemi',
    onboardingTitle3: '100% Ücretsiz, Her zaman',
    onboardingDesc3: 'Hiçbir kısıtlama yok. Premium yok. Sadece gerçek insanlar.',
    getStarted: 'Başla',
    skip: 'Atla',
    
    welcome: 'Hoş geldiniz',
    welcomeBack: 'Tekrar hoş geldiniz',
    findMatches: '🔍 Eşleşme bul',
    myMatches: '💕 Eşleşmelerim',
    editProfile: '✏️ Profili düzenle',
    personalityQuiz: '🧠 Kişilik testi',
    blockedUsers: '🚫 Engellenen kullanıcılar',
    settings: '⚙️ Ayarlar',
    adminPanel: '👮 Yönetici paneli',
    
    createProfile: 'Profil oluştur',
    photos: 'Fotoğraflar',
    cameraOnly: 'Sadece KAMERA - yükleme yok',
    firstName: 'Ad',
    age: 'Yaş',
    gender: 'Cinsiyet',
    male: 'Erkek',
    female: 'Kadın',
    height: 'Boy (cm)',
    bodyType: 'Vücut tipi',
    lookingFor: 'Aradığım',
    religiousViews: 'Dini görüşler',
    lifestyle: 'Yaşam tarzı',
    relationshipGoal: 'İlişki hedefi',
    aboutMe: 'Hakkımda',
    location: 'Konum',
    updateLocation: '📍 Konumu güncelle',
    
    noMatches: 'Henüz eşleşme yok',
    noMoreMatches: 'Daha fazla eşleşme yok',
    itsAMatch: 'Eşleşme! 💕',
    youAndLikedEachOther: 'Sen ve birbirinizi beğendiniz!',
    compatibility: 'Uyumluluk',
    like: '♥ Beğen',
    pass: '✗ Geç',
    undo: '↩️ Geri al',
    
    typeMessage: 'Mesaj yazın...',
    sendPhoto: 'Fotoğraf gönder',
    recording: 'Kayıt yapılıyor...',
    voiceMessage: 'Sesli mesaj',
    unmatch: 'Eşleşmeyi kaldır',
    report: 'Şikayet et',
    block: 'Engelle',
    
    language: 'Dil',
    notifications: 'Bildirimler',
    privacy: 'Gizlilik',
    support: 'Destek',
    reportBug: '🐛 Hata bildir',
    donate: '☕ Destek ol',
    termsOfService: 'Kullanım şartları',
    privacyPolicy: 'Gizlilik politikası',
    deleteAccount: 'Hesabı sil',
    referralProgram: 'Arkadaşlarını davet et',
    inviteFriends: 'Arkadaşlarını davet et',
    yourReferralCode: 'Davet kodunuz',
    
    referralTitle: 'Arkadaşlarını davet et',
    referralDescription: 'Arkadaşlarını davet et ve Community Champion ol!',
    referralsCount: 'Davet ettiğiniz',
    leaderboard: 'Liderlik tablosu',
    communityChampion: '🌟 Community Champion',
    copyCode: 'Kodu kopyala',
    shareCode: 'Kodu paylaş',
    
    supportUs: 'Bizi destekleyin',
    donationMessage: 'MyArchetype 100% ücretsiz. Gönüllü bağışlar bize yardımcı oluyor.',
    buyMeACoffee: '☕ Bana bir kahve al',
    oneTimeDonation: 'Tek seferlik bağış',
    
    profileViews: 'Profil görüntülemeleri',
    peopleViewedYou: 'kişi profilinizi görüntüledi',
    viewedYourProfile: 'profilinizi görüntüledi',
    
    verified: 'Doğrulanmış',
    unverified: 'Doğrulanmamış',
    verifyIdentity: 'Kimliği doğrula',
    verifyHeight: 'Boyu doğrula',
    
    somethingWentWrong: 'Bir şeyler ters gitti',
    tryAgain: 'Tekrar deneyin',
    noInternet: 'İnternet bağlantısı yok',
  },

  // 🇬🇧 ENGLISH
  en: {
    appName: 'MyArchetype',
    loading: 'Loading...',
    save: 'Save',
    cancel: 'Cancel',
    confirm: 'Confirm',
    delete: 'Delete',
    edit: 'Edit',
    back: 'Back',
    next: 'Next',
    done: 'Done',
    error: 'Error',
    success: 'Success',
    yes: 'Yes',
    no: 'No',
    ok: 'OK',
    
    login: 'Log In',
    signup: 'Sign Up',
    logout: 'Log Out',
    email: 'Email',
    password: 'Password',
    confirmPassword: 'Confirm Password',
    forgotPassword: 'Forgot Password?',
    createAccount: 'Create Account',
    alreadyHaveAccount: 'Already have an account? Log In',
    noAccount: "Don't have an account? Sign Up",
    passwordRequirements: 'Password: 8+ chars, 1 uppercase, 1 number, 1 special char',
    passwordTooWeak: 'Password is too weak',
    passwordsDoNotMatch: 'Passwords do not match',
    emailAlreadyInUse: 'This email is already registered',
    invalidEmail: 'Invalid email address',
    verifyEmail: 'Verify your email',
    verificationSent: 'Verification email sent',
    
    onboardingTitle1: 'Welcome to MyArchetype',
    onboardingDesc1: 'A dating app designed for genuine connections',
    onboardingTitle2: 'How It Works',
    onboardingDesc2: 'Personality tests, verification, and deep compatibility matching',
    onboardingTitle3: '100% Free, Forever',
    onboardingDesc3: 'No restrictions. No premium. Just real people finding real love.',
    getStarted: 'Get Started',
    skip: 'Skip',
    
    welcome: 'Welcome',
    welcomeBack: 'Welcome back',
    findMatches: '🔍 Find Matches',
    myMatches: '💕 My Matches',
    editProfile: '✏️ Edit Profile',
    personalityQuiz: '🧠 Personality Quiz',
    blockedUsers: '🚫 Blocked Users',
    settings: '⚙️ Settings',
    adminPanel: '👮 Admin Panel',
    
    createProfile: 'Create Your Profile',
    photos: 'Photos',
    cameraOnly: 'CAMERA ONLY - No uploads allowed',
    firstName: 'First Name',
    age: 'Age',
    gender: 'Gender',
    male: 'Male',
    female: 'Female',
    height: 'Height (cm)',
    bodyType: 'Body Type',
    lookingFor: 'Looking For',
    religiousViews: 'Religious Views',
    lifestyle: 'Lifestyle',
    relationshipGoal: 'Relationship Goal',
    aboutMe: 'About Me',
    location: 'Location',
    updateLocation: '📍 Update Location',
    
    noMatches: 'No matches yet',
    noMoreMatches: 'No more matches',
    itsAMatch: "It's a Match! 💕",
    youAndLikedEachOther: 'You and liked each other!',
    compatibility: 'Compatibility',
    like: '♥ Like',
    pass: '✗ Pass',
    undo: '↩️ Undo',
    
    typeMessage: 'Type a message...',
    sendPhoto: 'Send Photo',
    recording: 'Recording...',
    voiceMessage: 'Voice Message',
    unmatch: 'Unmatch',
    report: 'Report',
    block: 'Block',
    
    language: 'Language',
    notifications: 'Notifications',
    privacy: 'Privacy',
    support: 'Support',
    reportBug: '🐛 Report Bug',
    donate: '☕ Support Us',
    termsOfService: 'Terms of Service',
    privacyPolicy: 'Privacy Policy',
    deleteAccount: 'Delete Account',
    referralProgram: 'Referral Program',
    inviteFriends: 'Invite Friends',
    yourReferralCode: 'Your Referral Code',
    
    referralTitle: 'Invite Friends',
    referralDescription: 'Invite your friends and become a Community Champion!',
    referralsCount: 'People you invited',
    leaderboard: 'Leaderboard',
    communityChampion: '🌟 Community Champion',
    copyCode: 'Copy Code',
    shareCode: 'Share Code',
    
    supportUs: 'Support Us',
    donationMessage: 'MyArchetype is 100% free. Voluntary donations help us keep it that way.',
    buyMeACoffee: '☕ Buy me a coffee',
    oneTimeDonation: 'One-time donation',
    
    profileViews: 'Profile Views',
    peopleViewedYou: 'people viewed your profile',
    viewedYourProfile: 'viewed your profile',
    
    verified: 'Verified',
    unverified: 'Unverified',
    verifyIdentity: 'Verify Identity',
    verifyHeight: 'Verify Height',
    
    somethingWentWrong: 'Something went wrong',
    tryAgain: 'Try again',
    noInternet: 'No internet connection',
  },

  // 🇷🇺 RUSSIAN
  ru: {
    appName: 'MyArchetype',
    loading: 'Загрузка...',
    save: 'Сохранить',
    cancel: 'Отмена',
    confirm: 'Подтвердить',
    delete: 'Удалить',
    edit: 'Редактировать',
    back: 'Назад',
    next: 'Далее',
    done: 'Готово',
    error: 'Ошибка',
    success: 'Успешно',
    yes: 'Да',
    no: 'Нет',
    ok: 'ОК',
    
    login: 'Войти',
    signup: 'Регистрация',
    logout: 'Выйти',
    email: 'Эл. почта',
    password: 'Пароль',
    confirmPassword: 'Подтвердите пароль',
    forgotPassword: 'Забыли пароль?',
    createAccount: 'Создать аккаунт',
    alreadyHaveAccount: 'Уже есть аккаунт? Войти',
    noAccount: 'Нет аккаунта? Регистрация',
    passwordRequirements: 'Пароль: 8+ символов, 1 заглавная, 1 цифра, 1 спецсимвол',
    passwordTooWeak: 'Пароль слишком слабый',
    passwordsDoNotMatch: 'Пароли не совпадают',
    emailAlreadyInUse: 'Эта почта уже используется',
    invalidEmail: 'Неверный адрес эл. почты',
    verifyEmail: 'Подтвердите эл. почту',
    verificationSent: 'Письмо отправлено',
    
    onboardingTitle1: 'Добро пожаловать в MyArchetype',
    onboardingDesc1: 'Приложение для настоящих отношений',
    onboardingTitle2: 'Как это работает',
    onboardingDesc2: 'Тесты личности, верификация и глубокая совместимость',
    onboardingTitle3: '100% Бесплатно, Всегда',
    onboardingDesc3: 'Никаких ограничений. Никакой подписки. Только настоящие люди.',
    getStarted: 'Начать',
    skip: 'Пропустить',
    
    welcome: 'Добро пожаловать',
    welcomeBack: 'С возвращением',
    findMatches: '🔍 Найти пару',
    myMatches: '💕 Мои пары',
    editProfile: '✏️ Редактировать профиль',
    personalityQuiz: '🧠 Тест личности',
    blockedUsers: '🚫 Заблокированные',
    settings: '⚙️ Настройки',
    adminPanel: '👮 Админ панель',
    
    createProfile: 'Создать профиль',
    photos: 'Фотографии',
    cameraOnly: 'Только КАМЕРА - загрузка запрещена',
    firstName: 'Имя',
    age: 'Возраст',
    gender: 'Пол',
    male: 'Мужчина',
    female: 'Женщина',
    height: 'Рост (см)',
    bodyType: 'Тип телосложения',
    lookingFor: 'Ищу',
    religiousViews: 'Религиозные взгляды',
    lifestyle: 'Образ жизни',
    relationshipGoal: 'Цель отношений',
    aboutMe: 'Обо мне',
    location: 'Местоположение',
    updateLocation: '📍 Обновить местоположение',
    
    noMatches: 'Пока нет пар',
    noMoreMatches: 'Больше нет пар',
    itsAMatch: 'Это пара! 💕',
    youAndLikedEachOther: 'Вы понравились друг другу!',
    compatibility: 'Совместимость',
    like: '♥ Нравится',
    pass: '✗ Пропустить',
    undo: '↩️ Отменить',
    
    typeMessage: 'Введите сообщение...',
    sendPhoto: 'Отправить фото',
    recording: 'Запись...',
    voiceMessage: 'Голосовое сообщение',
    unmatch: 'Отменить пару',
    report: 'Пожаловаться',
    block: 'Заблокировать',
    
    language: 'Язык',
    notifications: 'Уведомления',
    privacy: 'Конфиденциальность',
    support: 'Поддержка',
    reportBug: '🐛 Сообщить об ошибке',
    donate: '☕ Поддержать',
    termsOfService: 'Условия использования',
    privacyPolicy: 'Политика конфиденциальности',
    deleteAccount: 'Удалить аккаунт',
    referralProgram: 'Пригласить друзей',
    inviteFriends: 'Пригласить друзей',
    yourReferralCode: 'Ваш код приглашения',
    
    referralTitle: 'Пригласить друзей',
    referralDescription: 'Приглашайте друзей и станьте Community Champion!',
    referralsCount: 'Вы пригласили',
    leaderboard: 'Таблица лидеров',
    communityChampion: '🌟 Community Champion',
    copyCode: 'Копировать код',
    shareCode: 'Поделиться кодом',
    
    supportUs: 'Поддержите нас',
    donationMessage: 'MyArchetype 100% бесплатный. Добровольные пожертвования помогают нам.',
    buyMeACoffee: '☕ Купите мне кофе',
    oneTimeDonation: 'Разовое пожертвование',
    
    profileViews: 'Просмотры профиля',
    peopleViewedYou: 'человек просмотрели ваш профиль',
    viewedYourProfile: 'просмотрел(а) ваш профиль',
    
    verified: 'Подтверждён',
    unverified: 'Не подтверждён',
    verifyIdentity: 'Подтвердить личность',
    verifyHeight: 'Подтвердить рост',
    
    somethingWentWrong: 'Что-то пошло не так',
    tryAgain: 'Попробуйте снова',
    noInternet: 'Нет интернета',
  },

  // Placeholder for other languages (copy English and translate later)
  es: { ...({} as Translations) },
  fr: { ...({} as Translations) },
  de: { ...({} as Translations) },
  ar: { ...({} as Translations) },
  pt: { ...({} as Translations) },
  zh: { ...({} as Translations) },
};

// Fill remaining languages with English as fallback
['es', 'fr', 'de', 'ar', 'pt', 'zh'].forEach((lang) => {
  translations[lang as Language] = { ...translations.en };
});

// Language names for display
export const languageNames: Record<Language, string> = {
  az: '🇦🇿 Azərbaycan',
  tr: '🇹🇷 Türkçe',
  en: '🇬🇧 English',
  ru: '🇷🇺 Русский',
  es: '🇪🇸 Español',
  fr: '🇫🇷 Français',
  de: '🇩🇪 Deutsch',
  ar: '🇸🇦 العربية',
  pt: '🇧🇷 Português',
  zh: '🇨🇳 中文',
};

// Get translation function
export const getTranslation = (language: Language): Translations => {
  return translations[language] || translations.en;
};

// Default language (Azerbaijani for this app)
export const DEFAULT_LANGUAGE: Language = 'az';

// Supported languages list
export const SUPPORTED_LANGUAGES: Language[] = ['az', 'tr', 'en', 'ru', 'es', 'fr', 'de', 'ar', 'pt', 'zh'];