import type { Dict } from '../ko';
import { evalCommonKo } from './common.ko';
import { evalLockKo } from './lock.ko';
import { evalPacksKo } from './packs.ko';
import { evalWizardKo } from './wizard.ko';
import { evalProgressKo } from './progress.ko';
import { evalReportKo } from './report.ko';
import { evalJudgeKo } from './judge.ko';
import { evalIntegrationsKo } from './integrations.ko';
import { evalPersonalKo } from './personal.ko';
import { evalArenaKo } from './arena.ko';
import { evalInteropKo } from './interop.ko';
import { evalRunnerKo } from './runner.ko';
import { evalCommonEn } from './common.en';
import { evalLockEn } from './lock.en';
import { evalPacksEn } from './packs.en';
import { evalWizardEn } from './wizard.en';
import { evalProgressEn } from './progress.en';
import { evalReportEn } from './report.en';
import { evalJudgeEn } from './judge.en';
import { evalIntegrationsEn } from './integrations.en';
import { evalPersonalEn } from './personal.en';
import { evalArenaEn } from './arena.en';
import { evalInteropEn } from './interop.en';
import { evalRunnerEn } from './runner.en';

export const evalKo: Dict = {
  ...evalCommonKo,
  ...evalLockKo,
  ...evalPacksKo,
  ...evalWizardKo,
  ...evalProgressKo,
  ...evalReportKo,
  ...evalJudgeKo,
  ...evalIntegrationsKo,
  ...evalPersonalKo,
  ...evalArenaKo,
  ...evalInteropKo,
  ...evalRunnerKo,
};

export const evalEn: Dict = {
  ...evalCommonEn,
  ...evalLockEn,
  ...evalPacksEn,
  ...evalWizardEn,
  ...evalProgressEn,
  ...evalReportEn,
  ...evalJudgeEn,
  ...evalIntegrationsEn,
  ...evalPersonalEn,
  ...evalArenaEn,
  ...evalInteropEn,
  ...evalRunnerEn,
};
