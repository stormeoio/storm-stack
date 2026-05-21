import { useState, useCallback } from "react";
import type { FieldDescriptor } from "./types";

export interface StormConfigFormProps {
  /** Plugin ID (e.g. "@stormstack/stripe") */
  pluginId: string;
  /** Field descriptors from the manifest configSchemas */
  fields: Record<string, FieldDescriptor>;
  /** Current config values */
  values: Record<string, unknown>;
  /** Called when the user saves. Should PATCH /api/storm/config/:pluginId */
  onSave: (pluginId: string, values: Record<string, unknown>) => Promise<void>;
  /** Whether the form is submitting */
  saving?: boolean;
}

/**
 * Auto-generated config form from a plugin's Zod schema.
 * Renders appropriate inputs for string, number, boolean, and enum fields.
 */
export function StormConfigForm({ pluginId, fields, values, onSave, saving }: StormConfigFormProps) {
  const [formValues, setFormValues] = useState<Record<string, unknown>>(() => {
    const initial: Record<string, unknown> = {};
    for (const [key, field] of Object.entries(fields)) {
      initial[key] = values[key] ?? field.default ?? (field.type === "boolean" ? false : field.type === "number" ? 0 : "");
    }
    return initial;
  });
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleChange = useCallback((key: string, value: unknown) => {
    setFormValues((prev) => ({ ...prev, [key]: value }));
    setSuccess(false);
    setError(null);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    try {
      await onSave(pluginId, formValues);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur lors de la sauvegarde");
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {Object.entries(fields).map(([key, field]) => (
        <ConfigField
          key={key}
          field={field}
          value={formValues[key]}
          onChange={(v) => handleChange(key, v)}
        />
      ))}

      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 bg-storm-600 text-white text-sm font-medium rounded-lg hover:bg-storm-700 disabled:opacity-50 transition-colors"
        >
          {saving ? "Sauvegarde..." : "Enregistrer"}
        </button>
        {success && <span className="text-sm text-green-600">Enregistré</span>}
        {error && <span className="text-sm text-red-600">{error}</span>}
      </div>
    </form>
  );
}

function ConfigField({
  field,
  value,
  onChange,
}: {
  field: FieldDescriptor;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const labelEl = (
    <label className="block text-sm font-medium text-gray-700 mb-1">
      {field.label}
      {!field.required && <span className="text-gray-400 font-normal ml-1">(optionnel)</span>}
    </label>
  );

  const hintEl = field.description && field.description !== field.label ? (
    <p className="text-xs text-gray-400 mt-1">{field.description}</p>
  ) : null;

  switch (field.type) {
    case "boolean":
      return (
        <div className="flex items-center gap-3">
          <button
            type="button"
            role="switch"
            aria-checked={!!value}
            onClick={() => onChange(!value)}
            className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors ${
              value ? "bg-storm-600" : "bg-gray-200"
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform mt-0.5 ${
                value ? "translate-x-4 ml-0.5" : "translate-x-0 ml-0.5"
              }`}
            />
          </button>
          <div>
            <span className="text-sm font-medium text-gray-700">{field.label}</span>
            {hintEl}
          </div>
        </div>
      );

    case "number":
      return (
        <div>
          {labelEl}
          <input
            type="number"
            value={value as number ?? ""}
            onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))}
            min={field.min}
            max={field.max}
            step="any"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-storm-500 focus:border-transparent outline-none"
          />
          {hintEl}
        </div>
      );

    case "enum":
      return (
        <div>
          {labelEl}
          <select
            value={value as string ?? ""}
            onChange={(e) => onChange(e.target.value)}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-storm-500 focus:border-transparent outline-none bg-white"
          >
            {field.options?.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
          {hintEl}
        </div>
      );

    case "string":
    default:
      return (
        <div>
          {labelEl}
          <input
            type="text"
            value={value as string ?? ""}
            onChange={(e) => onChange(e.target.value)}
            minLength={field.minLength}
            maxLength={field.maxLength}
            required={field.required}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-storm-500 focus:border-transparent outline-none"
          />
          {hintEl}
        </div>
      );
  }
}
