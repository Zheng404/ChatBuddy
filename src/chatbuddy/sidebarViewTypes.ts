/**
 * 侧边栏 Webview 共享类型定义。
 *
 * 定义 Host → Webview（出站）与 Webview → Host（入站）的消息联合类型，
 * 以及 4 个侧边栏 view 的种类标识。
 *
 * 通信协议：
 * - Host → Webview 只有 {type:'state',payload} 和 {type:'clearSearch'}
 * - Webview → Host 有 ready / invokeCommand / toggleGroupCollapse / search
 *
 * 各 view 具体的 State 接口由各自的 provider 文件定义（后续阶段补充），
 * 本文件只承载消息联合类型与 SidebarViewKind。
 */

/** Host → Webview 出站消息：全量状态推送或显式清空搜索 */
export type SidebarOutbound<TState> =
  | { type: 'state'; payload: TState }
  | { type: 'clearSearch' };

/** Webview → Host 入站消息 */
export type SidebarInbound =
  | { type: 'ready' }
  | { type: 'invokeCommand'; command: string; args?: unknown[] }
  | { type: 'toggleGroupCollapse'; groupId: string; collapsed: boolean }
  | { type: 'search'; keyword: string };

/** 侧边栏 view 种类标识，前端据此初始化对应渲染逻辑 */
export type SidebarViewKind = 'assistants' | 'sessions' | 'recycleBin' | 'settings';
