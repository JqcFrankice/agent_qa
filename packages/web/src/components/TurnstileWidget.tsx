interface TurnstileWidgetProps {
  siteKey: string;
  onToken: (token: string) => void;
}

export function TurnstileWidget({ siteKey, onToken }: TurnstileWidgetProps) {
  return (
    <button
      type="button"
      className="rounded border border-zinc-700 px-3 py-2 text-sm text-zinc-300"
      onClick={() => onToken(`dev-turnstile-${siteKey}`)}
    >
      完成人机验证
    </button>
  );
}
