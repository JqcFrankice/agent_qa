import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../components/ui/dialog.js";
import { Button } from "../../components/ui/button.js";
import { Textarea } from "../../components/ui/textarea.js";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (reason: string) => void;
  isSubmitting: boolean;
}

export function RejectReasonDialog({ open, onOpenChange, onSubmit, isSubmitting }: Props) {
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (open) setReason("");
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>拒绝原因</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Textarea
            rows={4}
            maxLength={280}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="说明拒绝原因，作者会看到（最多 280 字）"
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>取消</Button>
            <Button
              onClick={() => onSubmit(reason.trim())}
              disabled={isSubmitting || reason.trim().length === 0}
            >
              确认拒绝
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
