import type { AgentMessage, TokenUsage } from '@/lib/agent/types';
import type { WorkspaceTab } from '@/lib/types/workspaceTab';
import type { ApprovalMode } from '@/lib/types/agent';
import type { ImageSettings, ParserSettings, WikiSettings } from '@/lib/db/repositories/settingsRepo';

export type ChatSessionOrigin = 'chat' | 'explorer' | 'macro' | 'wiki';

export interface ChatSession {
  id: string;
  agentId: string;
  workspaceRoot: string | null;
  origin: ChatSessionOrigin;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export type EntryType = 'message' | 'compaction' | 'custom';

export interface EntryBase {
  id: string;
  sessionId: string;
  parentId: string | null;
  seq: number;
  type: EntryType;
  createdAt: string;
}

export interface MessageEntry extends EntryBase {
  type: 'message';
  message: AgentMessage;
}

export interface CompactionEntry extends EntryBase {
  type: 'compaction';
  summary: string;
  firstKeptEntryId: string;
  tokensBefore: number;
  usage?: TokenUsage;
  details: { readFiles: string[]; modifiedFiles: string[] };
}

export interface CustomEntry extends EntryBase {
  type: 'custom';
  customType: string;
  payload?: unknown;
}

export type Entry = MessageEntry | CompactionEntry | CustomEntry;

export interface AppSettings {
  id: string;
  openTabs: WorkspaceTab[];
  activeTabId: string | null;
  theme: 'dark' | 'light' | 'system';
  language: string;
  ollamaBaseUrl: string;
  defaultContextSize: number;
  /** 새 에이전트의 temperature 기본값 (기본 0.2). */
  defaultTemperature: number;
  /** 전역 압축 여유분 기본값. 0이면 컨텍스트 크기별 단계표(auto)를 쓴다. */
  defaultReserveTokens: number;
  /** 전역 압축 후 보존량 기본값. 0이면 컨텍스트 크기별 단계표(auto)를 쓴다. */
  defaultKeepRecentTokens: number;
  defaultApprovalMode: ApprovalMode;
  trustedWorkspaces: string[];
  lastWorkspaceRoot: string | null;
  monitoringIntervalMs: number;
  /** 셋업 위저드 완료 시각 (null이면 미실행, P11-06). */
  setupCompletedAt: string | null;
  /** 작업 폴더 (D2, P11-04). null이면 workspaceRoot를 그대로 쓴다. */
  workFolder: string | null;
  /** 탐색기 즐겨찾기 폴더 (P11-12). */
  favorites: string[];
  /** 사용자가 등록한 에이전트 허용 폴더 (D1, P11-04). 작업 폴더는 항상 포함된다. */
  agentAllowedRoots: string[];
  /** 위키 설정 블록 (P11-04에 저장소만, 화면·파이프라인은 W3). */
  wiki: WikiSettings;
  /** 문서 파서 설정 블록 (P11-04에 저장소만, 화면은 P11-34). */
  parsers: ParserSettings;
  /** 이미지 앨범·뷰어 설정 블록. */
  image: ImageSettings;
}
