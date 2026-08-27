/**
 * The ports the ACL is allowed to call.
 *
 * One group per S-service in ROADMAP §4, and deliberately no wider: the ACL speaks the
 * Cursor dialect on the wire and calls these in grokbot2 terms. When a service leaves the
 * process (Phase 4+), its group is re-pointed at an HTTP client and the command table
 * below does not change — that is the whole reason the seam is drawn here.
 *
 * Handlers are typed `(args: any) => unknown` on purpose. The argument is one parsed JSON
 * body from a client we do not control, and the domain functions each accept the several
 * key spellings that client is known to send; re-declaring those unions here would be a
 * second contract to keep in sync, which is the bug class parity.md records six times.
 */

/** A gateway command: the parsed request body in, whatever JSON the client expects out. */
export type Call = (args: any) => unknown;

/** Only the fields the ACL itself reads off a roster row; rows carry much more. */
export interface AgentRow { id: string; isRunning?: boolean }

/**
 * The gateway-ticket verdict, as much of it as the ACL reads.
 *
 * Everything else on it (which credential was seen, and so on) is identity's business, and the
 * same object goes straight back to `noteAuth` — hence the loose parameter there. Narrowing it
 * here would mean re-declaring a type this side of the seam does not own.
 */
export interface AuthVerdictLike { allow: boolean; message?: string }

/** S1 identity — session, gateway ticket, host settings. */
export interface IdentityPort {
  getHostSettings(): Record<string, unknown>;
  /** The FE sends partial patches; the port merges and persists, and returns the whole. */
  patchHostSettings(patch: unknown): Record<string, unknown>;
  checkAuth(url: string, headers: Record<string, unknown>): AuthVerdictLike;
  noteAuth(url: string, verdict: any): void;
  authSnapshot(): unknown;
}

/** S2 directory — the sidebar roster. */
export interface DirectoryPort {
  createAgent: Call;
  listAgents(): AgentRow[];
  countAgents(): number;
  updateAgent: Call;
  deleteAgents: Call;
  duplicateAgent(args: any): { id: string } | null;
  setAgentUnread: Call;
  setAgentHiddenFromSidebar: Call;
  setAgentNotificationsEnabled: Call;
  setAgentNotifyOnUpdates: Call;
  setAgentAvatarBytes: Call;
  getAgentAvatar(args: any): { avatarDataUrl?: string; avatarVersion?: string };
  searchAgents: Call;
  kickstartAgent: Call;
  agentById(id: string): { id: string } | undefined;
  /** The owner of an agent, ignoring the caller's scope — the SSE hub routes an event to it. */
  ownerOf(id: string): string | undefined;
  /** Ordered envelope for a single-agent roster event — the client discards events without one. */
  nextRosterOrdered(): unknown;
}

/** S3 conversation — entries and the ordered transcript log. */
export interface ConversationPort {
  transcriptTail: Call;
  reactToMessage: Call;
  voteFeedback(): unknown;
  promptAcceptanceStatus: Call;
  getConversationOutline: Call;
  latestEntry(agentId: string): { seq: number } | null | undefined;
}

/** S4 runtime — turns, approvals, widgets, subagents. */
export interface RuntimePort {
  sendPrompt: Call;
  interruptAgentRun: Call;
  resolveLocalToolPermission: Call;
  resolveAutoReviewApproval: Call;
  respondToWidget: Call;
  submitSecret: Call;
  dismissWidget: Call;
  broadcastToAgents: Call;
  getSubagents: Call;
  /** Per-agent: the visible background-task tray, not a global list. */
  getAsyncTasks: Call;
}

/** S6 computer — forever-box status and the handoff card. */
export interface ComputerPort {
  status: Call;
  handBack: Call;
  beginUse(agentId: string): void | Promise<void>;
  endUse(agentId: string): void | Promise<void>;
}

/**
 * Teach a task — record a demonstration, save it as a routine.
 *
 * Absent ⇒ the three commands answer the idle state, which is what they did before any of this
 * existed: an honest "nothing is recording" rather than a shape the renderer cannot read.
 */
export interface TeachPort {
  start(agentId: string): Promise<unknown>;
  stop(agentId: string, save: boolean): Promise<unknown>;
  status(): unknown;
}

/**
 * Recording a demonstration on the box's DESKTOP rather than inside its browser.
 *
 * Same three calls plus `available`, because unlike the browser recorder this one needs an X11
 * session on the box: offering a Start button that cannot record is worse than offering none.
 */
export interface DesktopTeachPort extends TeachPort {
  available(): boolean;
}

/** S8 media — attachment staging and reads. */
export interface MediaPort {
  readAttachmentImage: Call;
  readAttachmentText: Call;
  readAttachmentChunk: Call;
  stageImage(dataUrl: string, fileName: string): string | null;
  stageFile(dataUrl: string, fileName: string, mimeType?: string): string | null;
  stagedCount(): number;
}

/** S9 memory. */
export interface MemoryPort {
  getAgentMemories: Call;
  deleteAgentMemory: Call;
  clearAgentMemories: Call;
}

/**
 * S10 automations.
 *
 * `toClientShape` stays a port call rather than ACL code because the record shape is the
 * domain's; what the ACL owns is the DECISION to send it on every mutating reply, which is
 * a client fact: the FE stores the reply as the new list instead of re-fetching.
 */
export interface AutomationsPort {
  forAgent: Call;
  listAll(): unknown[];
  toClientShape(row: any): unknown;
  create(args: any): unknown[];
  update(args: any): unknown[];
  remove(args: any): unknown[];
  setEnabled(args: any): unknown[];
  runNow: Call;
  forAgentClientShape(args: any): unknown;
}

/** S11 connectors — inbound webhooks and the two long-poll channels. */
export interface ConnectorsPort {
  handleSlackEvent(body: Record<string, unknown>): { status: number; body: unknown };
  handleGitHubEvent(event: string, body: Record<string, unknown>): { status: number; body: unknown };
  /**
   * When false, `/gw/slack/events` and `/gw/github/events` 404 — ops owns public ingress
   * (`GROKBOT2_OPS_URL` set). Default true (in-process BFF webhooks).
   */
  publicWebhooks?: boolean;
  channelEnabled(name: ChannelName): boolean;
  parkRequests(name: ChannelName, res: unknown): void;
  submitResponses(name: ChannelName, body: Buffer): unknown;
  channelSnapshot(): unknown;
}

export type ChannelName = "local-exec" | "webauthn";

/** S12 extensions — MCP servers, skills. */
export interface ExtensionsPort {
  closeMcp(): void;
  mcpServers(): Record<string, unknown>;
  /**
   * How one server is actually doing, for the Plugins pane. Optional so an embedder that has no
   * answer keeps the previous flat report rather than being forced to invent one.
   */
  mcpServerStatus?(name: string): { status: string; detail: string; toolCount: number };
  /*
   * Danh mục plugin và những plugin người gọi đã cài.
   *
   * 0.20 hỏi hai thứ này qua RPC proto (`ListMarketplacePlugins` / `GetEffectiveUserPlugins`);
   * **0.29 hỏi qua cổng** bằng `getMcpCatalog` / `getEffectiveMcpPlugins`, cả hai `noArgs` và cùng
   * trả về `array`. Đo trên client 0.29 thật ngày 27/08: đó là hai trong ba lệnh duy nhất nó gọi
   * mà backend này chưa có mapping.
   *
   * Tuỳ chọn, vì một chỗ nhúng không có danh mục thì trả mảng rỗng vẫn đúng — client đọc
   * `length === 0` là "chưa có", không phải lỗi.
   */
  mcpCatalogEntries?(): readonly unknown[];
  mcpInstalledIds?(): number[];
}

/**
 * What the domain announces when something changes.
 *
 * These are grokbot2 names, not client ones: nothing here says which SSE channel a change goes
 * out on, or whether it needs an ordered envelope. Translating them is the ACL's whole job, and
 * it is why the domain can be given a second listener (the native API) without being told.
 */
export type DomainEvent =
  | { type: "transcript.append"; agentId: string }
  | { type: "agent.upserted"; agentId?: string }
  | { type: "computer.status"; agentId: string }
  | { type: "automations.changed"; agentId: string }
  /** Một hành động của bot trên màn hình máy tính — kênh `computer-action`. */
  | { type: "computer.action"; agentId: string; action: Record<string, unknown> }
  /** Trạng thái ghi bài dạy — kênh `teach-recording`. Payload CHÍNH LÀ trạng thái, không bọc. */
  | { type: "teach.recording"; state: Record<string, unknown> };

export interface EventsPort {
  subscribe(fn: (e: DomainEvent) => void): () => void;
}

/**
 * Observability. Not an S-service: it records what the CLIENT asked for, in client
 * vocabulary, so it belongs on this side of the seam.
 */
export interface ObservePort {
  recordUnknown(method: string, url: string, body: Buffer): void;
  recordCall(method: string, args: unknown, hasBody: boolean): void;
  recordRpc(method: string): void;
  recordSseOpen(): void;
  recordSseClose(): void;
  coverageSnapshot(): Record<string, unknown>;
  calledMethods(): string[];
  lastArgsFor(filter?: string | null): Record<string, unknown>;
  notFoundBody(method: string, url: string): string | null;
  clearUnknown(): number;
}

export interface AclPorts {
  /**
   * The caller's owner id for the current request (multi-tenant Phase 3). The SSE hub reads it at
   * `/gw/events` open to tag the connection, and as a fallback owner for roster-wide events.
   */
  currentOwner(): string;
  /**
   * Run `fn` as `owner` (multi-tenant Phase 3). The SSE hub uses it so a background event's push is
   * built and routed for the agent's owner, not the caller's — `listAgents()` etc. then scope right.
   */
  runAsOwner<T>(owner: string, fn: () => T): T;
  identity: IdentityPort;
  directory: DirectoryPort;
  conversation: ConversationPort;
  runtime: RuntimePort;
  computer: ComputerPort;
  teach?: TeachPort;
  desktopTeach?: DesktopTeachPort;
  media: MediaPort;
  memory: MemoryPort;
  automations: AutomationsPort;
  connectors: ConnectorsPort;
  extensions: ExtensionsPort;
  /**
   * Bí mật của hộp — `setBoxSecrets` / `getBoxSecretsStatus`.
   *
   * Tuỳ chọn: một chỗ nhúng không có hộp thì hai lệnh này vẫn phải trả lời được, và câu trả lời
   * đúng khi đó là "chưa đặt gì", không phải một `{}` vô nghĩa.
   */
  secrets?: {
    set(arg: unknown): Promise<{ names: string[]; count: number; path: string; boxConfigured: boolean }>;
    status(): { names: string[]; count: number; path: string; boxConfigured: boolean };
  };
  events: EventsPort;
  observe: ObservePort;
}
