import { observable } from '@legendapp/state';
import { ObservablePersistMMKV } from '@legendapp/state/persist-plugins/mmkv';
import { syncObservable } from '@legendapp/state/sync';

export const store$ = observable({
  user: {
    id:              null as string | null,
    name:            '',
    email:           null as string | null,
    avatar:          null as string | null,
    token:           null as string | null,
    emailVerified:   false,
    profileComplete: false,
  },
  ui: {
    theme:          'dark' as 'light' | 'dark',
    isLoading:      false,
    isHighContrast: false,
    isOnline:       true,
  },
  prefs: {
    language:      'en',
    reduceMotion:  false,
    notifications: true,
  },
});

syncObservable(store$, {
  persist: {
    name:   'appStore',
    plugin: ObservablePersistMMKV,
  },
});