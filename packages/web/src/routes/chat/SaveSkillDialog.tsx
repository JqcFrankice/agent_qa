import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../components/ui/dialog.js";
import { Button } from "../../components/ui/button.js";
import { Textarea } from "../../components/ui/textarea.js";

export interface SaveSkillInput {
  title: string;
  description: string;
  systemPrompt: string;
  isPublic: boolean;
}

interface SaveSkillDialogProps {
  open: boolean;
  draft: { title: string; systemPrompt: string } | null;
  isSubmitting: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: SaveSkillInput) => void;
}

export function SaveSkillDialog({ open, draft, isSubmitting, onOpenChange, onSubmit }: SaveSkillDialogProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [isPublic, setIsPublic] = useState(false);

  useEffect(() => {
    if (open && draft) {
      setTitle(draft.title);
      setSystemPrompt(draft.systemPrompt);
      setDescription("");
      setIsPublic(false);
    }
  }, [open, draft]);

  const submit = () => {
    onSubmit({ title: title.trim(), description: description.trim(), systemPrompt, isPublic });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>保存为 Skill</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm text-zinc-400">标题</label>
            <input
              className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={80}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-zinc-400">描述（可选，280 字内）</label>
            <input
              className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={280}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-zinc-400">System Prompt</label>
            <Textarea
              rows={10}
              maxLength={8000}
              value={systemPrompt}
              onChange={(event) => setSystemPrompt(event.target.value)}
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-zinc-300">
            <input
              type="checkbox"
              checked={isPublic}
              onChange={(event) => setIsPublic(event.target.checked)}
            />
            公开发布（其他用户可见并复用）
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>取消</Button>
            <Button
              onClick={submit}
              disabled={isSubmitting || title.trim().length === 0 || systemPrompt.trim().length === 0}
            >
              保存
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
