import type { Config } from 'tailwindcss';
import tailwindcssAnimate from 'tailwindcss-animate';
import fortressPreset from './design/tailwind.preset';

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  presets: [fortressPreset],
  plugins: [tailwindcssAnimate],
} satisfies Config;
