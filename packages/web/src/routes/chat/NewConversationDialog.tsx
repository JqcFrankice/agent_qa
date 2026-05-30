import { useState } from "react";
import { PROVIDER_MODELS, type ProviderId } from "@server-agent/shared";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../components/ui/dialog.js";
import { Button } from "../../components/ui/button.js";
import { Textarea } from "../../components/ui/textarea.js";

interface NewConversationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (input: { provider: ProviderId; model: string; systemPrompt?: string }) => void;
  defaultProvider?: ProviderId;
}

export function NewConversationDialog({ open, onOpenChange, onCreate, defaultProvider }: NewConversationDialogProps) {
  const providers = Object.keys(PROVIDER_MODELS) as ProviderId[];
  const [provider, setProvider] = useState<ProviderId>(defaultProvider ?? providers[0]);
  const [model, setModel] = useState<string>(PROVIDER_MODELS[provider][0].id);
  const [systemPrompt, setSystemPrompt] = useState("");

  const onProviderChange = (next: ProviderId) => {
    setProvider(next);
    setModel(PROVIDER_MODELS[next][0].id);
  };

  const submit = () => {
    onCreate({ provider, model, systemPrompt: systemPrompt.trim() ? systemPrompt.trim() : undefined });
    setSystemPrompt("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>新建会话</DialogTitle>
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
              maxLength={4000}
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
