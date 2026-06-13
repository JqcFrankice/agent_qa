import { useCallback, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { ProviderId, SkillDraftDto, SkillDto } from "@server-agent/shared";
import {
  createConversation,
  deleteConversation,
  listConversations,
  listMessages,
  logout,
  me,
  renameConversation
} from "../../lib/api.js";
import { createSkill, extractSkillFromConversation } from "../../lib/skills.js";
import { streamMessage } from "../../lib/streamMessage.js";
import { Sidebar } from "./Sidebar.js";
import { MessageList, type ChatMessage } from "./MessageList.js";
import { Composer } from "./Composer.js";
import { NewConversationDialog } from "./NewConversationDialog.js";
import { SaveSkillDialog } from "./SaveSkillDialog.js";

interface StreamState {
  conversationId: string;
  prompt: string;
  content: string;
}

function useStreamMessage(onComplete: (conversationId: string) => void) {
  const [stream, setStream] = useState<StreamState | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const start = useCallback(
    async (conversationId: string, prompt: string) => {
      const controller = new AbortController();
      abortRef.current = controller;
      setStream({ conversationId, prompt, content: "" });
      try {
        for await (const event of streamMessage(conversationId, prompt, controller.signal)) {
          if (event.type === "delta") {
            setStream((prev) => (prev ? { ...prev, content: prev.content + event.text } : prev));
          } else if (event.type === "error") {
            toast.error(`上游服务异常（${event.code}），请重试。`);
            break;
          } else if (event.type === "done") {
            break;
          }
        }
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          toast.error("连接中断，请重试。");
        }
      } finally {
        abortRef.current = null;
        setStream(null);
        onComplete(conversationId);
      }
    },
    [onComplete]
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { stream, isStreaming: stream !== null, start, stop };
}

export function ChatPage() {
  const queryClient = useQueryClient();
  const meQuery = useQuery({ queryKey: ["me"], queryFn: me, retry: false });
  const [activeId, setActiveId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  // skillForNew: 选中 skill 后等 NewConversationDialog 接入（Task 9）
  const [, setSkillForNew] = useState<SkillDto | null>(null);
  // editSkill: 编辑 skill 的 dialog UI 留给 Task 9 完成；此处仅占位 state
  const [, setEditSkill] = useState<SkillDto | null>(null);
  const [saveSkillOpen, setSaveSkillOpen] = useState(false);
  const [skillDraft, setSkillDraft] = useState<SkillDraftDto | null>(null);

  const handleUseSkill = useCallback((skill: SkillDto) => {
    setSkillForNew(skill);
    setDialogOpen(true);
  }, []);

  const conversationsQuery = useQuery({ queryKey: ["conversations"], queryFn: listConversations });
  const conversations = conversationsQuery.data?.conversations ?? [];

  const messagesQuery = useQuery({
    queryKey: ["messages", activeId],
    queryFn: () => listMessages(activeId!),
    enabled: activeId !== null
  });

  const { stream, isStreaming, start, stop } = useStreamMessage((conversationId) => {
    void queryClient.invalidateQueries({ queryKey: ["messages", conversationId] });
    void queryClient.invalidateQueries({ queryKey: ["conversations"] });
  });

  const createMutation = useMutation({
    mutationFn: createConversation,
    onSuccess: async ({ conversation }) => {
      await queryClient.invalidateQueries({ queryKey: ["conversations"] });
      setActiveId(conversation.id);
      setDialogOpen(false);
    }
  });

  const renameMutation = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => renameConversation(id, title),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["conversations"] })
  });

  const deleteMutation = useMutation({
    mutationFn: deleteConversation,
    onSuccess: (_data, id) => {
      void queryClient.invalidateQueries({ queryKey: ["conversations"] });
      if (activeId === id) setActiveId(null);
    }
  });

  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["me"] })
  });

  const saveSkillMutation = useMutation({
    mutationFn: createSkill,
    onSuccess: () => {
      toast.success("Skill 已保存");
      setSaveSkillOpen(false);
      setSkillDraft(null);
      void queryClient.invalidateQueries({ queryKey: ["skills"] });
    },
    onError: () => toast.error("保存 Skill 失败")
  });

  const openSaveSkill = async () => {
    if (!activeId) return;
    try {
      const { draft } = await extractSkillFromConversation(activeId);
      setSkillDraft(draft);
      setSaveSkillOpen(true);
    } catch {
      toast.error("无法提取 Skill 草稿");
    }
  };

  if (meQuery.isLoading) return <main className="p-8">加载中...</main>;
  if (meQuery.isError || !meQuery.data) return <Navigate to="/login" replace />;

  const selectConversation = (id: string) => {
    if (id === activeId) return;
    if (isStreaming) {
      if (!window.confirm("当前回复尚未结束，切换会话将中断它。是否继续？")) return;
      stop();
    }
    setActiveId(id);
  };

  const send = (content: string) => {
    if (!activeId) return;
    void start(activeId, content);
  };

  const streamingForActive = stream !== null && stream.conversationId === activeId;
  const baseMessages: ChatMessage[] = messagesQuery.data?.messages ?? [];
  const messages: ChatMessage[] = streamingForActive
    ? [...baseMessages, { id: "pending-user", role: "user", content: stream.prompt, status: "complete", errorCode: null }]
    : baseMessages;

  return (
    <div className="flex h-screen bg-zinc-900 text-zinc-100">
      <Sidebar
        conversations={conversations}
        isLoading={conversationsQuery.isLoading}
        activeId={activeId}
        username={meQuery.data.user.username}
        onSelect={selectConversation}
        onNew={() => setDialogOpen(true)}
        onRename={(id, title) => renameMutation.mutate({ id, title })}
        onDelete={(id) => deleteMutation.mutate(id)}
        onLogout={() => logoutMutation.mutate()}
        onUseSkill={handleUseSkill}
        onEditSkill={setEditSkill}
      />
      <main className="flex flex-1 flex-col">
        {activeId ? (
          <>
            <MessageList
              messages={messages}
              streamingContent={streamingForActive ? stream.content : undefined}
              isStreaming={streamingForActive}
            />
            <Composer
              isStreaming={streamingForActive}
              onSend={send}
              onStop={stop}
              onSaveSkill={activeId ? openSaveSkill : undefined}
            />
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-zinc-500">
            选择或新建一个会话开始对话
          </div>
        )}
      </main>
      <NewConversationDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreate={(input) =>
          createMutation.mutate(input as { provider: ProviderId; model: string; systemPrompt?: string })
        }
      />
      <SaveSkillDialog
        open={saveSkillOpen}
        draft={skillDraft}
        isSubmitting={saveSkillMutation.isPending}
        onOpenChange={(value) => {
          setSaveSkillOpen(value);
          if (!value) setSkillDraft(null);
        }}
        onSubmit={(input) => saveSkillMutation.mutate(input)}
      />
    </div>
  );
}
