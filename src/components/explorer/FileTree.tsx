import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { invoke } from '@tauri-apps/api/core';
import {
  ChevronRight,
  ChevronDown,
  File,
  Folder,
  FolderPlus,
  FilePlus,
  RefreshCw,
  List,
  ListTree,
  Trash2,
  Edit2,
  Search,
  Copy,
  Scissors,
  ClipboardPaste,
  FolderSearch,
  FolderOpen,
  ChevronsUpDown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useWorkspaceTabs } from '@/lib/context/WorkspaceTabsContext';
import { useWorkspace } from '@/lib/context/WorkspaceContext';
import { useGlobalLlmBusy } from '@/lib/agent/chatQueueManager';
import type { FileTreeNode } from '@/lib/types/fileTree';
import { cn } from '@/lib/utils';
import { getFileIcon } from '@/lib/fileIcons';
import { useLanguage } from '@/lib/i18n/LanguageContext';

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp']);

function isImageFile(fileName: string): boolean {
  const ext = fileName.split('.').pop()?.toLowerCase();
  return Boolean(ext) && IMAGE_EXTENSIONS.has(ext!);
}

function getParentPath(path: string): string {
  const sep = path.includes('\\') ? '\\' : '/';
  const idx = path.lastIndexOf(sep);
  return idx > 0 ? path.substring(0, idx) : path;
}

function getCopyFileName(name: string, isDir: boolean): string {
  if (isDir) {
    return `${name} (copy)`;
  }
  const lastDot = name.lastIndexOf('.');
  if (lastDot > 0) {
    const base = name.substring(0, lastDot);
    const ext = name.substring(lastDot);
    return `${base} (copy)${ext}`;
  }
  return `${name} (copy)`;
}

interface ClipboardState {
  action: 'copy' | 'cut';
  node: FileTreeNode;
}

interface ContextMenuState {
  x: number;
  y: number;
  node: FileTreeNode | null;
}

export function FileTree() {
  const { t } = useLanguage();
  const { openTab } = useWorkspaceTabs();
  const { workspaceRoot, setWorkspaceRoot } = useWorkspace();
  const busySessionId = useGlobalLlmBusy();
  const isLlmBusy = busySessionId !== null;
  const workspacePath = workspaceRoot;
  const [tree, setTree] = useState<FileTreeNode | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'tree' | 'list'>('tree');
  const [loading, setLoading] = useState(false);

  // Inline creation / rename state
  const [creatingIn, setCreatingIn] = useState<{
    dirPath: string;
    type: 'file' | 'folder';
  } | null>(null);
  const [creatingName, setCreatingName] = useState('');
  const [renamingNode, setRenamingNode] = useState<FileTreeNode | null>(null);
  const [renamingName, setRenamingName] = useState('');

  // Context menu and clipboard state
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [clipboardItem, setClipboardItem] = useState<ClipboardState | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const menuPos = useMemo(() => {
    if (!contextMenu) return { x: 0, y: 0 };
    const menuWidth = 200;
    const menuHeight = contextMenu.node ? 270 : 190;
    const x = Math.max(8, Math.min(contextMenu.x, window.innerWidth - menuWidth - 8));
    const y = Math.max(8, Math.min(contextMenu.y, window.innerHeight - menuHeight - 8));
    return { x, y };
  }, [contextMenu]);

  const loadTree = useCallback(async (dirPath: string) => {
    setLoading(true);
    try {
      const res = await invoke<FileTreeNode>('read_project_folder_tree', {
        folderPath: dirPath,
      });
      setTree(res);
      setExpanded((prev) => {
        const next = new Set(prev);
        next.add(dirPath);
        return next;
      });
    } catch (err) {
      console.error('Failed to read project tree:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      await Promise.resolve();
      if (!active) return;
      if (workspaceRoot) {
        await loadTree(workspaceRoot);
      } else {
        setTree(null);
      }
    })();
    return () => {
      active = false;
    };
  }, [workspaceRoot, loadTree]);

  // Handle outside click / ESC / scroll for context menu
  useEffect(() => {
    if (!contextMenu) return;

    const handlePointerDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setContextMenu(null);
      }
    };

    const handleScroll = () => {
      setContextMenu(null);
    };

    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('wheel', handleScroll, { passive: true });

    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('wheel', handleScroll);
    };
  }, [contextMenu]);

  const handlePickFolder = async () => {
    if (isLlmBusy) return;
    try {
      const picked = await invoke<string | null>('pick_project_folder');
      if (picked) {
        setWorkspaceRoot(picked);
      }
    } catch (err) {
      console.error('Failed to pick project folder:', err);
    }
  };

  const toggleExpand = (dirPath: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(dirPath)) {
        next.delete(dirPath);
      } else {
        next.add(dirPath);
      }
      return next;
    });
  };

  const handleNodeClick = (node: FileTreeNode) => {
    if (node.is_dir) {
      toggleExpand(node.path);
    } else {
      if (isImageFile(node.name)) {
        openTab({
          id: `image-viewer:${node.path}`,
          type: 'image-viewer',
          title: node.name,
          meta: { filePath: node.path },
        });
      } else {
        openTab({
          id: `editor:${node.path}`,
          type: 'editor',
          title: node.name,
          meta: { filePath: node.path },
        });
      }
    }
  };

  const handleCreateSubmit = async () => {
    if (!creatingIn || !creatingName.trim()) {
      setCreatingIn(null);
      setCreatingName('');
      return;
    }
    const sep = creatingIn.dirPath.includes('\\') ? '\\' : '/';
    const targetPath = `${creatingIn.dirPath.replace(/[\\/]+$/, '')}${sep}${creatingName.trim()}`;

    try {
      if (creatingIn.type === 'file') {
        await invoke('create_file', { path: targetPath });
      } else {
        await invoke('create_folder', { path: targetPath });
      }
      if (workspacePath) {
        await loadTree(workspacePath);
      }
    } catch (err) {
      alert(t('fileTree.createFailed', { err: String(err) }));
    } finally {
      setCreatingIn(null);
      setCreatingName('');
    }
  };

  const handleRenameSubmit = async () => {
    if (!renamingNode || !renamingName.trim() || renamingName.trim() === renamingNode.name) {
      setRenamingNode(null);
      setRenamingName('');
      return;
    }
    const sep = renamingNode.path.includes('\\') ? '\\' : '/';
    const parent = renamingNode.path.substring(0, renamingNode.path.lastIndexOf(sep));
    const targetPath = `${parent}${sep}${renamingName.trim()}`;

    try {
      await invoke('rename_path', { from: renamingNode.path, to: targetPath });
      if (workspacePath) {
        await loadTree(workspacePath);
      }
    } catch (err) {
      alert(t('fileTree.renameFailed', { err: String(err) }));
    } finally {
      setRenamingNode(null);
      setRenamingName('');
    }
  };

  const handleDelete = async (node: FileTreeNode) => {
    const isConfirmed = window.confirm(t('fileTree.deleteConfirm', { name: node.name }));
    if (!isConfirmed) return;

    try {
      await invoke('delete_path', { path: node.path });
      if (workspacePath) {
        await loadTree(workspacePath);
      }
    } catch (err) {
      alert(t('fileTree.deleteFailed', { err: String(err) }));
    }
  };

  // Node Context Menu Actions
  const handleOpen = (node: FileTreeNode) => {
    if (node.is_dir) {
      setExpanded((prev) => {
        const next = new Set(prev);
        next.add(node.path);
        return next;
      });
    } else {
      handleNodeClick(node);
    }
  };

  const handleCopy = (node: FileTreeNode) => {
    setClipboardItem({ action: 'copy', node });
    void navigator.clipboard?.writeText(node.path).catch(() => {});
  };

  const handleCut = (node: FileTreeNode) => {
    setClipboardItem({ action: 'cut', node });
    void navigator.clipboard?.writeText(node.path).catch(() => {});
  };

  const handlePaste = async (targetNode: FileTreeNode | null) => {
    if (!clipboardItem || !workspacePath) return;

    const destDir = targetNode
      ? targetNode.is_dir
        ? targetNode.path
        : getParentPath(targetNode.path)
      : workspacePath;

    const sep = destDir.includes('\\') ? '\\' : '/';
    const srcParent = getParentPath(clipboardItem.node.path);

    let destName = clipboardItem.node.name;
    if (clipboardItem.action === 'copy' && destDir === srcParent) {
      destName = getCopyFileName(destName, clipboardItem.node.is_dir);
    }

    const targetPath = `${destDir.replace(/[\\/]+$/, '')}${sep}${destName}`;

    try {
      if (clipboardItem.action === 'copy') {
        await invoke('copy_path', {
          from: clipboardItem.node.path,
          to: targetPath,
        });
      } else {
        await invoke('rename_path', {
          from: clipboardItem.node.path,
          to: targetPath,
        });
        setClipboardItem(null);
      }
      await loadTree(workspacePath);
    } catch (err) {
      alert(t('fileTree.pasteFailed', { err: String(err) }));
    }
  };

  const handleRevealInExplorer = async (node: FileTreeNode) => {
    try {
      await invoke('reveal_in_explorer', { path: node.path });
    } catch (err) {
      console.error('Failed to reveal in explorer:', err);
      alert(t('fileTree.openExplorerFailed', { err: String(err) }));
    }
  };

  // Helper to gather all folder paths recursively
  const getAllFolderPaths = useCallback((rootNode: FileTreeNode | null): string[] => {
    if (!rootNode) return [];
    const list: string[] = [];
    function walk(n: FileTreeNode) {
      if (n.is_dir) {
        list.push(n.path);
        if (n.children) {
          for (const c of n.children) {
            walk(c);
          }
        }
      }
    }
    walk(rootNode);
    return list;
  }, []);

  const handleToggleFoldUnfoldAll = () => {
    if (!tree) return;
    if (expanded.size > 0) {
      setExpanded(new Set());
    } else {
      const allFolders = getAllFolderPaths(tree);
      setExpanded(new Set(allFolders));
    }
  };

  // Flattened file list for list view
  const flatFiles = useMemo(() => {
    if (!tree) return [];
    const list: FileTreeNode[] = [];
    function traverse(n: FileTreeNode) {
      if (!n.is_dir) {
        list.push(n);
      }
      if (n.children) {
        for (const c of n.children) traverse(c);
      }
    }
    traverse(tree);
    return list;
  }, [tree]);

  const filteredFlatFiles = useMemo(() => {
    if (!searchQuery.trim()) return flatFiles;
    const q = searchQuery.toLowerCase();
    return flatFiles.filter((f) => f.name.toLowerCase().includes(q));
  }, [flatFiles, searchQuery]);

  const handleNodeContextMenu = (e: React.MouseEvent, node: FileTreeNode) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      node,
    });
  };

  const handleEmptyContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      node: null,
    });
  };

  const renderTreeItem = (node: FileTreeNode, depth = 0) => {
    const isExpanded = expanded.has(node.path);
    const matchesSearch =
      !searchQuery.trim() || node.name.toLowerCase().includes(searchQuery.toLowerCase());

    if (!node.is_dir && !matchesSearch) {
      return null;
    }

    return (
      <div
        key={node.path}
        className="flex flex-col select-none"
        onContextMenu={(e) => handleNodeContextMenu(e, node)}
      >
        <DropdownMenu>
          <div
            className={cn(
              'flex items-center justify-between group px-1 py-1 hover:bg-accent/60 rounded cursor-pointer text-xs transition-colors',
            )}
            style={{ paddingLeft: `${depth * 14 + 6}px` }}
          >
            <div
              className="flex items-center gap-1.5 flex-1 min-w-0"
              onClick={() => handleNodeClick(node)}
            >
              {node.is_dir ? (
                <>
                  <span className="text-muted-foreground">
                    {isExpanded ? (
                      <ChevronDown className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5" />
                    )}
                  </span>
                  {(() => {
                    const iconSpec = getFileIcon(node.name, true, isExpanded);
                    return (
                      <iconSpec.Icon
                        className="h-4 w-4 shrink-0"
                        style={{ color: iconSpec.color }}
                      />
                    );
                  })()}
                </>
              ) : (
                <>
                  <span className="w-3.5" />
                  {(() => {
                    const iconSpec = getFileIcon(node.name, false);
                    return (
                      <iconSpec.Icon
                        className="h-4 w-4 shrink-0"
                        style={{ color: iconSpec.color }}
                      />
                    );
                  })()}
                </>
              )}

              {renamingNode?.path === node.path ? (
                <input
                  type="text"
                  autoFocus
                  value={renamingName}
                  onChange={(e) => setRenamingName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleRenameSubmit();
                    if (e.key === 'Escape') setRenamingNode(null);
                  }}
                  onBlur={handleRenameSubmit}
                  className="bg-background border border-primary px-1 py-0.5 rounded text-xs w-full text-foreground outline-none"
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span className="truncate">{node.name}</span>
              )}
            </div>

            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={t('fileTree.options')}
                className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-background rounded text-muted-foreground"
                onClick={(e) => e.stopPropagation()}
              >
                •••
              </button>
            </DropdownMenuTrigger>
          </div>

          <DropdownMenuContent align="start" className="w-40 text-xs">
            {node.is_dir && (
              <>
                <DropdownMenuItem
                  onClick={() => {
                    setCreatingIn({ dirPath: node.path, type: 'file' });
                    setCreatingName('');
                    if (!isExpanded) toggleExpand(node.path);
                  }}
                >
                  <FilePlus className="h-3.5 w-3.5 mr-2" /> {t('fileTree.newFile')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    setCreatingIn({ dirPath: node.path, type: 'folder' });
                    setCreatingName('');
                    if (!isExpanded) toggleExpand(node.path);
                  }}
                >
                  <FolderPlus className="h-3.5 w-3.5 mr-2" /> {t('fileTree.newFolder')}
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuItem
              onClick={() => {
                setRenamingNode(node);
                setRenamingName(node.name);
              }}
            >
              <Edit2 className="h-3.5 w-3.5 mr-2" /> {t('fileTree.rename')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => handleDelete(node)}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5 mr-2" /> {t('fileTree.delete')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {node.is_dir && isExpanded && (
          <div>
            {creatingIn?.dirPath === node.path && (
              <div
                className="flex items-center gap-1.5 px-1 py-1"
                style={{ paddingLeft: `${(depth + 1) * 14 + 6}px` }}
              >
                {creatingIn.type === 'folder' ? (
                  <Folder className="h-4 w-4 text-warning" />
                ) : (
                  <File className="h-4 w-4 text-muted-foreground" />
                )}
                <input
                  type="text"
                  autoFocus
                  placeholder={creatingIn.type === 'folder' ? t('fileTree.folderNamePlaceholder') : t('fileTree.fileNamePlaceholder')}
                  value={creatingName}
                  onChange={(e) => setCreatingName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreateSubmit();
                    if (e.key === 'Escape') setCreatingIn(null);
                  }}
                  onBlur={handleCreateSubmit}
                  className="bg-background border border-primary px-1 py-0.5 rounded text-xs flex-1 text-foreground outline-none"
                />
              </div>
            )}
            {node.children?.map((child) => renderTreeItem(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      className="flex flex-col h-full bg-sidebar select-none min-w-0"
      onContextMenu={handleEmptyContextMenu}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-border">
        <button
          type="button"
          onClick={isLlmBusy ? undefined : handlePickFolder}
          disabled={isLlmBusy}
          className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 truncate hover:text-foreground hover:bg-accent/50 px-1.5 py-0.5 rounded transition-colors text-left disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:text-muted-foreground disabled:hover:bg-transparent"
          title={isLlmBusy ? t('topMenu.folderChangeBlocked') : t('fileTree.clickToChange')}
        >
          <Folder className="h-3.5 w-3.5 shrink-0 text-warning" />
          <span className="truncate">{tree ? tree.name : t('fileTree.title')}</span>
        </button>
        <div className="flex items-center gap-0.5 shrink-0">
          {tree && (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => setViewMode((v) => (v === 'tree' ? 'list' : 'tree'))}
                title={viewMode === 'tree' ? t('fileTree.switchToList') : t('fileTree.switchToTree')}
              >
                {viewMode === 'tree' ? (
                  <List className="h-3.5 w-3.5" />
                ) : (
                  <ListTree className="h-3.5 w-3.5" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => {
                  if (workspacePath) {
                    setCreatingIn({ dirPath: workspacePath, type: 'file' });
                    setCreatingName('');
                  }
                }}
                title={t('fileTree.newFileAtRoot')}
              >
                <FilePlus className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => {
                  if (workspacePath) {
                    setCreatingIn({ dirPath: workspacePath, type: 'folder' });
                    setCreatingName('');
                  }
                }}
                title={t('fileTree.newFolderAtRoot')}
              >
                <FolderPlus className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => workspacePath && loadTree(workspacePath)}
                disabled={loading}
                title={t('fileTree.refresh')}
              >
                <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
              </Button>
            </>
          )}
        </div>
      </div>

      {!workspacePath ? (
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-muted-foreground gap-3">
          <Folder className="h-10 w-10 opacity-30" />
          <p className="text-xs">{t('fileTree.noFolder')}</p>
          <Button
            size="sm"
            onClick={handlePickFolder}
            disabled={isLlmBusy}
            title={isLlmBusy ? t('topMenu.folderChangeBlocked') : undefined}
            className="text-xs"
          >
            {t('fileTree.openFolder')}
          </Button>
        </div>
      ) : (
        <>
          {/* Search bar */}
          <div className="p-2 border-b border-border">
            <div className="relative">
              <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('fileTree.searchPlaceholder')}
                className="h-7 pl-7 text-xs bg-background/50"
              />
            </div>
          </div>

          {/* Body */}
          <div
            className="flex-1 overflow-y-auto p-1 font-mono text-xs"
            onContextMenu={handleEmptyContextMenu}
          >
            {creatingIn?.dirPath === workspacePath && (
              <div className="flex items-center gap-1.5 px-2 py-1">
                {creatingIn.type === 'folder' ? (
                  <Folder className="h-4 w-4 text-warning" />
                ) : (
                  <File className="h-4 w-4 text-muted-foreground" />
                )}
                <input
                  type="text"
                  autoFocus
                  placeholder={creatingIn.type === 'folder' ? t('fileTree.folderNamePlaceholder') : t('fileTree.fileNamePlaceholder')}
                  value={creatingName}
                  onChange={(e) => setCreatingName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreateSubmit();
                    if (e.key === 'Escape') setCreatingIn(null);
                  }}
                  onBlur={handleCreateSubmit}
                  className="bg-background border border-primary px-1 py-0.5 rounded text-xs flex-1 text-foreground outline-none"
                />
              </div>
            )}

            {viewMode === 'tree' ? (
              tree ? (
                renderTreeItem(tree)
              ) : (
                <div className="p-4 text-center text-muted-foreground">{t('fileTree.loading')}</div>
              )
            ) : (
              <div className="flex flex-col gap-0.5">
                {filteredFlatFiles.map((file) => {
                  const iconSpec = getFileIcon(file.name, false);
                  return (
                    <div
                      key={file.path}
                      onClick={() => handleNodeClick(file)}
                      onContextMenu={(e) => handleNodeContextMenu(e, file)}
                      className="flex items-center gap-1.5 px-2 py-1 hover:bg-accent/60 rounded cursor-pointer"
                    >
                      <iconSpec.Icon
                        className="h-4 w-4 shrink-0"
                        style={{ color: iconSpec.color }}
                      />
                      <span className="truncate">{file.name}</span>
                    </div>
                  );
                })}
                {filteredFlatFiles.length === 0 && (
                  <div className="p-4 text-center text-muted-foreground">
                    {t('fileTree.noResults')}
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {/* Context Menu Modal / Portal */}
      {contextMenu &&
        createPortal(
          <div
            ref={menuRef}
            className="fixed z-50 min-w-[190px] rounded-md border border-border bg-popover/95 p-1 text-popover-foreground shadow-lg backdrop-blur-sm animate-in fade-in-0 zoom-in-95 font-sans text-xs select-none"
            style={{ left: `${menuPos.x}px`, top: `${menuPos.y}px` }}
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.preventDefault()}
          >
            {contextMenu.node ? (
              /* File/Folder Context Menu */
              <div className="flex flex-col gap-0.5">
                <button
                  type="button"
                  onClick={() => {
                    handleOpen(contextMenu.node!);
                    setContextMenu(null);
                  }}
                  className="flex w-full items-center gap-2 rounded-sm px-2.5 py-1.5 text-xs outline-none transition-colors hover:bg-accent hover:text-accent-foreground text-left"
                >
                  <FolderOpen className="h-3.5 w-3.5 text-muted-foreground" />
                  <span>{t('fileTree.ctxOpen')}</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    handleCopy(contextMenu.node!);
                    setContextMenu(null);
                  }}
                  className="flex w-full items-center gap-2 rounded-sm px-2.5 py-1.5 text-xs outline-none transition-colors hover:bg-accent hover:text-accent-foreground text-left"
                >
                  <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                  <span>{t('fileTree.ctxCopy')}</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    handleCut(contextMenu.node!);
                    setContextMenu(null);
                  }}
                  className="flex w-full items-center gap-2 rounded-sm px-2.5 py-1.5 text-xs outline-none transition-colors hover:bg-accent hover:text-accent-foreground text-left"
                >
                  <Scissors className="h-3.5 w-3.5 text-muted-foreground" />
                  <span>{t('fileTree.ctxCut')}</span>
                </button>

                <button
                  type="button"
                  disabled={!clipboardItem}
                  onClick={() => {
                    void handlePaste(contextMenu.node!);
                    setContextMenu(null);
                  }}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-sm px-2.5 py-1.5 text-xs outline-none transition-colors hover:bg-accent hover:text-accent-foreground text-left',
                    !clipboardItem && 'opacity-40 cursor-not-allowed pointer-events-none',
                  )}
                >
                  <ClipboardPaste className="h-3.5 w-3.5 text-muted-foreground" />
                  <span>{t('fileTree.ctxPaste')}</span>
                </button>

                <div className="my-1 h-px bg-border/60" />

                <button
                  type="button"
                  onClick={() => {
                    setRenamingNode(contextMenu.node);
                    setRenamingName(contextMenu.node!.name);
                    setContextMenu(null);
                  }}
                  className="flex w-full items-center gap-2 rounded-sm px-2.5 py-1.5 text-xs outline-none transition-colors hover:bg-accent hover:text-accent-foreground text-left"
                >
                  <Edit2 className="h-3.5 w-3.5 text-muted-foreground" />
                  <span>{t('fileTree.ctxRename')}</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const target = contextMenu.node!;
                    setContextMenu(null);
                    void handleDelete(target);
                  }}
                  className="flex w-full items-center gap-2 rounded-sm px-2.5 py-1.5 text-xs outline-none transition-colors hover:bg-destructive/10 text-destructive text-left"
                >
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  <span>{t('fileTree.ctxDelete')}</span>
                </button>

                <div className="my-1 h-px bg-border/60" />

                <button
                  type="button"
                  onClick={() => {
                    void handleRevealInExplorer(contextMenu.node!);
                    setContextMenu(null);
                  }}
                  className="flex w-full items-center gap-2 rounded-sm px-2.5 py-1.5 text-xs outline-none transition-colors hover:bg-accent hover:text-accent-foreground text-left"
                >
                  <FolderSearch className="h-3.5 w-3.5 text-muted-foreground" />
                  <span>{t('fileTree.ctxReveal')}</span>
                </button>
              </div>
            ) : (
              /* Empty Space Context Menu */
              <div className="flex flex-col gap-0.5">
                <button
                  type="button"
                  onClick={() => {
                    if (workspacePath) {
                      setCreatingIn({ dirPath: workspacePath, type: 'file' });
                      setCreatingName('');
                    }
                    setContextMenu(null);
                  }}
                  className="flex w-full items-center gap-2 rounded-sm px-2.5 py-1.5 text-xs outline-none transition-colors hover:bg-accent hover:text-accent-foreground text-left"
                >
                  <FilePlus className="h-3.5 w-3.5 text-muted-foreground" />
                  <span>{t('fileTree.ctxNewFile')}</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    if (workspacePath) {
                      setCreatingIn({ dirPath: workspacePath, type: 'folder' });
                      setCreatingName('');
                    }
                    setContextMenu(null);
                  }}
                  className="flex w-full items-center gap-2 rounded-sm px-2.5 py-1.5 text-xs outline-none transition-colors hover:bg-accent hover:text-accent-foreground text-left"
                >
                  <FolderPlus className="h-3.5 w-3.5 text-muted-foreground" />
                  <span>{t('fileTree.ctxNewFolder')}</span>
                </button>

                <div className="my-1 h-px bg-border/60" />

                <button
                  type="button"
                  onClick={() => {
                    if (workspacePath) {
                      void loadTree(workspacePath);
                    }
                    setContextMenu(null);
                  }}
                  className="flex w-full items-center gap-2 rounded-sm px-2.5 py-1.5 text-xs outline-none transition-colors hover:bg-accent hover:text-accent-foreground text-left"
                >
                  <RefreshCw className={cn('h-3.5 w-3.5 text-muted-foreground', loading && 'animate-spin')} />
                  <span>{t('fileTree.ctxRefresh')}</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setViewMode((v) => (v === 'tree' ? 'list' : 'tree'));
                    setContextMenu(null);
                  }}
                  className="flex w-full items-center gap-2 rounded-sm px-2.5 py-1.5 text-xs outline-none transition-colors hover:bg-accent hover:text-accent-foreground text-left"
                >
                  {viewMode === 'tree' ? (
                    <List className="h-3.5 w-3.5 text-muted-foreground" />
                  ) : (
                    <ListTree className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                  <span>{t('fileTree.ctxToggleView')}</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    handleToggleFoldUnfoldAll();
                    setContextMenu(null);
                  }}
                  className="flex w-full items-center gap-2 rounded-sm px-2.5 py-1.5 text-xs outline-none transition-colors hover:bg-accent hover:text-accent-foreground text-left"
                >
                  <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground" />
                  <span>{t('fileTree.ctxFoldAll')}</span>
                </button>
              </div>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}

export default FileTree;
