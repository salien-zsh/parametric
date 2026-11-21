// Material presets: name and density (kg/m^3) used for mass properties.

import type { MaterialRef } from './types';
import { tr } from '../i18n';

export const MATERIALS: MaterialRef[] = [
  { name: tr("Plain Carbon Steel"), density: 7800 },
  { name: tr("Stainless Steel (304)"), density: 8000 },
  { name: tr("Alloy Steel"), density: 7700 },
  { name: tr("Cast Iron"), density: 7200 },
  { name: tr("Aluminum 6061"), density: 2700 },
  { name: tr("Aluminum 7075"), density: 2810 },
  { name: tr("Brass"), density: 8500 },
  { name: tr("Copper"), density: 8900 },
  { name: tr("Titanium (Ti-6Al-4V)"), density: 4430 },
  { name: 'ABS', density: 1040 },
  { name: 'PLA', density: 1240 },
  { name: 'PETG', density: 1270 },
  { name: tr("Nylon 6/6"), density: 1140 },
  { name: tr("Acrylic (PMMA)"), density: 1190 },
  { name: tr("Polycarbonate"), density: 1200 },
  { name: tr("Oak"), density: 750 },
  { name: tr("Pine"), density: 510 },
  { name: tr("Glass"), density: 2500 },
];
