/**
 * storage.ts — TypeScript resolution shim
 *
 * Metro resolves   storage.native.ts  on iOS / Android
 *                  storage.web.ts     in browser
 *
 * TypeScript resolves THIS file for type-checking.
 * Both platform files export the identical StorageAdapter interface,
 * so there is no type mismatch at compile time or runtime.
 */
export {
    appStorage, createStorage, langStorage, profileStorage, settingsStorage
} from './storage.native';
export type { StorageAdapter } from './storage.native';

