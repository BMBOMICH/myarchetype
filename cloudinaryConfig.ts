// Cloudinary is public-safe — cloud name and upload preset are not secrets.
// They are intentionally exposed in client bundles (upload preset is write-only,
// scoped by Cloudinary upload rules).
export const CLOUDINARY_CONFIG = {
  cloudName:    process.env.EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME    ?? 'dryu4q3x6',
  uploadPreset: process.env.EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET ?? 'myarchetype_uploads',
} as const;