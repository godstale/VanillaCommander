// P11-26: 이미지 첨부·비전 지원 판정.
import type { Agent } from '@/lib/types/agent';
import { showModel } from '@/lib/llm/ollamaClient';
import { fcReadFileBytes, fcWriteBytes } from '@/lib/commander/ipc';

// 메시지 매퍼와 동일한 구현을 공유한다 (중복 분기 방지).
export { resolveImageDataUrls } from '@/lib/llm/messageMapper';

export type VisionVerdict = 'yes' | 'no' | 'unknown';

/**
 * 에이전트의 이미지 입력 가능 여부.
 * - 'yes'/'no': 명시값 그대로.
 * - 'auto': Ollama면 /api/show capabilities의 vision으로 판정,
 *   OpenAI 호환 등은 판정 불가(unknown) → 편집 화면에서 수동 선택 안내.
 */
export async function resolveVisionSupport(agent: Pick<Agent, 'vision' | 'llmProvider' | 'llmBaseUrl' | 'model'>): Promise<VisionVerdict> {
  const mode = agent.vision ?? 'auto';
  if (mode === 'yes') return 'yes';
  if (mode === 'no') return 'no';
  if ((agent.llmProvider ?? 'ollama') !== 'ollama') return 'unknown';
  try {
    const info = await showModel(agent.llmBaseUrl, agent.model);
    return info.supportsVision ? 'yes' : 'no';
  } catch {
    return 'unknown';
  }
}

function baseNameOf(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : path;
}

function joinPath(dir: string, name: string): string {
  const sep = dir.includes('\\') ? '\\' : '/';
  return `${dir.replace(/[\\/]+$/, '')}${sep}${name}`;
}

function normalize(p: string): string {
  return p.replace(/\//g, '\\').toLowerCase();
}

/**
 * 첨부 이미지를 채팅용 경로로 확정한다. 작업 폴더 밖 파일은
 * `<workFolder>/chat-images/`에 복사한다 (DB에는 경로만 저장).
 */
export async function ensureChatImage(sourcePath: string, workFolder?: string): Promise<string> {
  if (workFolder) {
    const folderNorm = normalize(workFolder);
    const srcNorm = normalize(sourcePath);
    if (srcNorm !== folderNorm && !srcNorm.startsWith(`${folderNorm}\\`)) {
      const bytes = await fcReadFileBytes(sourcePath);
      const dest = joinPath(joinPath(workFolder, 'chat-images'), baseNameOf(sourcePath));
      await fcWriteBytes(dest, bytes.base64);
      return dest;
    }
  }
  return sourcePath;
}
