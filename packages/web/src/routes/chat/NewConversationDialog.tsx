import { useEffect, useState } from "react";
import { PROVIDER_MODELS, type ProviderId, type SkillDto } from "@server-agent/shared";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../components/ui/dialog.js";
import { Button } from "../../components/ui/button.js";
import { Textarea } from "../../components/ui/textarea.js";

interface NewConversationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (input: { provider: ProviderId; model: string; systemPrompt?: string; skillId?: number }) => void;
  defaultProvider?: ProviderId;
  skill?: SkillDto | null;
  presetPrompt?: string | null;
}

function isProviderId(value: string | null | undefined): value is ProviderId {
  return value !== null && value !== undefined && value in PROVIDER_MODELS;
}

export function NewConversationDialog({ open, onOpenChange, onCreate, defaultProvider, skill, presetPrompt }: NewConversationDialogProps) {
  const providers = Object.keys(PROVIDER_MODELS) as ProviderId[];
  const [provider, setProvider] = useState<ProviderId>(defaultProvider ?? providers[0]);
  const [model, setModel] = useState<string>(PROVIDER_MODELS[provider][0].id);
  const [systemPrompt, setSystemPrompt] = useState("");

  useEffect(() => {
    if (!open) return;
    if (presetPrompt !== null && presetPrompt !== undefined) {
      // Phase 4: SkillFormDialog interpolate 后传入的最终文本
      const nextProvider = (skill && isProviderId(skill.defaultProvider))
        ? skill.defaultProvider
        : (defaultProvider ?? providers[0]);
      const allowedModels = PROVIDER_MODELS[nextProvider];
      const skillModel = skill?.defaultModel;
      const matched = skillModel ? allowedModels.find((item) => item.id === skillModel) : undefined;
      setProvider(nextProvider);
      setModel(matched?.id ?? allowedModels[0].id);
      setSystemPrompt(presetPrompt);
      return;
    }
    if (skill) {
      // Phase 3 路径：无 inputSchema 的 skill prefill
      const nextProvider = isProviderId(skill.defaultProvider) ? skill.defaultProvider : (defaultProvider ?? providers[0]);
      const allowedModels = PROVIDER_MODELS[nextProvider];
      const skillModel = skill.defaultModel;
      const matched = skillModel ? allowedModels.find((item) => item.id === skillModel) : undefined;
      setProvider(nextProvider);
      setModel(matched?.id ?? allowedModels[0].id);
      setSystemPrompt(skill.systemPrompt);
      return;
    }
    const nextProvider = defaultProvider ?? providers[0];
    setProvider(nextProvider);
    setModel(PROVIDER_MODELS[nextProvider][0].id);
    setSystemPrompt("");
    // providers 列表稳定派生自 PROVIDER_MODELS，无需进依赖
  }, [open, skill, defaultProvider, presetPrompt]);

  const onProviderChange = (next: ProviderId) => {
    setProvider(next);
    setModel(PROVIDER_MODELS[next][0].id);
  };

  const submit = () => {
    const trimmed = systemPrompt.trim();
    onCreate({
      provider,
      model,
      systemPrompt: trimmed ? trimmed : undefined,
      skillId: skill?.id
    });
    setSystemPrompt("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{skill ? `基于 Skill「${skill.title}」新建会话` : "新建会话"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm text-zinc-400">服务商</label>
            <select
              value={provider}
              onChange={(event) => onProviderChange(event.target.value as ProviderId)}
              className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
            >
              {providers.map((id) => (
                <option key={id} value={id}>{id}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm text-zinc-400">模型</label>
            <select
              value={model}
              onChange={(event) => setModel(event.target.value)}
              className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
            >
              {PROVIDER_MODELS[provider].map((item) => (
                <option key={item.id} value={item.id}>{item.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm text-zinc-400">System Prompt（可选）</label>
            <Textarea
              rows={3}
              maxLength={8000}
              value={systemPrompt}
              onChange={(event) => setSystemPrompt(event.target.value)}
              placeholder="为该会话设置系统提示词"
            />
          </div>
          <Button className="w-full" onClick={submit}>创建</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
