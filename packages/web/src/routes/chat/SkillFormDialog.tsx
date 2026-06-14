import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { SkillDto, SkillInputField } from "@server-agent/shared";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../components/ui/dialog.js";
import { Button } from "../../components/ui/button.js";
import { Textarea } from "../../components/ui/textarea.js";
import { interpolate } from "../../lib/interpolate.js";

interface SkillFormDialogProps {
  open: boolean;
  skill: SkillDto | null;
  onOpenChange: (open: boolean) => void;
  onContinue: (skill: SkillDto, finalPrompt: string) => void;
}

export function SkillFormDialog({ open, skill, onOpenChange, onContinue }: SkillFormDialogProps) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [previewOpen, setPreviewOpen] = useState(false);

  useEffect(() => {
    if (open && skill) {
      setValues({});
      setPreviewOpen(false);
    }
  }, [open, skill]);

  const fields: SkillInputField[] = skill?.inputSchema ?? [];

  const finalPrompt = useMemo(
    () => (skill ? interpolate(skill.systemPrompt, values) : ""),
    [skill, values]
  );

  const requiredMissing = fields.some((f) => f.required && !values[f.name]?.trim());

  const submit = () => {
    if (!skill || requiredMissing) return;
    onContinue(skill, finalPrompt);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{skill ? `基于 Skill「${skill.title}」` : "Skill 表单"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
          {fields.map((field) => (
            <div key={field.name}>
              <label className="mb-1 block text-sm text-zinc-400">
                {field.label}
                {field.required ? <span className="ml-1 text-red-400">*</span> : null}
              </label>
              {field.type === "text" ? (
                <input
                  className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
                  value={values[field.name] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [field.name]: e.target.value }))}
                  placeholder={field.placeholder}
                />
              ) : field.type === "textarea" ? (
                <Textarea
                  rows={3}
                  value={values[field.name] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [field.name]: e.target.value }))}
                  placeholder={field.placeholder}
                />
              ) : (
                <select
                  className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
                  value={values[field.name] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [field.name]: e.target.value }))}
                >
                  <option value="">请选择...</option>
                  {field.options.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              )}
            </div>
          ))}

          <div>
            <button
              type="button"
              className="flex items-center gap-1 text-sm text-zinc-400 hover:text-zinc-200"
              onClick={() => setPreviewOpen((v) => !v)}
            >
              {previewOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              Prompt 预览
            </button>
            {previewOpen ? (
              <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-zinc-700 bg-zinc-900 p-3 text-xs text-zinc-300">
                {finalPrompt}
              </pre>
            ) : null}
          </div>
        </div>

        <div className="mt-2 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={submit} disabled={requiredMissing}>下一步：选模型</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
