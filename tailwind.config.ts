import type { Config } from 'tailwindcss';
import tailwindcssAnimate from 'tailwindcss-animate';
import vanillaPreset from './design/tailwind.preset';

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  presets: [vanillaPreset],
  plugins: [tailwindcssAnimate],
} satisfies Config;
