import type { FormEvent, ReactNode } from "react";

interface FormProps {
  title: string;
  children: ReactNode;
  submitLabel: string;
  error?: string | null;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

export function Form({ title, children, submitLabel, error, onSubmit }: FormProps) {
  return (
    <form onSubmit={onSubmit} className="mx-auto mt-24 flex w-full max-w-sm flex-col gap-4 rounded-xl border border-zinc-800 bg-zinc-950 p-6 shadow-xl">
      <h1 className="text-2xl font-semibold">{title}</h1>
      {children}
      {error ? <p className="rounded bg-red-950 px-3 py-2 text-sm text-red-200">{error}</p> : null}
      <button className="rounded bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-500" type="submit">
        {submitLabel}
      </button>
    </form>
  );
}
