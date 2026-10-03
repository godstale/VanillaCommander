import { z } from 'zod';

export const ImageSettingsSchema = z.object({
  /** 이미지 탭을 열 때 탭 크기에 맞춰 축소/확대해서 보여준다. */
  viewerFitOnOpen: z.boolean().default(true),
  /** 확대/축소 단축키·버튼 1회당 변화량(%). */
  viewerZoomStep: z.number().int().min(1).max(100).default(10),
  /** 앨범 썸네일을 다운스케일할 너비(px). */
  albumThumbWidth: z.number().int().min(80).max(1024).default(320),
  /** 앨범 썸네일 동시 생성 수. */
  albumMaxJobs: z.number().int().min(1).max(16).default(4),
});
export type ImageSettings = z.infer<typeof ImageSettingsSchema>;

export const DEFAULT_IMAGE_SETTINGS: ImageSettings = ImageSettingsSchema.parse({});
