/**
 * Pi SDK Handler
 *
 * Executes prompts using Pi SDK with Feathers/WebSocket architecture.
 *
 * Note: Pi runs according to its own settings and runtime behavior.
 * Agor does not add approval mediation for Pi tool calls in v1.
 */

import * as path from 'node:path';
import { generateId } from '@agor/core/db';
import { getGitState } from '@agor/core/git';
import type {
  ContentBlock,
  MCPServer,
  Message,
  MessageID,
  MessageSource,
  Session,
  SessionID,
  Task,
  TaskID,
  ToolUse,
} from '@agor/core/types';
import { MessageRole } from '@agor/core/types';
import { getPiEnvironmentManager } from '@agor/pi-runtime';
import type { AssistantMessage, TextContent, ThinkingContent, ToolCall } from '@mariozechner/pi-ai';
import {
  type AgentSessionEvent,
  AuthStorage,
  createAgentSession,
  createCodingTools,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  SettingsManager,
} from '@mariozechner/pi-coding-agent';
import { createFeathersBackedRepositories } from '../../db/feathers-repositories.js';
import { enrichContentBlocks } from '../../sdk-handlers/base/diff-enrichment.js';
import { getMcpServersForSession } from '../../sdk-handlers/base/mcp-scoping.js';
import type { AgorClient } from '../../services/feathers-client.js';
import { createStreamingCallbacks } from './base-executor.js';
import { buildPiMcpTools } from './pi-mcp-tools.js';

type PiThinkingLevel = 'low' | 'medium' | 'high';

interface PiExecutionContext {
  session: Session;
  worktreePath: string;
  repos: ReturnType<typeof createFeathersBackedRepositories>;
}

interface PiTurnState {
  assistantMessageId: MessageID | null;
  hasStreamedText: boolean;
  hasStreamedThinking: boolean;
}

async function loadExecutionContext(
  client: AgorClient,
  sessionId: SessionID
): Promise<PiExecutionContext> {
  const repos = createFeathersBackedRepositories(client);
  const session = await client.service('sessions').get(sessionId);
  const worktree = await repos.worktrees.findById(session.worktree_id);

  if (!worktree) {
    throw new Error(`Pi session ${sessionId} references missing worktree ${session.worktree_id}`);
  }
  if (!worktree.path) {
    throw new Error(`Pi worktree ${worktree.worktree_id} does not have a filesystem path`);
  }

  return {
    session,
    worktreePath: worktree.path,
    repos,
  };
}

function mapReasoningEffortToThinkingLevel(reasoningEffort?: string): PiThinkingLevel | undefined {
  if (reasoningEffort === 'low') {
    return 'low';
  }
  if (reasoningEffort === 'medium') {
    return 'medium';
  }
  if (reasoningEffort === 'high') {
    return 'high';
  }
  return undefined;
}

function buildPiSettingsManager(
  worktreePath: string,
  agentDir: string,
  session: Session
): SettingsManager {
  const settingsManager = SettingsManager.create(worktreePath, agentDir);
  const toolOptions = session.tool_options?.pi;
  const settingsOverrides: Record<string, unknown> = {};

  if (toolOptions?.compaction_mode === 'off') {
    settingsOverrides.compaction = { enabled: false };
  }

  if (toolOptions?.raw_overrides && typeof toolOptions.raw_overrides === 'object') {
    Object.assign(settingsOverrides, toolOptions.raw_overrides);
  }

  if (Object.keys(settingsOverrides).length > 0) {
    settingsManager.applyOverrides(settingsOverrides);
  }

  return settingsManager;
}

async function resolvePiModel(
  session: Session,
  modelRegistry: ModelRegistry
): Promise<ReturnType<ModelRegistry['find']>> {
  const provider = session.model_config?.provider;
  const modelId = session.model_config?.model;

  if (provider && modelId) {
    const configuredModel = modelRegistry.find(provider, modelId);
    if (!configuredModel) {
      throw new Error(`Pi model ${provider}/${modelId} is not available in the Pi model registry`);
    }
    return configuredModel;
  }

  if (!provider && modelId) {
    const matchingModels = modelRegistry
      .getAll()
      .filter((candidate: { id: string }) => candidate.id === modelId);
    if (matchingModels.length === 1) {
      return matchingModels[0];
    }
    if (matchingModels.length > 1) {
      throw new Error(
        `Pi model "${modelId}" matches multiple providers. Set an explicit provider in the session configuration.`
      );
    }
    throw new Error(`Pi model "${modelId}" is not available in the Pi model registry`);
  }

  return undefined;
}

async function buildPiSessionManager(
  session: Session,
  worktreePath: string,
  settingsManager: SettingsManager
): Promise<SessionManager> {
  const sessionDir = settingsManager.getSessionDir();
  const nativeBinding = session.native_binding?.pi;
  if (!nativeBinding?.session_file_path) {
    return SessionManager.create(worktreePath, sessionDir);
  }

  const sessionManager = SessionManager.open(
    nativeBinding.session_file_path,
    sessionDir,
    worktreePath
  );
  if (!nativeBinding.branch_id) {
    return sessionManager;
  }

  const branchEntry = sessionManager.getEntry(nativeBinding.branch_id);
  if (!branchEntry) {
    throw new Error(
      `Pi branch binding ${nativeBinding.branch_id} is missing from ${nativeBinding.session_file_path}`
    );
  }

  if (sessionManager.getLeafId() !== nativeBinding.branch_id) {
    sessionManager.branch(nativeBinding.branch_id);
  }

  return sessionManager;
}

function extractTextFromToolResult(result: unknown): string {
  if (!result || typeof result !== 'object') {
    return String(result ?? '');
  }

  const candidate = result as { content?: unknown };
  if (!Array.isArray(candidate.content)) {
    return JSON.stringify(result);
  }

  const textParts = candidate.content
    .flatMap((contentBlock) => {
      if (
        contentBlock &&
        typeof contentBlock === 'object' &&
        'type' in contentBlock &&
        contentBlock.type === 'text' &&
        'text' in contentBlock &&
        typeof contentBlock.text === 'string'
      ) {
        return [contentBlock.text];
      }
      return [];
    })
    .join('');

  if (textParts) {
    return textParts;
  }

  return JSON.stringify(result);
}

function extractAssistantPreview(contentBlocks: ContentBlock[]): string {
  const preview = contentBlocks
    .flatMap((block) => {
      if (block.type === 'text' && typeof block.text === 'string') {
        return [block.text];
      }
      if (block.type === 'thinking' && typeof block.thinking === 'string') {
        return [block.thinking];
      }
      return [];
    })
    .join('');

  return preview.substring(0, 200);
}

function convertAssistantContent(message: AssistantMessage): {
  contentBlocks: ContentBlock[];
  toolUses: ToolUse[];
} {
  const contentBlocks: ContentBlock[] = [];
  const toolUses: ToolUse[] = [];

  for (const contentBlock of message.content) {
    if (contentBlock.type === 'text') {
      const textBlock = contentBlock as TextContent;
      contentBlocks.push({
        type: 'text',
        text: textBlock.text,
      });
      continue;
    }

    if (contentBlock.type === 'thinking') {
      const thinkingBlock = contentBlock as ThinkingContent;
      contentBlocks.push({
        type: 'thinking',
        thinking: thinkingBlock.thinking,
        redacted: thinkingBlock.redacted,
      });
      continue;
    }

    if (contentBlock.type === 'toolCall') {
      const toolCall = contentBlock as ToolCall;
      contentBlocks.push({
        type: 'tool_use',
        id: toolCall.id,
        name: toolCall.name,
        input: toolCall.arguments,
      });
      toolUses.push({
        id: toolCall.id,
        name: toolCall.name,
        input: toolCall.arguments,
      });
    }
  }

  return { contentBlocks, toolUses };
}

async function captureGitStateAtTaskEnd(
  client: AgorClient,
  session: Session,
  worktreePath: string
): Promise<string | undefined> {
  try {
    const sha = await getGitState(worktreePath);
    if (sha && sha !== 'unknown') {
      await client.service('sessions').patch(session.session_id, {
        git_state: { ...session.git_state, current_sha: sha },
      });
    }
    return sha;
  } catch (error) {
    console.warn('[pi] Failed to capture git state at task end:', error);
    return undefined;
  }
}

async function createSystemMessage(
  client: AgorClient,
  sessionId: SessionID,
  taskId: TaskID,
  nextIndex: number,
  content: ContentBlock[]
): Promise<void> {
  await client.service('messages').create({
    message_id: generateId() as MessageID,
    session_id: sessionId,
    task_id: taskId,
    type: 'system',
    role: MessageRole.SYSTEM,
    index: nextIndex,
    timestamp: new Date().toISOString(),
    content_preview: extractAssistantPreview(content),
    content,
    metadata: {
      is_meta: true,
    },
  });
}

/**
 * Execute Pi task (Feathers/WebSocket architecture)
 *
 * Used by ephemeral executor - no IPC, direct Feathers client passed in.
 * Pi runs according to its own settings and runtime behavior.
 */
export async function executePiTask(params: {
  client: AgorClient;
  sessionId: SessionID;
  taskId: TaskID;
  prompt: string;
  abortController: AbortController;
  messageSource?: MessageSource;
}): Promise<void> {
  const { client, sessionId, taskId, prompt, abortController, messageSource } = params;
  const envManager = getPiEnvironmentManager();
  const { session, worktreePath, repos } = await loadExecutionContext(client, sessionId);
  const callbacks = createStreamingCallbacks(client, 'pi', sessionId);
  const currentTaskStartedAt = Date.now();
  let nextIndex = (await repos.messages.findBySessionId(sessionId)).length;
  let latestSessionState = session;

  const userMessage: Message = {
    message_id: generateId() as MessageID,
    session_id: sessionId,
    task_id: taskId,
    type: 'user',
    role: MessageRole.USER,
    index: nextIndex++,
    timestamp: new Date().toISOString(),
    content_preview: prompt.substring(0, 200),
    content: prompt,
    metadata: messageSource ? { source: messageSource } : undefined,
  };

  await client.service('messages').create(userMessage);

  let rawContextUsage:
    | {
        totalTokens: number;
        maxTokens: number;
        percentage: number;
      }
    | undefined;
  let normalizedSdkResponse:
    | {
        tokenUsage: {
          inputTokens: number;
          outputTokens: number;
          totalTokens: number;
          cacheReadTokens: number;
          cacheCreationTokens: number;
        };
        contextWindowLimit: number;
        costUsd?: number;
        primaryModel?: string;
        durationMs: number;
      }
    | undefined;

  try {
    const paths = await envManager.getPaths(worktreePath);
    const agentDir = paths.globalConfigPath;
    const authStorage = AuthStorage.create(path.join(agentDir, 'auth.json'));
    const modelRegistry = ModelRegistry.create(authStorage, path.join(agentDir, 'models.json'));
    const settingsManager = buildPiSettingsManager(worktreePath, agentDir, session);
    const sessionManager = await buildPiSessionManager(session, worktreePath, settingsManager);
    const configuredModel = await resolvePiModel(session, modelRegistry);
    const thinkingLevel = mapReasoningEffortToThinkingLevel(
      session.tool_options?.pi?.reasoning_effort
    );
    const builtInTools = createCodingTools(worktreePath);
    const scopedMcpServers = (
      await getMcpServersForSession(sessionId, {
        sessionMCPRepo: repos.sessionMCP,
        mcpServerRepo: repos.mcpServers,
        forUserId: session.created_by,
      })
    ).map(({ server }) => server) as MCPServer[];
    const customTools = buildPiMcpTools({
      client,
      sessionId,
      servers: scopedMcpServers,
      builtInToolNames: new Set(builtInTools.map((tool) => tool.name)),
    });

    // Build a resource loader that skips the per-skill `<available_skills>`
    // block Pi would otherwise inject into the system prompt. With a full
    // ~/.pi/agent/skills/ directory (Agor users commonly have 100+ skills
    // shared with Claude Code / the CLI), that block is ~150 tokens per
    // skill and dominates the prompt for short chats on local models. Users
    // who want skill auto-discovery in a specific session can opt in via
    // `tool_options.pi.enable_skills`.
    const resourceLoader = new DefaultResourceLoader({
      cwd: worktreePath,
      agentDir,
      settingsManager,
      noSkills: session.tool_options?.pi?.enable_skills !== true,
    });
    await resourceLoader.reload();

    const { session: piSession } = await createAgentSession({
      cwd: worktreePath,
      agentDir,
      authStorage,
      modelRegistry,
      model: configuredModel,
      thinkingLevel,
      tools: builtInTools,
      customTools,
      resourceLoader,
      sessionManager,
      settingsManager,
    });

    const abortListener = () => {
      void piSession.abort().catch((error: unknown) => {
        console.warn('[pi] Failed to abort Pi session cleanly:', error);
      });
    };
    abortController.signal.addEventListener('abort', abortListener);

    const assistantMessageIds: MessageID[] = [];
    const toolArgumentsByCallId = new Map<string, Record<string, unknown>>();
    const toolNamesByCallId = new Map<string, string>();
    const rawEvents: unknown[] = [];
    const turnState: PiTurnState = {
      assistantMessageId: null,
      hasStreamedText: false,
      hasStreamedThinking: false,
    };
    let latestAssistantMessage: AssistantMessage | null = null;
    let eventQueue = Promise.resolve();

    const ensureAssistantMessageId = (): MessageID => {
      if (!turnState.assistantMessageId) {
        turnState.assistantMessageId = generateId() as MessageID;
      }
      return turnState.assistantMessageId;
    };

    const unsubscribe = piSession.subscribe((event: AgentSessionEvent) => {
      eventQueue = eventQueue.then(async () => {
        rawEvents.push(event);

        if (event.type === 'message_update') {
          const updateEvent = event as Extract<AgentSessionEvent, { type: 'message_update' }>;
          if (updateEvent.message.role !== 'assistant') {
            return;
          }

          const assistantMessageId = ensureAssistantMessageId();
          const assistantEvent = updateEvent.assistantMessageEvent;

          if (assistantEvent.type === 'text_start' && !turnState.hasStreamedText) {
            turnState.hasStreamedText = true;
            await callbacks.onStreamStart(assistantMessageId, {
              session_id: sessionId,
              task_id: taskId,
              role: MessageRole.ASSISTANT,
              timestamp: new Date().toISOString(),
            });
            return;
          }

          if (assistantEvent.type === 'text_delta') {
            if (!turnState.hasStreamedText) {
              turnState.hasStreamedText = true;
              await callbacks.onStreamStart(assistantMessageId, {
                session_id: sessionId,
                task_id: taskId,
                role: MessageRole.ASSISTANT,
                timestamp: new Date().toISOString(),
              });
            }
            await callbacks.onStreamChunk(assistantMessageId, assistantEvent.delta);
            return;
          }

          if (assistantEvent.type === 'thinking_start' && callbacks.onThinkingStart) {
            if (!turnState.hasStreamedThinking) {
              turnState.hasStreamedThinking = true;
              await callbacks.onThinkingStart(assistantMessageId, {});
            }
            return;
          }

          if (assistantEvent.type === 'thinking_delta' && callbacks.onThinkingChunk) {
            if (!turnState.hasStreamedThinking && callbacks.onThinkingStart) {
              turnState.hasStreamedThinking = true;
              await callbacks.onThinkingStart(assistantMessageId, {});
            }
            await callbacks.onThinkingChunk(assistantMessageId, assistantEvent.delta);
            return;
          }

          if (assistantEvent.type === 'toolcall_end') {
            toolArgumentsByCallId.set(
              assistantEvent.toolCall.id,
              assistantEvent.toolCall.arguments
            );
            toolNamesByCallId.set(assistantEvent.toolCall.id, assistantEvent.toolCall.name);
          }

          return;
        }

        if (event.type === 'tool_execution_start') {
          const toolStartEvent = event as Extract<
            AgentSessionEvent,
            { type: 'tool_execution_start' }
          >;
          toolArgumentsByCallId.set(toolStartEvent.toolCallId, toolStartEvent.args);
          toolNamesByCallId.set(toolStartEvent.toolCallId, toolStartEvent.toolName);
          return;
        }

        if (event.type === 'tool_execution_end') {
          const toolEndEvent = event as Extract<AgentSessionEvent, { type: 'tool_execution_end' }>;
          const toolInput = toolArgumentsByCallId.get(toolEndEvent.toolCallId) || {};
          const toolName = toolNamesByCallId.get(toolEndEvent.toolCallId) || toolEndEvent.toolName;
          const toolMessageId = generateId() as MessageID;
          const toolContent: ContentBlock[] = [
            {
              type: 'tool_use',
              id: toolEndEvent.toolCallId,
              name: toolName,
              input: toolInput,
            },
            {
              type: 'tool_result',
              tool_use_id: toolEndEvent.toolCallId,
              content: extractTextFromToolResult(toolEndEvent.result),
              is_error: toolEndEvent.isError,
            },
          ];

          enrichContentBlocks(toolContent);

          await client.service('messages').create({
            message_id: toolMessageId,
            session_id: sessionId,
            task_id: taskId,
            type: 'assistant',
            role: MessageRole.ASSISTANT,
            index: nextIndex++,
            timestamp: new Date().toISOString(),
            content_preview: `Tool result: ${toolName}`,
            content: toolContent,
            tool_uses: [
              {
                id: toolEndEvent.toolCallId,
                name: toolName,
                input: toolInput,
              },
            ],
          });
          assistantMessageIds.push(toolMessageId);
          return;
        }

        if (event.type === 'compaction_start') {
          await createSystemMessage(client, sessionId, taskId, nextIndex++, [
            {
              type: 'system_status',
              status: 'compacting',
              text: 'Compacting conversation context...',
            },
          ]);
          return;
        }

        if (event.type === 'compaction_end') {
          const compactionEvent = event as Extract<AgentSessionEvent, { type: 'compaction_end' }>;
          await createSystemMessage(client, sessionId, taskId, nextIndex++, [
            {
              type: 'system_complete',
              systemType: 'compaction',
              metadata: {
                reason: compactionEvent.reason,
                aborted: compactionEvent.aborted,
                willRetry: compactionEvent.willRetry,
              },
            },
          ]);
          return;
        }

        if (event.type === 'turn_end') {
          const turnEndEvent = event as Extract<AgentSessionEvent, { type: 'turn_end' }>;
          if (turnEndEvent.message.role !== 'assistant') {
            return;
          }

          const assistantMessage = turnEndEvent.message as AssistantMessage;
          latestAssistantMessage = assistantMessage;
          const { contentBlocks, toolUses } = convertAssistantContent(assistantMessage);
          const textAndThinkingBlocks = contentBlocks.filter(
            (block) => block.type === 'text' || block.type === 'thinking'
          );

          if (turnState.hasStreamedText && turnState.assistantMessageId) {
            await callbacks.onStreamEnd(turnState.assistantMessageId);
          }
          if (
            turnState.hasStreamedThinking &&
            turnState.assistantMessageId &&
            callbacks.onThinkingEnd
          ) {
            await callbacks.onThinkingEnd(turnState.assistantMessageId);
          }

          if (textAndThinkingBlocks.length > 0) {
            const messageId = turnState.assistantMessageId || (generateId() as MessageID);
            await client.service('messages').create({
              message_id: messageId,
              session_id: sessionId,
              task_id: taskId,
              type: 'assistant',
              role: MessageRole.ASSISTANT,
              index: nextIndex++,
              timestamp: new Date().toISOString(),
              content_preview: extractAssistantPreview(textAndThinkingBlocks),
              content: textAndThinkingBlocks,
              tool_uses: toolUses.length > 0 ? toolUses : undefined,
              metadata: {
                model: `${assistantMessage.provider}/${assistantMessage.model}`,
                tokens: {
                  input: assistantMessage.usage.input,
                  output: assistantMessage.usage.output,
                },
              },
            });
            assistantMessageIds.push(messageId);
          }

          turnState.assistantMessageId = null;
          turnState.hasStreamedText = false;
          turnState.hasStreamedThinking = false;
        }
      });
    });

    try {
      await piSession.prompt(prompt);
      await eventQueue;
    } finally {
      unsubscribe();
      abortController.signal.removeEventListener('abort', abortListener);
    }

    const sessionFilePath = piSession.sessionFile || session.native_binding?.pi?.session_file_path;
    if (!sessionFilePath) {
      throw new Error('Pi session did not expose a persistent session file path');
    }

    const branchId = sessionManager.getLeafId() || piSession.sessionId;
    if (!branchId) {
      throw new Error('Pi session did not expose a branch identifier after prompt execution');
    }

    latestSessionState = await client.service('sessions').patch(sessionId, {
      sdk_session_id: piSession.sessionId,
      native_binding: {
        ...session.native_binding,
        pi: {
          root_session_id: piSession.sessionId,
          branch_id: branchId,
          session_file_path: sessionFilePath,
          imported: session.native_binding?.pi?.imported ?? false,
          last_synced_at: new Date().toISOString(),
        },
      },
    });

    const sessionStats = piSession.getSessionStats();
    const contextUsage = piSession.getContextUsage();
    if (contextUsage && contextUsage.tokens !== null && contextUsage.tokens !== undefined) {
      rawContextUsage = {
        totalTokens: contextUsage.tokens,
        maxTokens: contextUsage.contextWindow,
        percentage: contextUsage.percent ?? 0,
      };
    }

    const finalAssistantMessage = latestAssistantMessage as AssistantMessage | null;

    if (finalAssistantMessage) {
      normalizedSdkResponse = {
        tokenUsage: {
          inputTokens: finalAssistantMessage.usage.input,
          outputTokens: finalAssistantMessage.usage.output,
          totalTokens: finalAssistantMessage.usage.totalTokens,
          cacheReadTokens: finalAssistantMessage.usage.cacheRead,
          cacheCreationTokens: finalAssistantMessage.usage.cacheWrite,
        },
        contextWindowLimit:
          rawContextUsage?.maxTokens ||
          finalAssistantMessage.usage.totalTokens ||
          finalAssistantMessage.usage.input + finalAssistantMessage.usage.output,
        costUsd: finalAssistantMessage.usage.cost.total,
        primaryModel: `${finalAssistantMessage.provider}/${finalAssistantMessage.model}`,
        durationMs: Date.now() - currentTaskStartedAt,
      };
    } else if (rawContextUsage) {
      normalizedSdkResponse = {
        tokenUsage: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
        },
        contextWindowLimit: rawContextUsage.maxTokens,
        durationMs: Date.now() - currentTaskStartedAt,
      };
    }

    const rawSdkResponse = {
      sessionId: piSession.sessionId,
      sessionFile: piSession.sessionFile,
      model: finalAssistantMessage
        ? `${finalAssistantMessage.provider}/${finalAssistantMessage.model}`
        : undefined,
      usage: finalAssistantMessage?.usage,
      contextUsage: rawContextUsage,
      sessionStats,
      events: rawEvents,
    };

    const shaAtEnd = await captureGitStateAtTaskEnd(client, latestSessionState, worktreePath);
    const patchData: Partial<Task> = {
      status: abortController.signal.aborted ? 'stopped' : 'completed',
      completed_at: new Date().toISOString(),
      raw_sdk_response: rawSdkResponse,
      normalized_sdk_response: normalizedSdkResponse,
      computed_context_window: rawContextUsage?.totalTokens,
      model: normalizedSdkResponse?.primaryModel,
    };

    if (shaAtEnd) {
      // @ts-expect-error Repository layer deep-merges nested git_state patches.
      patchData.git_state = { sha_at_end: shaAtEnd };
    }

    await client.service('tasks').patch(taskId, patchData);
  } catch (error) {
    const err = error as Error;
    const shaAtEnd = await captureGitStateAtTaskEnd(client, latestSessionState, worktreePath);
    const patchData: Partial<Task> = {
      status: abortController.signal.aborted ? 'stopped' : 'failed',
      completed_at: new Date().toISOString(),
    };

    if (shaAtEnd) {
      // @ts-expect-error Repository layer deep-merges nested git_state patches.
      patchData.git_state = { sha_at_end: shaAtEnd };
    }

    await client.service('tasks').patch(taskId, patchData);

    await client.service('messages').create({
      message_id: generateId() as MessageID,
      session_id: sessionId,
      task_id: taskId,
      type: 'system',
      role: MessageRole.SYSTEM,
      index: nextIndex,
      timestamp: new Date().toISOString(),
      content: err.message,
      content_preview: err.message.substring(0, 200),
    });

    throw err;
  }
}
