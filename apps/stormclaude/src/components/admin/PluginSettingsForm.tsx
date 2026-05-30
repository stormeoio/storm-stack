import { useState, useEffect } from "react";
import { Save, RotateCcw, Check, AlertCircle } from "lucide-react";
import { clsx } from "clsx";
import type { FieldDescriptor } from "@/lib/queries";

interface Props {
  pluginId: string;
  pluginName: string;
  schema: Record<string, FieldDescriptor>;
  values: Record<string, unknown>;
  onSave: (values: Record<string, unknown>) => Promise<void>;
  isSaving?: boolean;
}

export function PluginSettingsForm({ pluginId, pluginName, schema, values, onSave, isSaving }: Props) {
  const fields = Object.values(schema);
  const [formValues, setFormValues] = useState<Record<string, unknown>>({});
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync form values from props
  useEffect(() => {
    const initial: Record<string, unknown> = {};
    for (const field of fields) {
      initial[field.key] = values[field.key] ?? field.default ?? "";
    }
    setFormValues(initial);
  }, [pluginId, values]);

  const handleChange = (key: string, value: unknown) => {
    setFormValues((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
    setError(null);
  };

  const handleSave = async () => {
    try {
      setError(null);
      await onSave(formValues);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    }
  };

  const handleReset = () => {
    const defaults: Record<string, unknown> = {};
    for (const field of fields) {
      defaults[field.key] = field.default ?? "";
    }
    setFormValues(defaults);
    setSaved(false);
    setError(null);
  };

  if (fields.length === 0) {
    return (
      <div className="text-xs text-gray-400 italic py-2">
        Aucun paramètre configurable.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-800">{pluginName}</h3>
        <span className="text-[10px] text-gray-400 font-mono">{pluginId}</span>
      </div>

      <div className="space-y-3">
        {fields.map((field) => (
          <FieldInput
            key={field.key}
            field={field}
            value={formValues[field.key]}
            onChange={(v) => handleChange(field.key, v)}
          />
        ))}
      </div>

      {error && (
        <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <AlertCircle size={12} />
          {error}
        </div>
      )}

      <div className="flex items-center gap-2 pt-2">
        <button
          onClick={handleSave}
          disabled={isSaving}
          className={clsx(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
            saved
              ? "bg-green-50 text-green-700 border border-green-200"
              : "bg-storm-600 text-white hover:bg-storm-700",
          )}
        >
          {saved ? <Check size={12} /> : <Save size={12} />}
          {saved ? "Enregistré" : isSaving ? "Enregistrement..." : "Enregistrer"}
        </button>
        <button
          onClick={handleReset}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors"
        >
          <RotateCcw size={12} />
          Réinitialiser
        </button>
      </div>
    </div>
  );
}

// ── Field renderers ─────────────────────────────────────────────────────────

function FieldInput({ field, value, onChange }: { field: FieldDescriptor; value: unknown; onChange: (v: unknown) => void }) {
  const id = `field-${field.key}`;

  return (
    <div className="space-y-1">
      <label htmlFor={id} className="flex items-center gap-1.5 text-xs font-medium text-gray-700">
        {field.label}
        {field.required && <span className="text-red-400">*</span>}
      </label>
      {field.description && (
        <p className="text-[10px] text-gray-400">{field.description}</p>
      )}

      {field.type === "boolean" ? (
        <label className="relative inline-flex items-center cursor-pointer gap-2">
          <input
            id={id}
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
            className="sr-only peer"
          />
          <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-storm-500/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-storm-600" />
          <span className="text-xs text-gray-500">{value ? "Activé" : "Désactivé"}</span>
        </label>
      ) : field.type === "enum" && field.options ? (
        <select
          id={id}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-storm-500/20 focus:border-storm-300"
        >
          {field.options.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      ) : field.type === "number" ? (
        <input
          id={id}
          type="number"
          value={value === undefined || value === null ? "" : String(value)}
          min={field.min}
          max={field.max}
          onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
          className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-storm-500/20 focus:border-storm-300"
        />
      ) : (
        <input
          id={id}
          type="text"
          value={String(value ?? "")}
          minLength={field.minLength}
          maxLength={field.maxLength}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-storm-500/20 focus:border-storm-300"
          placeholder={String(field.default ?? "")}
        />
      )}
    </div>
  );
}
