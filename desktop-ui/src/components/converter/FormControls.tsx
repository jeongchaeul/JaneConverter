import { ChevronDown } from "lucide-react";

export function SelectField({
  label,
  value,
  values,
  onChange,
  disabled = false,
  formatValue,
  hint,
}: {
  label: string;
  value: string | number;
  values: Array<string | number>;
  onChange: (value: string) => void;
  disabled?: boolean;
  formatValue?: (item: string | number) => string;
  hint?: string;
}) {
  return (
    <label className={`block min-w-0 ${disabled ? "opacity-50" : ""}`}>
      <span className="mb-2 block text-[11px] font-medium text-zinc-500">{label}</span>
      <span className="relative block">
        <select
          aria-label={label}
          disabled={disabled}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="field w-full appearance-none px-3 py-2.5 pr-9 text-sm cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
        >
          {values.map((item) => (
            <option key={item} value={item} className="bg-[#0c0914] text-zinc-200">
              {formatValue ? formatValue(item) : String(item)}
            </option>
          ))}
        </select>
        <ChevronDown
          aria-hidden="true"
          className="pointer-events-none absolute right-3 top-1/2 size-3.5 -translate-y-1/2 text-zinc-400"
        />
      </span>
      {hint && <span className="mt-1.5 block text-[10px] leading-relaxed text-zinc-600">{hint}</span>}
    </label>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled = false,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <label
      className={`flex items-start gap-3 rounded-xl border border-white/[0.06] bg-black/10 px-3 py-3 transition-colors ${
        disabled ? "cursor-not-allowed opacity-45" : "cursor-pointer hover:border-white/[0.12]"
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 size-4 accent-[#c52b68] disabled:cursor-not-allowed"
      />
      <span className="min-w-0">
        <span className="block text-xs text-zinc-300">{label}</span>
        {hint && <span className="mt-1 block text-[10px] leading-relaxed text-zinc-600">{hint}</span>}
      </span>
    </label>
  );
}
